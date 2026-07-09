import { EmbeddingModel, InvokeOptions, LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { OpenAI as OpenAIStandalone } from 'openai';
import type * as ResponsesAPI from "openai/resources/responses/responses";
import type * as ChatAPI from "openai/resources/chat/completions";
import { parseToolCallContentToParams, parseToolDescription, Tool } from "../agent/tools/tools";
import { AIMessage, ToolMessage, ResponseInputVideo, ReasoningMessage } from "../agent/state";
import { ReasoningEffort } from "openai/resources";
import * as z from "zod";
import { invokeStructuredOutputWithRetries } from "./structuredOutput";
import { randomUUID } from "node:crypto";

export interface OpenAIConfig extends LLMConfig {
    reasoningEffort?: ReasoningEffort | null;
    /** 
     * Use legacy completions API instead of chat completions. 
     * Useful for base models that don't support chat templates.
     */
    useCompletionsApi?: boolean;
}

export interface OpenAIEmbeddingConfig extends Omit<LLMConfig, "messages" | "tools" | "model"> {
    model: "text-embedding-3-small" | "text-embedding-3-large" | "text-embedding-ada-002" | (string & {});
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
    private openai: OpenAIStandalone;
    private EventsListeners: Partial<{ [EventName in keyof OpenAIEvents]: OpenAIEvents[EventName] }> = {};
    config: OpenAIConfig;
    baseURL?: string;

    constructor(config: OpenAIConfig, baseURL?: string) {
        this.config = config;
        this.baseURL = config.baseURL ?? baseURL;

        this.openai = new OpenAIStandalone({
            apiKey: this.config.apiKey,
            baseURL: this.baseURL,
        })
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
    private prepareInput(): ResponsesAPI.ResponseInputItem[] {
        const MAX_TOKEN_SIZE = 60000; // ~60KB limit for individual fields
        const truncate = (str: string) => str.length > MAX_TOKEN_SIZE ? str.slice(0, MAX_TOKEN_SIZE) + "... [Truncated due to size limits]" : str;

        const inputItems = this.config.messages?.flatMap((message): any[] => { // Parse messages to openai compatible format
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
        return {
            model: this.config.model,
            reasoning: {
                effort: reasoning?.effort ?? this.config.reasoningEffort ?? undefined
            },
            input: this.prepareInput(),
            tools: this.prepareTools(toolsOverride)
        };
    }

    private parseResponseToAnswer(response: ResponsesAPI.Response): LLMAnswer {
        const answerContentText = response.output_text?.trim() ? response.output_text : null;
        
        const answerTools = response.output.filter((outputItem): any => 
            outputItem.type === "custom_tool_call" || 
            outputItem.type === "function_call"
        );

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

    private async *streamWithEvents(stream: AsyncIterable<ResponsesAPI.ResponseStreamEvent>) {
        for await (const event of stream) {
            this.emitEvent("stream", event);

            const eventAny = event as any;
            if (eventAny.type === "reasoning_content" || eventAny.type === "reasoning") {
                this.emitEvent("reasoning", eventAny.reasoning_content || eventAny.reasoning || "");
            }

            yield event;
        }
    }

    async invoke(): Promise<LLMAnswer>;
    async invoke(options?: { stream?: false | undefined; messages?: InvokeOptions["messages"] }): Promise<LLMAnswer>;
    async invoke(options: { stream: true; messages?: InvokeOptions["messages"] }): Promise<AsyncIterable<ResponsesAPI.ResponseStreamEvent>>;
    async invoke(options?: InvokeOptions): Promise<LLMAnswer | AsyncIterable<ResponsesAPI.ResponseStreamEvent>> {
        if (options?.messages) {
            this.config.messages = options.messages;
        }

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
                });
                return this.parseCompletionResponseToAnswer(response);
            }

            const chatTools = this.prepareChatTools(options?.tools);
            const response = await this.openai.chat.completions.create({
                model: this.config.model,
                messages: this.prepareChatInput(),
                tools: chatTools.length > 0 ? chatTools : undefined,
                stream: false,
                reasoning_effort: options?.reasoning?.effort ?? undefined
            } as any);

            return this.parseChatResponseToAnswer(response);
        }
        
        const basePayload = this.prepareCreatePayload(options?.reasoning, options?.tools);

        if (options?.stream) {
            const streamPayload: ResponsesAPI.ResponseCreateParamsStreaming = {
                ...basePayload,
                stream: true
            };

            const stream = await this.openai.responses.create(streamPayload);

            return this.streamWithEvents(stream);
        }

        const responsePayload: ResponsesAPI.ResponseCreateParamsNonStreaming = {
            ...basePayload,
            stream: false
        };

        const response = await this.openai.responses.create(responsePayload);
        return this.parseResponseToAnswer(response);
    }

    async invokeStructuredOutput(schema: z.ZodTypeAny, maxRecallTries?: number): Promise<LLMAnswer> {
        return invokeStructuredOutputWithRetries({
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
            invoke: () => this.invoke()
        });
    }

    async tts(text: string, options: OpenAIStandalone.Audio.Speech.SpeechCreateParams): Promise<Buffer> {
        const response = await this.openai.audio.speech.create({
            ...options,
            input: text,
        });

        return Buffer.from(await response.arrayBuffer());
    }

    async stt(speechFile: File, options: OpenAIStandalone.Audio.Transcriptions.TranscriptionCreateParamsNonStreaming): Promise<string> {
        const response = await this.openai.audio.transcriptions.create({
            ...options,
            file: speechFile,
        });

        return response.text;
    }
}

/**
 * Wrapper for OpenAI embedding models for RavenADK
 */
export class OpenAIEmbedding implements EmbeddingModel {
    typeAPI: "model" = "model";
    apiName = "OpenAI" as const;
    private openai: OpenAIStandalone;
    config: OpenAIEmbeddingConfig;

    constructor(config: OpenAIEmbeddingConfig, baseURL?: string) {
        this.config = config as any;
        this.openai = new OpenAIStandalone({
            apiKey: this.config.apiKey,
            baseURL: (config as any).baseURL ?? baseURL,
        });
    }

    async embed(text: string | string[]): Promise<number[][]> {
        const response = await this.openai.embeddings.create({
            model: this.config.model,
            input: text,
        });

        return response.data.map((d) => d.embedding);
    }
}
