import { EmbeddingModel, InvokeOptions, LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { Anthropic as AnthropicStandalone } from '@anthropic-ai/sdk';
import { MessageParam, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";
import { parseToolCallContentToParams, parseToolDescription, Tool } from "../agent/tools/tools";
import { AIMessage, CompactionMessage, ReasoningMessage, ToolMessage, ResponseInputVideo } from "../agent/state";
import * as z from "zod";
import { ThinkingConfigParam } from "@anthropic-ai/sdk/resources";
import { invokeStructuredOutputWithRetries } from "./structuredOutput";

// Defined locally if not exported from SDK or just to be safe
interface ThinkingBlock {
    type: "thinking";
    thinking: string;
    signature: string;
}

export interface AnthropicConfig extends LLMConfig {
    thinking?: ThinkingConfigParam;
    /** As default max tokens are 1024 */
    max_tokens?: number;
    /** Server-side compaction configuration for Anthropic's compact-2026-01-12 beta. */
    compaction?: {
        triggerTokens?: number;
        instructions?: string;
        pauseAfterCompaction?: boolean;
    };
}

export interface AnthropicEmbeddingConfig extends Omit<LLMConfig, "messages" | "tools" | "model"> {
    model: string;
}

interface AnthropicAIEvents {
    stream: (event: AnthropicStandalone.Messages.RawMessageStreamEvent) => void | Promise<void>;
    reasoning: (content: string) => void | Promise<void>;
}

export class Anthropic implements StandardLLMShema {
    typeAPI: "model" = "model";
    apiName = "Anthropic" as const;
    private anthropic: AnthropicStandalone;
    private EventsListeners: Partial<{ [EventName in keyof AnthropicAIEvents]: AnthropicAIEvents[EventName] }> = {};
    baseURL?: string;
    config: AnthropicConfig;

    get compactionMode(): "automatic" | undefined {
        return this.config.compaction ? "automatic" : undefined;
    }
    
    constructor(config: AnthropicConfig, baseURL?: string) {
        this.config = config;
        this.baseURL = config.baseURL ?? baseURL;

        this.anthropic = new AnthropicStandalone({
            apiKey: this.config.apiKey,
            baseURL: this.baseURL
        })
    }

    private parseBase64DataUrl(dataUrl: string): { media_type: string; data: string } | null {
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
            return { media_type: match[1], data: match[2] };
        }
        return null;
    }

    private prepareMessages(): MessageParam[] {
        const messages = this.config.messages ?? [];
        return messages
            .filter((message) => message.type !== "system")
            .map((message): MessageParam | undefined => {
                switch (message.type) {
                    case "user":
                        if (message.imageInput || message.audioInput || message.fileInput || message.videoInput) {
                            const contentParts: any[] = [{ type: "text", text: message.content }];

                            if (message.imageInput) {
                                const url = message.imageInput.image_url;
                                if (url && url.startsWith("data:")) {
                                    const parsed = this.parseBase64DataUrl(url);
                                    if (parsed) {
                                        contentParts.push({
                                            type: "image",
                                            source: {
                                                type: "base64",
                                                media_type: parsed.media_type as any,
                                                data: parsed.data
                                            }
                                        });
                                    }
                                } else if (url) {
                                    contentParts.push({
                                        type: "text",
                                        text: `[Image URL: ${url}]`
                                    });
                                }
                            }

                            if (message.audioInput) {
                                contentParts.push({
                                    type: "text",
                                    text: `[Audio input: ${message.audioInput.input_audio?.format || "audio"}]`
                                });
                            }

                            if (message.fileInput) {
                                const data = message.fileInput.file_data;
                                if (data && data.startsWith("data:")) {
                                    const parsed = this.parseBase64DataUrl(data);
                                    if (parsed && parsed.media_type === "application/pdf") {
                                        contentParts.push({
                                            type: "document",
                                            source: {
                                                type: "base64",
                                                media_type: "application/pdf" as any,
                                                data: parsed.data
                                            }
                                        } as any);
                                    } else if (parsed) {
                                        contentParts.push({
                                            type: "text",
                                            text: `[File input: ${message.fileInput.filename || "file"}, type=${parsed.media_type}]`
                                        });
                                    }
                                } else {
                                    contentParts.push({
                                        type: "text",
                                        text: `[File input: ${message.fileInput.filename || "file"}]`
                                    });
                                }
                            }

                            if (message.videoInput) {
                                contentParts.push({
                                    type: "text",
                                    text: `[Video input: ${message.videoInput.video_url || "video data"}]`
                                });
                            }

                            return {
                                role: "user",
                                content: contentParts
                            } satisfies MessageParam;
                        }
                        return {
                            role: "user",
                            content: message.content
                        } satisfies MessageParam;
                    case "ai":
                        return {
                            role: "assistant",
                            content: message.content ?? ""
                        } satisfies MessageParam;
                    case "thinking":
                        // Anthropic requires model-issued signatures for thinking blocks.
                        // If no signature is present, degrade to assistant text instead of sending an invalid block.
                        if (!message.signature) {
                            return {
                                role: "assistant",
                                content: `Assistant thoughts: ${message.content}`
                            } satisfies MessageParam;
                        }

                        return {
                            role: "assistant",
                            content: [
                                {
                                    type: "thinking",
                                    thinking: message.content,
                                    signature: message.signature
                                }
                            ]
                        } satisfies MessageParam
                    case "compaction":
                        if (message.provider === "anthropic") {
                            return {
                                role: "assistant",
                                content: [{
                                    type: "compaction",
                                    content: message.content ?? null,
                                    encrypted_content: message.encryptedContent
                                }]
                            } as any;
                        }

                        return {
                            role: "assistant",
                            content: `Conversation summary: ${message.content ?? ""}`
                        } satisfies MessageParam;
                    case "tool":
                        const anthropicToolContent = message.content;
                        const truncatedAnthropicToolContent = anthropicToolContent.length > 60000
                            ? anthropicToolContent.slice(0, 60000) + "... [Truncated due to size limits]"
                            : anthropicToolContent;
                        return {
                            role: "user",
                            content: [
                                {
                                    type: "tool_result",
                                    tool_use_id: message.tool_id,
                                    content: truncatedAnthropicToolContent
                                }
                            ]
                        } satisfies MessageParam;
                    default:
                        return undefined;
                }
            })
            .filter((m): m is MessageParam => !!m);
    }

    private prepareSystemPrompt(): string | undefined {
        const systemMessages = (this.config.messages ?? [])
            .filter((message): message is { type: "system"; content: string } => message.type === "system")
            .map((message) => message.content.trim())
            .filter((content) => content.length > 0);

        if (!systemMessages.length) {
            return undefined;
        }

        return systemMessages.join("\n\n");
    }

    private hasAnthropicCompaction(): boolean {
        return !!this.config.compaction || (this.config.messages ?? []).some((message) => {
            return message.type === "compaction" && message.provider === "anthropic";
        });
    }

    private prepareTools(toolsOverride?: Tool<any, any>[]): AnthropicStandalone.Messages.Tool[] {
        const toolsToPrepare = toolsOverride ?? this.config.tools ?? [];
        return toolsToPrepare.map((tool) => {
            const inputSchemaRaw = z.toJSONSchema(tool.toolConfig.toolArguments);

            return {
                name: tool.toolConfig.toolName,
                description: parseToolDescription(tool.toolConfig),
                input_schema: {
                    type: "object",
                    ...(inputSchemaRaw as Record<string, unknown>)
                }
            } satisfies AnthropicStandalone.Messages.Tool;
        });
    }

    onEvent<EventName extends keyof AnthropicAIEvents>(eventName: EventName, eventListener: AnthropicAIEvents[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof AnthropicAIEvents>(eventName: EventName, ...eventArgs: Parameters<AnthropicAIEvents[EventName]>) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as AnthropicAIEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }
    
    private async *streamWithEvents(stream: AsyncIterable<AnthropicStandalone.Messages.RawMessageStreamEvent>, abort?: AbortSignal) {
        for await (const event of stream) {
            if (abort?.aborted) {
                return;
            }

            this.emitEvent("stream", event);

            if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") {
                this.emitEvent("reasoning", (event.delta as any).thinking);
            }

            yield event;
        }
    }

    private prepareSyncAnswer(completion: AnthropicStandalone.Messages.Message & { _request_id?: string | null; }) {
        // Obtain answer content
        const answerContentText = completion.content
            .filter((block): block is TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("\n")
            .trim();
        const answerTools = completion.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

        // Prepare answer 
        const calledToolsMessage = answerTools.map((toolUse) => {
            const content = typeof toolUse.input === "string" ? toolUse.input : JSON.stringify(toolUse.input);

            return {
                type: "tool",
                tool_id: toolUse.id,
                tool_name: toolUse.name,
                content,
                arguments: parseToolCallContentToParams(content)
            } satisfies ToolMessage;
        });
        const thinkingReasonMessage: ReasoningMessage[] | null = completion.content.some(content => content.type === "thinking") ? completion.content
            .filter((content): content is ThinkingBlock => content.type === "thinking")
            .map(content => ({
                type: "thinking",
                content: content.thinking,
                signature: content.signature
            })) : null;
        const compactionMessages: CompactionMessage[] = completion.content
            .filter((content: any) => content.type === "compaction")
            .map((content: any) => ({
                type: "compaction",
                provider: "anthropic",
                content: content.content ?? null,
                encryptedContent: content.encrypted_content
            }));

        if (thinkingReasonMessage && thinkingReasonMessage.length > 0) {
            this.emitEvent("reasoning", thinkingReasonMessage.map(t => t.content).join("\n"));
        }

        let fileInput: any = null;
        let audioOutput: any = null;

        for (const block of completion.content) {
            if (block.type === "audio" as any) {
                audioOutput = {
                    type: "output_audio",
                    data: (block as any).data,
                    transcript: (block as any).transcript ?? ""
                };
            } else if (block.type === "document" as any) {
                fileInput = {
                    type: "input_file",
                    file_data: `data:${(block as any).source?.media_type};base64,${(block as any).source?.data}`,
                    filename: (block as any).filename || "document.pdf"
                };
            }
        }

        let aiAnswer: AIMessage | null = null;
        if (answerContentText || fileInput || audioOutput) {
            aiAnswer = {
                type: "ai",
                content: answerContentText,
                calledTools: calledToolsMessage
            };
            if (fileInput) aiAnswer.fileInput = fileInput;
            if (audioOutput) aiAnswer.audioOutput = audioOutput;
        }
        const answer: (ReasoningMessage | AIMessage | ToolMessage)[] = [
            ...(thinkingReasonMessage ?? []),
            ...(aiAnswer ? [aiAnswer] : []),
            ...calledToolsMessage
        ].filter(v => v !== null);

        // Output message
        return {
            messages: [
                ...(this.config.messages ?? []),
                ...compactionMessages,
                ...answer
            ],
            answer,
            tokens: {
                input: completion.usage.input_tokens,
                output: completion.usage.output_tokens,
                reasoning: 0
            }
        }
    }

    async invoke(): Promise<LLMAnswer>;
    async invoke(options?: { stream?: false | undefined; messages?: InvokeOptions["messages"]; abort?: AbortSignal } | undefined): Promise<LLMAnswer>;
    async invoke(options: { stream: true; messages?: InvokeOptions["messages"]; abort?: AbortSignal }): Promise<AsyncIterable<AnthropicStandalone.Messages.RawMessageStreamEvent>>;
    async invoke(options?: InvokeOptions): Promise<LLMAnswer | AsyncIterable<AnthropicStandalone.Messages.RawMessageStreamEvent>> {
        if (options?.messages) {
            this.config.messages = options.messages;
        }
        
        const thinking = options?.reasoning?.budgetTokens ? {
            type: "enabled",
            budget_tokens: options.reasoning.budgetTokens
        } : this.config.thinking;

        const config: AnthropicStandalone.Messages.MessageCreateParamsNonStreaming = {
            model: this.config.model,
            max_tokens: (this.config.max_tokens ?? 1024) + (options?.reasoning?.budgetTokens ?? 0),
            system: this.prepareSystemPrompt(),
            messages: this.prepareMessages(),
            tools: this.prepareTools(options?.tools),
            thinking: thinking as any
        }

        if (this.hasAnthropicCompaction()) {
            const compaction = this.config.compaction;
            const betaConfig = {
                ...config,
                betas: ["compact-2026-01-12"],
                context_management: {
                    edits: [{
                        type: "compact_20260112",
                        ...(compaction?.triggerTokens ? {
                            trigger: {
                                type: "input_tokens",
                                value: compaction.triggerTokens
                            }
                        } : {}),
                        ...(compaction?.instructions ? { instructions: compaction.instructions } : {}),
                        ...(compaction?.pauseAfterCompaction ? { pause_after_compaction: true } : {})
                    }]
                }
            };
            const betaMessages = (this.anthropic as any).beta.messages;

            if (options?.stream) {
                const streamCompletion = betaMessages.stream(betaConfig, { signal: options?.abort });
                return this.streamWithEvents(streamCompletion, options?.abort) as any;
            }

            const completion = await betaMessages.create(betaConfig, { signal: options?.abort });
            return this.prepareSyncAnswer(completion as any);
        }
        
        if (options?.stream) {
            const streamCompletion = this.anthropic.messages.stream(config, { signal: options?.abort });
            return this.streamWithEvents(streamCompletion, options?.abort);
        } else {
            // Execute llm
            const completion = await this.anthropic.messages.create(config, { signal: options?.abort });
            return this.prepareSyncAnswer(completion);
        }
    }

    async invokeStructuredOutput(schema: z.ZodTypeAny, maxRecallTries?: number, options?: InvokeOptions): Promise<LLMAnswer> {
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
            invoke: (opts) => this.invoke({ ...opts, stream: false }),
            options
        });
    }

    /** Anthropic doesn't provide tts */
    async tts(text: string): Promise<Buffer> {
        throw new Error("TTS is not supported by Anthropic provider in Raven ADK.");
    }

    /** Anthropic doesn't provide stt */
    async stt(speechFile: File, options?: any): Promise<string> {
        throw new Error("STT is not supported by Anthropic provider in Raven ADK.");
    }
}
