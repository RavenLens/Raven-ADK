import type * as ResponsesAPI from "openai/resources/responses/responses";
import type * as ChatAPI from "openai/resources/chat/completions";
import * as z from "zod";
import { CompactOptions, InvokeOptions, LLMAnswer, LLMConfig, StandardLLMShema } from "../mutual";
import { OpenAI as OpenAIStandalone } from 'openai';
import { parseToolCallContentToParams, parseToolDescription, Tool } from "../../agent/tools/tools";
import { AIMessage, CompactionMessage, ToolMessage, ReasoningMessage, MessagesVariations } from "../../agent/state";
import { ReasoningEffort } from "openai/resources";
import { invokeStructuredOutputWithRetries } from "./structuredOutput";
import { compactMessagesWithStructuredOutput } from "./structuredOutput";
import { withTelemetry, recordTokenUsage, RecordTracker, RecordTrackerType, recordLog } from "../../telemetry/telemetry";
import { TelemetryProviderSchema } from "../../telemetry/providers/schema";
import { randomUUID } from "node:crypto";

export interface OpenAIConfig extends LLMConfig {
    reasoningEffort?: ReasoningEffort | null;
    /** 
     * Use legacy completions API instead of chat completions. 
     * Useful for base models that don't support chat templates.
     */
    useCompletionsApi?: boolean;
    telemetry?: TelemetryProviderSchema;
    /** Enables OpenAI Responses API server-side compaction. */
    compaction?: {
        compactThreshold: number;
    };
}

export interface OpenAIEmbeddingConfig extends Omit<LLMConfig, "messages" | "tools" | "model"> {
    model: "text-embedding-3-small" | "text-embedding-3-large" | "text-embedding-ada-002" | (string & {});
    telemetry?: TelemetryProviderSchema;
}

interface OpenAIEvents {
    stream: (event: ResponsesAPI.ResponseStreamEvent) => void | Promise<void>;
    reasoning: (content: string) => void | Promise<void>;
}

/**
 * Wrapper for OpenAI for RavenADK
*/
export class OpenAI implements StandardLLMShema {    
    typeAPI: "model" = "model";
    apiName = "OpenAI" as const;
    config: OpenAIConfig;
    baseURL?: string;
    telemetry?: TelemetryProviderSchema | undefined;
    private openai: OpenAIStandalone;
    private EventsListeners: Partial<{ [EventName in keyof OpenAIEvents]: OpenAIEvents[EventName] }> = {};
    private Tracker: RecordTracker<OpenAIConfig>;
    compactionMode: "manual" = "manual";

    constructor(config: OpenAIConfig, baseURL?: string) {
        this.config = config;
        this.telemetry = config.telemetry;
        this.baseURL = config.baseURL ?? baseURL;

        this.openai = new OpenAIStandalone({
            apiKey: this.config.apiKey,
            baseURL: this.baseURL,
        })

        this.Tracker = new RecordTracker(this.config, RecordTrackerType.LLM, "openai");
    }

    private get isLegacy(): boolean {
        return !!this.baseURL && !this.baseURL.includes("api.openai.com");
    }

    private get useCompletions(): boolean {
        return !!(this.config.useCompletionsApi || this.config.model.toLowerCase().includes("-base"));
    }

    onEvent<EventName extends keyof OpenAIEvents>(eventName: EventName, eventListener: OpenAIEvents[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof OpenAIEvents>(eventName: EventName, ...eventArgs: Parameters<OpenAIEvents[EventName]>) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as OpenAIEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    /** Parse messages and return in Responses API format */
    private prepareInput(messages: MessagesVariations[] = this.config.messages ?? []): ResponsesAPI.ResponseInputItem[] {
        const MAX_TOKEN_SIZE = 60000; // ~60KB limit for individual fields
        const truncate = (str: string) => str.length > MAX_TOKEN_SIZE ? str.slice(0, MAX_TOKEN_SIZE) + "... [Truncated due to size limits]" : str;

        const inputItems = messages.flatMap((message): any[] => { // Parse messages to openai compatible format
            switch(message.type) {
                case "system":
                    return [{
                        role: "system",
                        content: message.content
                    } satisfies ResponsesAPI.EasyInputMessage]
                case "user":
                    if (message.imageInput || message.audioInput || message.fileInput || message.videoInput) {
                        const contentParts: any[] = [{ type: "text", text: message.content }];
                        if (message.imageInput) {
                            contentParts.push(message.imageInput);
                        }
                        if (message.audioInput) {
                            contentParts.push(message.audioInput);
                        }
                        if (message.fileInput) {
                            contentParts.push(message.fileInput);
                        }
                        if (message.videoInput) {
                            contentParts.push(message.videoInput);
                        }
                        return [{
                            role: "user",
                            content: contentParts
                        } satisfies ResponsesAPI.EasyInputMessage]
                    }
                    return [{
                        role: "user",
                        content: message.content
                    } satisfies ResponsesAPI.EasyInputMessage]
                case "ai":
                    return [{
                        role: "assistant",
                        content: message.content ?? ""
                    } satisfies ResponsesAPI.EasyInputMessage]
                case "thinking":
                    return [{
                        role: "assistant",
                        content: `Assistant thoughts: ${message.content}`
                    } satisfies ResponsesAPI.EasyInputMessage]
                case "compaction":
                    if (message.provider === "openai") {
                        return message.items ?? [{
                            type: "compaction",
                            encrypted_content: message.encryptedContent
                        }];
                    }
                    return [{
                        role: "assistant",
                        content: `Conversation summary: ${message.content ?? ""}`
                    } satisfies ResponsesAPI.EasyInputMessage]
                case "tool":
                    // The 'input' field for a call should be the original arguments (JSON string)
                    const call: ResponsesAPI.ResponseCustomToolCall = {
                        type: "custom_tool_call",
                        call_id: message.tool_id,
                        name: message.tool_name ?? "",
                        input: truncate(message.content)
                    };

                    // If it has output or error, we send both the call and the output
                    if (message.toolOutput !== undefined || message.toolError !== undefined) {
                        return [
                            call,
                            {
                                type: "custom_tool_call_output",
                                call_id: message.tool_id,
                                output: truncate(message.toolOutput ?? message.toolError ?? "")
                            } satisfies ResponsesAPI.ResponseCustomToolCallOutput
                        ];
                    }

                    return [call];
            }
        });

        return (inputItems as ResponsesAPI.ResponseInputItem[]) ?? [];
    }

    private prepareTools(toolsOverride?: Tool<any, any>[]): any[] {
        const toolsToPrepare = toolsOverride ?? this.config.tools ?? [];
        return toolsToPrepare.map(tool => {
            return {
                type: "function",
                name: tool.toolConfig.toolName,
                description: parseToolDescription(tool.toolConfig),
                parameters: (z as any).toJSONSchema(tool.toolConfig.toolArguments)
            }
        }) ?? []
    }

    private prepareChatInput(): ChatAPI.ChatCompletionMessageParam[] {
        return this.config.messages?.map(((message): any => {
            switch(message.type) {
                case "system":
                    return {
                        role: "system",
                        content: message.content
                    } satisfies ChatAPI.ChatCompletionSystemMessageParam
                case "user":
                    if (message.imageInput || message.audioInput || message.fileInput || message.videoInput) {
                        const contentParts: any[] = [{ type: "text", text: message.content }];
                        if (message.imageInput) {
                            contentParts.push({
                                type: "image_url",
                                image_url: {
                                    url: message.imageInput.image_url ?? "",
                                    detail: message.imageInput.detail
                                }
                            });
                        }
                        if (message.audioInput) {
                            contentParts.push({
                                type: "input_audio",
                                input_audio: {
                                    data: message.audioInput.input_audio.data,
                                    format: message.audioInput.input_audio.format
                                }
                            });
                        }
                        if (message.fileInput) {
                            contentParts.push({
                                type: "file" as any,
                                file_url: message.fileInput.file_url,
                                file_data: message.fileInput.file_data,
                                filename: message.fileInput.filename
                            });
                        }
                        if (message.videoInput) {
                            contentParts.push({
                                type: "video" as any,
                                video_url: message.videoInput.video_url,
                                video_data: message.videoInput.video_data,
                                mimeType: message.videoInput.mimeType
                            });
                        }
                        return {
                            role: "user",
                            content: contentParts
                        } satisfies ChatAPI.ChatCompletionUserMessageParam;
                    }
                    return {
                        role: "user",
                        content: message.content
                    } satisfies ChatAPI.ChatCompletionUserMessageParam
                case "ai":
                    return {
                        role: "assistant",
                        content: message.content ?? "",
                        tool_calls: message.calledTools?.map(tool => ({
                            id: tool.tool_id,
                            type: "function",
                            function: {
                                name: tool.tool_name ?? tool.tool_id,
                                arguments: tool.content
                            }
                        }))
                    } satisfies ChatAPI.ChatCompletionAssistantMessageParam
                case "thinking":
                    return {
                        role: "assistant",
                        content: `Assistant thoughts: ${message.content}`
                    } satisfies ChatAPI.ChatCompletionAssistantMessageParam
                case "compaction":
                    return {
                        role: "assistant",
                        content: `Conversation summary: ${message.content ?? ""}`
                    } satisfies ChatAPI.ChatCompletionAssistantMessageParam
                case "tool":
                    const toolContent = message.toolOutput ?? message.toolError ?? message.content;
                    const truncatedToolContent = toolContent.length > 60000
                        ? toolContent.slice(0, 60000) + "... [Truncated due to size limits]"
                        : toolContent;
                    return {
                        role: "tool",
                        tool_call_id: message.tool_id,
                        content: truncatedToolContent
                    } satisfies ChatAPI.ChatCompletionToolMessageParam
            }
        })) ?? [];
    }

    private prepareChatTools(toolsOverride?: Tool<any, any>[]): ChatAPI.ChatCompletionTool[] {
        const toolsToPrepare = toolsOverride ?? this.config.tools ?? [];
        return toolsToPrepare.map(tool => {
            return {
                type: "function",
                function: {
                    name: tool.toolConfig.toolName,
                    description: parseToolDescription(tool.toolConfig),
                    parameters: (z as any).toJSONSchema(tool.toolConfig.toolArguments)
                }
            } satisfies ChatAPI.ChatCompletionTool
        }) ?? []
    }

    private prepareCompletionInput(): string {
        return this.config.messages?.map(message => {
            const rolePrefix = message.type === "user" ? "User: " : message.type === "ai" ? "Assistant: " : "System: ";
            return `${rolePrefix}${message.content}`;
        }).join("\n") ?? "";
    }

    private prepareCreatePayload(reasoning?: InvokeOptions["reasoning"], toolsOverride?: Tool<any, any>[]): Omit<ResponsesAPI.ResponseCreateParamsBase, "stream"> {
        const payload: any = {
            model: this.config.model,
            reasoning: {
                effort: reasoning?.effort ?? this.config.reasoningEffort ?? undefined
            },
            input: this.prepareInput(),
            tools: this.prepareTools(toolsOverride)
        };

        if (this.config.compaction) {
            payload.context_management = [{
                type: "compaction",
                compact_threshold: this.config.compaction.compactThreshold
            }];
        }

        return payload;
    }

    private parseResponseToAnswer(response: ResponsesAPI.Response): LLMAnswer {
        const answerContentText = response.output_text?.trim() ? response.output_text : null;
        
        const answerTools = response.output.filter((outputItem): any => 
            outputItem.type === "custom_tool_call" || 
            outputItem.type === "function_call"
        );
        const compactionMessages: CompactionMessage[] = response.output
            .filter((outputItem: any) => outputItem.type === "compaction")
            .map((outputItem: any) => ({
                type: "compaction",
                provider: "openai",
                encryptedContent: outputItem.encrypted_content,
                items: [outputItem]
            }));

        // Map output for answer
        const calledToolsMessage = answerTools.map(toolCall => {
            const casted = toolCall as any;
            const toolId = casted.call_id || casted.id || `call_${randomUUID().slice(0, 8)}`;
            
            // Handle both Model-neutral 'input' and Chat-specific 'arguments' or 'function_call.arguments'
            let content = casted.input || casted.arguments;
            let name = casted.name;

            if (casted.type === "function_call" && casted.function_call) {
                content = casted.function_call.arguments || casted.function_call.input;
                name = casted.function_call.name;
            }

            return {
                type: "tool",
                tool_id: toolId,
                tool_name: name,
                content: content,
                arguments: parseToolCallContentToParams(content)
            } satisfies ToolMessage;
        });

        // Extract reasoning content from output if available
        let reasoningDetail = "";
        for (const item of response.output) {
            if ((item as any).type === "reasoning" || (item as any).type === "reasoning_content") {
                reasoningDetail += (item as any).reasoning || (item as any).reasoning_content || "";
            }
        }

        const thoughts: ReasoningMessage[] = reasoningDetail ? [{
            type: "thinking",
            content: reasoningDetail
        }] : [];

        if (reasoningDetail) {
            this.emitEvent("reasoning", reasoningDetail);
        }

        let fileInput: any = null;
        let audioInput: any = null;
        let audioOutput: any = null;

        if (response.output) {
            for (const item of response.output) {
                const itemAny = item as any;
                if (itemAny.type === "output_audio" || itemAny.type === "audio") {
                    audioOutput = itemAny;
                } else if (itemAny.type === "input_audio") {
                    audioInput = itemAny;
                } else if (itemAny.type === "input_file" || itemAny.type === "file") {
                    fileInput = itemAny;
                }
            }
        }

        let aiAnswer: AIMessage | null = null;
        if (answerContentText || fileInput || audioInput || audioOutput || calledToolsMessage.length > 0) {
            aiAnswer = {
                type: "ai",
                content: answerContentText,
                calledTools: calledToolsMessage
            };
            if (fileInput) aiAnswer.fileInput = fileInput;
            if (audioInput) aiAnswer.audioInput = audioInput;
            if (audioOutput) aiAnswer.audioOutput = audioOutput;
        }

        const answer: (ReasoningMessage | AIMessage | ToolMessage)[] = [
            ...thoughts,
            ...(aiAnswer ? [aiAnswer] : [])
        ];

        return {
            messages: [
                // Standalone messages
                ...(this.config.messages ?? []),
                ...compactionMessages,
                // AI answer
                ...answer
            ],
            answer,
            tokens: {
                input: response.usage?.input_tokens ?? 0,
                output: response.usage?.output_tokens ?? 0,
                reasoning: response.usage?.output_tokens_details?.reasoning_tokens ?? 0
            }
        };
    }

    private parseChatResponseToAnswer(response: ChatAPI.ChatCompletion): LLMAnswer {
        const choice = response.choices[0];
        const answerContentText = choice.message.content?.trim() ? choice.message.content : null;
        const toolCalls = choice.message.tool_calls ?? [];

        // Extract reasoning content if available
        const reasoningContent = (choice.message as any).reasoning_content;
        const thoughts: ReasoningMessage[] = reasoningContent ? [{
            type: "thinking",
            content: reasoningContent
        }] : [];

        if (reasoningContent) {
            this.emitEvent("reasoning", reasoningContent);
        }

        // Map output for answer
        const calledToolsMessage = toolCalls.map((toolCall: any) => {
            return {
                type: "tool",
                tool_id: toolCall.id,
                tool_name: toolCall.function?.name,
                content: toolCall.function?.arguments,
                arguments: parseToolCallContentToParams(toolCall.function?.arguments)
            } satisfies ToolMessage;
        });

        let audioOutput: any = null;
        if ((choice.message as any).audio) {
            audioOutput = {
                type: "output_audio",
                data: (choice.message as any).audio.data,
                transcript: (choice.message as any).audio.transcript || ""
            };
        }

        let aiAnswer: AIMessage | null = null;
        if (answerContentText || audioOutput || calledToolsMessage.length > 0) {
            aiAnswer = {
                type: "ai",
                content: answerContentText,
                calledTools: calledToolsMessage
            };
            if (audioOutput) aiAnswer.audioOutput = audioOutput;
        }

        const answer: (ReasoningMessage | AIMessage | ToolMessage)[] = [
            ...thoughts,
            ...(aiAnswer ? [aiAnswer] : [])
        ];

        return {
            messages: [
                // Standalone messages
                ...(this.config.messages ?? []),
                // AI answer
                ...answer
            ],
            answer,
            tokens: {
                input: response.usage?.prompt_tokens ?? 0,
                output: response.usage?.completion_tokens ?? 0,
                reasoning: (response.usage as any)?.completion_tokens_details?.reasoning_tokens ?? 0
            }
        };
    }

    private parseCompletionResponseToAnswer(response: any): LLMAnswer {
        const choice = response.choices[0];
        const trimmedText = choice.text?.trim();
        const answerContentText = trimmedText ? trimmedText : null;

        const aiAnswer: AIMessage | null = answerContentText ? {
            type: "ai",
            content: answerContentText,
            calledTools: []
        } : null;

        const answer: (AIMessage | ToolMessage)[] = aiAnswer ? [aiAnswer] : [];

        return {
            messages: [
                // Standalone messages
                ...(this.config.messages ?? []),
                // AI answer
                ...answer
            ],
            answer,
            tokens: {
                input: response.usage?.prompt_tokens ?? 0,
                output: response.usage?.completion_tokens ?? 0,
                reasoning: 0
            }
        };
    }

    private async *streamWithEvents(
        stream: AsyncIterable<ResponsesAPI.ResponseStreamEvent>,
        abort?: AbortSignal
    ): AsyncGenerator<ResponsesAPI.ResponseStreamEvent, LLMAnswer | undefined> {
        // Collect for telemetry
        let finalResponse: ResponsesAPI.Response | null = null;
        let firstTokenTracked = false;
        
        for await (const event of stream) {
            if (abort?.aborted) {
                return;
            }

            if (!firstTokenTracked) {
                this.Tracker.registerTTFT();
                firstTokenTracked = true;
            }
            this.emitEvent("stream", event);

            const eventAny = event as any;
            if (eventAny.type === "reasoning_content" || eventAny.type === "reasoning") {
                this.emitEvent("reasoning", eventAny.reasoning_content || eventAny.reasoning || "");
            }

            if (eventAny.type === "response.done") {
                finalResponse = eventAny.response;
            }

            yield event;
        }

        // Record telemetry
        if (finalResponse) {
            const result = this.parseResponseToAnswer(finalResponse);

            this.Tracker
                .setAnswerActiveSpanAttribute(result)
                .finishTimeTracker()
                .setUsage(result.tokens);
                
            return result;
        }
    }

    async invoke(): Promise<LLMAnswer>;
    async invoke(options?: InvokeOptions & { stream?: false }): Promise<LLMAnswer>;
    async invoke(options: InvokeOptions & { stream: true }): Promise<AsyncIterable<ResponsesAPI.ResponseStreamEvent>>;
    async invoke(options?: InvokeOptions): Promise<LLMAnswer | AsyncIterable<ResponsesAPI.ResponseStreamEvent>> {
        if (options?.messages) {
            this.config.messages = options.messages;
        }

        return await withTelemetry(`llm.run.openai.${options?.stream ? 'stream' : 'invoke'}`, {
            model: this.config.model,
            stream: !!options?.stream
        }, async () => {
            try {
                this.Tracker
                    .registerConfig()
                    .setUserQueryActiveSpanAttribute()
                    .registerTimeTracker();
                
                if (this.isLegacy) {
                    if (options?.stream) {
                        // For now, we don't support streaming events for legacy chat completions 
                        // because the types are quite different and require more extensive mapping.
                        throw new Error("Streaming is not yet supported for legacy OpenAI compatible providers in Raven ADK.");
                    }

                    if (this.useCompletions) {
                        const response = await this.openai.completions.create({
                            model: this.config.model,
                            prompt: this.prepareCompletionInput(),
                            stream: false
                        }, { signal: options?.abort });
                        const result = this.parseCompletionResponseToAnswer(response);
                        
                        this.Tracker
                            .registerTTFT()
                            .setAnswerActiveSpanAttribute(result)
                            .setUsage(result.tokens);
                        
                        return result;
                    }

            const chatTools = this.prepareChatTools(options?.tools);
            const response = await this.openai.chat.completions.create({
                model: this.config.model,
                messages: this.prepareChatInput(),
                tools: chatTools.length > 0 ? chatTools : undefined,
                stream: false,
                reasoning_effort: options?.reasoning?.effort ?? undefined
            } as any, { signal: options?.abort });

                    const result = this.parseChatResponseToAnswer(response);
                    
                    this.Tracker
                        .registerTTFT()
                        .setAnswerActiveSpanAttribute(result)
                        .setUsage(result.tokens);

                    return result;
                }
                
                const basePayload = this.prepareCreatePayload(options?.reasoning, options?.tools);

                if (options?.stream) {
                    const streamPayload: ResponsesAPI.ResponseCreateParamsStreaming = {
                        ...basePayload,
                        stream: true
                    };

                    const stream = await this.openai.responses.create(streamPayload, { signal: options?.abort });

                    return this.streamWithEvents(stream, options?.abort);
                }

                const responsePayload: ResponsesAPI.ResponseCreateParamsNonStreaming = {
                    ...basePayload,
                    stream: false
                };

                const response = await this.openai.responses.create(responsePayload, { signal: options?.abort });
                const result = this.parseResponseToAnswer(response);
                
                this.Tracker
                    .registerTTFT()
                    .setAnswerActiveSpanAttribute(result)
                    .finishTimeTracker()
                    .setUsage(result.tokens);
                
                return result;
            } catch (error: any) {
                recordLog({
                    event: "llm_error",
                    provider: "openai",
                    model: this.config.model,
                    error: error.message || error,
                    stack: error.stack
                });
                throw error;
            } finally {
                if (this.telemetry) {
                    await this.telemetry.send();
                }
            }
        });
    }

    async invokeStructuredOutput(schema: z.ZodTypeAny, maxRecallTries?: number, options?: InvokeOptions): Promise<LLMAnswer> {
        return await withTelemetry(`llm.run.openai.structured_output`, {
            model: this.config.model,
            schema: (schema as any).name || "unnamed_schema"
        }, async () => {
            try {
                const result = await invokeStructuredOutputWithRetries({
                    schema,
                    maxRecallTries,
                    messages: this.config.messages,
                    getTools: () => this.config.tools,
                    setMessages: (messages) => {
                        this.config.messages = messages;
                    },
                    setTools: (tools) => {
                        this.config.tools = tools;
                    },
                    invoke: (opts) => this.invoke({ ...(opts ?? {}), stream: false } as any) as Promise<LLMAnswer>,
                    options
                });

                recordLog({
                    event: "llm_structured_output_success",
                    model: this.config.model,
                    tokens: result.tokens
                });

                return result;
            } catch (error: any) {
                recordLog({
                    event: "llm_structured_output_error",
                    model: this.config.model,
                    error: error.message || error,
                    stack: error.stack
                });
                throw error;
            } finally {
                if (this.telemetry) {
                    await this.telemetry.send();
                }
            }
        });
    }

    async compact(options?: CompactOptions): Promise<MessagesVariations[]> {
        const messages = options?.messages ?? this.config.messages ?? [];

        if (!messages.length) {
            return [];
        }

        if (this.isLegacy || typeof (this.openai.responses as any).compact !== "function") {
            return compactMessagesWithStructuredOutput({
                messages,
                abort: options?.abort,
                invokeStructuredOutput: (schema, maxRecallTries, invokeOptions) => {
                    return this.invokeStructuredOutput(schema, maxRecallTries, invokeOptions);
                }
            });
        }

        const compacted = await (this.openai.responses as any).compact({
            model: this.config.model,
            input: this.prepareInput(messages)
        }, { signal: options?.abort });

        if (!Array.isArray(compacted.output) || !compacted.output.length) {
            throw new Error("OpenAI compaction returned no context items.");
        }

        return [{
            type: "compaction",
            provider: "openai",
            items: compacted.output
        }];
    }

    /** We recomend to use dedicated  */
    async tts(text: string, options: OpenAIStandalone.Audio.Speech.SpeechCreateParams): Promise<Buffer> {
        return await withTelemetry(`llm.run.openai.tts`, {
            model: options.model,
            voice: options.voice
        }, async () => {
            try {
                this.Tracker.registerTimeTracker();
                const response = await this.openai.audio.speech.create({
                    ...options,
                    input: text,
                });

                const buffer = Buffer.from(await response.arrayBuffer());
                
                this.Tracker.finishTimeTracker();
                
                recordLog({
                    event: "llm_tts_success",
                    model: options.model,
                    input_length: text.length,
                    output_size: buffer.length
                });

                return buffer;
            } catch (error: any) {
                recordLog({
                    event: "llm_tts_error",
                    model: options.model,
                    error: error.message || error
                });
                throw error;
            } finally {
                if (this.telemetry) {
                    await this.telemetry.send();
                }
            }
        });
    }

    async stt(speechFile: File, options: OpenAIStandalone.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming): Promise<string> {
        return await withTelemetry(`llm.run.openai.stt`, {
            model: options.model
        }, async () => {
            try {
                this.Tracker.registerTimeTracker();
                const response = await this.openai.audio.transcriptions.create({
                    ...options,
                    file: speechFile,
                });

                this.Tracker.finishTimeTracker();
                
                recordLog({
                    event: "llm_stt_success",
                    model: options.model,
                    filename: speechFile.name,
                    text_length: response.text.length
                });

                return response.text;
            } catch (error: any) {
                recordLog({
                    event: "llm_stt_error",
                    model: options.model,
                    error: error.message || error
                });
                throw error;
            } finally {
                if (this.telemetry) {
                    await this.telemetry.send();
                }
            }
        });
    }
}
