/*
    * Compresses chat history
    * Has to be aware of model:
    *   - maximum context limit
    *   - treshold when has to compress
    *   - tokenizer has to be aware of model tokenizer
    *   - instruction what to compress and what to maintain - user can override the default one
*/
import { StandardLLMShema } from "../../../models/mutual";
import { ReActAgentPluginSpec } from "../../ReAct.agent";
import { MessagesVariations } from "../../state";

export type Fields = "systemPrompt" | "thinking" | "userPrompt" | "aiResponses" | "toolCalls" | "toolResponses" | "mediaAndFiles";

export interface PercentageContext {
    tokens: number;
    percentage: number;
}

export type Tokens = Record<Fields, number>;
export type Context = Record<Fields, PercentageContext>;

export type Tokenizer = (content: string) => number | Promise<number>;
export type CompressionEventsCallers = {
    compression_update: (context: Context) => any;
}
export type CompressionEvents = keyof CompressionEventsCallers;

export interface CompactReActAgentPluginOptions {
    /** Skip automatic and model-provided compaction and truncate older messages directly. */
    forceTruncate?: boolean;
    /** Maximum number of characters retained for each truncated message field. */
    truncateSize?: number;
}

/**
 * Safely runs the tokenizer on text content.
 * If the tokenizer throws or is not provided, falls back to a 1 token per 4 characters estimate.
 */
async function safeTokenize(content: string | undefined | null, tokenizer?: Tokenizer): Promise<number> {
    if (!content) return 0;
    try {
        if (tokenizer) {
            const result = await tokenizer(content);
            return typeof result === "number" ? result : Math.ceil(content.length / 4);
        }
    } catch {
        // Fallback to estimation on error
    }
    return Math.ceil(content.length / 4);
}

/**
 * Creates a ReActAgent plugin that monitors conversation size and compacts
 * older messages before a model call when the configured context threshold is exceeded.
 *
 * The plugin preserves system messages and the four most recent non-system messages.
 * It uses the model's `compact()` method when available, skips compaction for automatic
 * providers, and otherwise falls back to bounded truncation. Set `forceTruncate` to bypass
 * both provider compaction modes and use truncation directly.
 *
 * @param model Model metadata used for context calculations.
 * @param model.name Provider model name, used as descriptive metadata.
 * @param model.contextWindowTokens Model context-window limit in tokens. Above this limit compaction is triggered
 * @param tokenizer Function that estimates the token count for text content.
 * @param compressOnceContextPercentage Percentage of the context window at which compaction starts. Defaults to `80`.
 * @param onCompressionUpdate Optional callback invoked with per-category token counts before each model call.
 * @param options Optional compaction behavior and truncation settings.
 * @param options.forceTruncate When `true`, bypasses automatic and manual model compaction.
 * @param options.truncateSize Optional character limit applied to each truncated tool, user, and AI field.
 * @returns A `before_model_call` plugin specification for use in `ReActAgent.plugins`.
 */
export function generateCompactReActAgentPlugin(
    model: {
        /** Provider model name, used as descriptive metadata. */
        name: string;
        /** Model context-window limit in tokens. Above this limit compaction is triggered */
        contextWindowTokens: number;
    },
    tokenizer: Tokenizer,
    compressOnceContextPercentage: number = 80,
    onCompressionUpdate?: (context: Context) => any,
    options: CompactReActAgentPluginOptions = {}
): ReActAgentPluginSpec {
    return {
        name: "CompressConversation",
        executionWay: "before_model_call",
        async execute(executionFrom, agentConfig, graphState) {
            // 1. Calculate tokens
            let tokens: Tokens = {
                systemPrompt: 0,
                thinking: 0,
                userPrompt: 0,
                aiResponses: 0,
                toolCalls: 0,
                toolResponses: 0,
                mediaAndFiles: 0,
            }

            let latestCompactionIndex = -1;
            for (let index = 0; index < agentConfig.messages.length; index++) {
                if (agentConfig.messages[index].type === "compaction") {
                    latestCompactionIndex = index;
                }
            }

            if (latestCompactionIndex >= 0) {
                const systemMessages = agentConfig.messages.filter((message) => message.type === "system");
                const messagesAfterCompaction = agentConfig.messages.slice(latestCompactionIndex);
                const compactedHistory = [...systemMessages, ...messagesAfterCompaction];

                if (compactedHistory.length !== agentConfig.messages.length) {
                    return {
                        status: true,
                        result: {
                            agentConfig: {
                                ...agentConfig,
                                messages: compactedHistory
                            }
                        }
                    };
                }
            }
            
            for (const message of agentConfig.messages) {
                switch(message.type) {
                    case "system":{
                        const tokenizerOutcome = await safeTokenize(message.content, tokenizer);
                        tokens.systemPrompt += tokenizerOutcome;
                    }
                        break;
                    
                    case "thinking":{
                        const tokenizerOutcome = await safeTokenize(message.content, tokenizer);
                        tokens.thinking += tokenizerOutcome;
                    }
                        break;

                    case "compaction": {
                        const compactedContent = message.content
                            ?? message.encryptedContent
                            ?? JSON.stringify(message.items ?? []);
                        tokens.aiResponses += await safeTokenize(compactedContent, tokenizer);
                    }
                        break;
                    
                    case "user":{
                        const tokenizerOutcome = await safeTokenize(message.content, tokenizer);
                        tokens.userPrompt += tokenizerOutcome;

                        let mediaTokens = 0;
                        if (message.imageInput) {
                            const detail = (message.imageInput as any).detail || (message.imageInput as any).image_url?.detail || "auto";
                            mediaTokens += detail === "low" ? 85 : 765;
                        }
                        if (message.audioInput) {
                            const audioData = message.audioInput.input_audio?.data || "";
                            if (audioData) {
                                const rawBytes = audioData.length * 0.75;
                                const seconds = Math.max(0.5, rawBytes / 32000);
                                mediaTokens += Math.ceil(seconds * 150);
                            } else {
                                mediaTokens += 100;
                            }
                        }
                        if (message.videoInput) {
                            const videoData = message.videoInput.video_data || "";
                            if (videoData) {
                                const rawBytes = videoData.length * 0.75;
                                const seconds = Math.max(1, rawBytes / 500000);
                                mediaTokens += Math.ceil(seconds * 258);
                            } else {
                                mediaTokens += 500;
                            }
                        }
                        if (message.fileInput) {
                            const fileData = message.fileInput.file_data || "";
                            if (fileData) {
                                if (fileData.startsWith("data:")) {
                                    const match = fileData.match(/^data:([^;]+);base64,(.+)$/);
                                    if (match) {
                                        const mimeType = match[1].toLowerCase();
                                        const payload = match[2];
                                        const isText = mimeType.startsWith("text/") || 
                                                       mimeType === "application/json" || 
                                                       mimeType === "application/javascript" || 
                                                       mimeType === "application/xml";
                                        if (isText) {
                                            try {
                                                const decoded = Buffer.from(payload, "base64").toString("utf-8");
                                                mediaTokens += await safeTokenize(decoded, tokenizer);
                                            } catch {
                                                mediaTokens += Math.ceil(payload.length / 4);
                                            }
                                        } else if (mimeType === "application/pdf") {
                                            const rawBytes = payload.length * 0.75;
                                            mediaTokens += Math.max(250, Math.ceil(rawBytes / 400));
                                        } else {
                                            const rawBytes = payload.length * 0.75;
                                            mediaTokens += Math.max(100, Math.ceil(rawBytes / 500));
                                        }
                                    } else {
                                        mediaTokens += Math.ceil(fileData.length / 4);
                                    }
                                } else {
                                    mediaTokens += await safeTokenize(fileData, tokenizer);
                                }
                            } else if (message.fileInput.file_data) {
                                mediaTokens += await safeTokenize(message.fileInput.file_data, tokenizer);
                            }
                        }
                        tokens.mediaAndFiles += mediaTokens;
                    }
                        break;
                    
                    case "ai":{
                        tokens.aiResponses += await safeTokenize(message.content ?? "", tokenizer);
                        
                        if (message.structuredOutput) {
                            const strValue = typeof message.structuredOutput === "string"
                                ? message.structuredOutput
                                : JSON.stringify(message.structuredOutput);
                            tokens.aiResponses += await safeTokenize(strValue, tokenizer);
                        }

                        if (message.calledTools && message.calledTools.length > 0) {
                            for (const toolCall of message.calledTools) {
                                let toolCallText = toolCall.tool_id;
                                if (toolCall.tool_name) toolCallText += " " + toolCall.tool_name;
                                if (toolCall.arguments) toolCallText += " " + JSON.stringify(toolCall.arguments);
                                tokens.toolCalls += await safeTokenize(toolCallText, tokenizer);
                            }
                        }

                        let aiMediaTokens = 0;
                        if (message.audioInput) {
                            const audioData = (message.audioInput as any).data || message.audioInput.input_audio?.data || "";
                            if (audioData) {
                                const rawBytes = audioData.length * 0.75;
                                const seconds = Math.max(0.5, rawBytes / 32000);
                                aiMediaTokens += Math.ceil(seconds * 150);
                            }
                        }
                        if (message.audioOutput) {
                            const audioData = (message.audioOutput as any).data || "";
                            const transcript = message.audioOutput.transcript || "";
                            if (audioData) {
                                const rawBytes = audioData.length * 0.75;
                                const seconds = Math.max(0.5, rawBytes / 32000);
                                aiMediaTokens += Math.ceil(seconds * 150);
                            } else if (transcript) {
                                aiMediaTokens += await safeTokenize(transcript, tokenizer);
                            }
                        }
                        if (message.fileInput) {
                            const fileData = message.fileInput.file_data || "";
                            if (fileData) {
                                aiMediaTokens += Math.ceil(fileData.length / 4);
                            } else if (message.fileInput.file_data) {
                                aiMediaTokens += await safeTokenize(message.fileInput.file_data, tokenizer);
                            }
                        }
                        tokens.mediaAndFiles += aiMediaTokens;
                    }
                        break;

                    case "tool":{
                        let toolResponseText = message.content || "";
                        if (message.toolOutput) {
                            toolResponseText += " " + message.toolOutput;
                        }
                        if (message.toolError) {
                            toolResponseText += " " + message.toolError;
                        }
                        if (message.arguments) {
                            toolResponseText += " " + JSON.stringify(message.arguments);
                        }
                        tokens.toolResponses += await safeTokenize(toolResponseText, tokenizer);
                    }
                        break;
                }
            }

            // 2. Check whether context is reached
            const context: Context = {
                systemPrompt: {
                    tokens: tokens.systemPrompt,
                    percentage: model.contextWindowTokens > 0 ? (tokens.systemPrompt / model.contextWindowTokens) * 100 : 0
                },
                thinking: {
                    tokens: tokens.thinking,
                    percentage: model.contextWindowTokens > 0 ? (tokens.thinking / model.contextWindowTokens) * 100 : 0
                },
                userPrompt: {
                    tokens: tokens.userPrompt,
                    percentage: model.contextWindowTokens > 0 ? (tokens.userPrompt / model.contextWindowTokens) * 100 : 0
                },
                aiResponses: {
                    tokens: tokens.aiResponses,
                    percentage: model.contextWindowTokens > 0 ? (tokens.aiResponses / model.contextWindowTokens) * 100 : 0
                },
                toolCalls: {
                    tokens: tokens.toolCalls,
                    percentage: model.contextWindowTokens > 0 ? (tokens.toolCalls / model.contextWindowTokens) * 100 : 0
                },
                toolResponses: {
                    tokens: tokens.toolResponses,
                    percentage: model.contextWindowTokens > 0 ? (tokens.toolResponses / model.contextWindowTokens) * 100 : 0
                },
                mediaAndFiles: {
                    tokens: tokens.mediaAndFiles,
                    percentage: model.contextWindowTokens > 0 ? (tokens.mediaAndFiles / model.contextWindowTokens) * 100 : 0
                }
            };

            if (onCompressionUpdate) {
                try {
                    onCompressionUpdate(context);
                } catch (error) {
                    console.warn("Error in compression_update listener:", error);
                }
            }

            const totalTokens = tokens.systemPrompt + tokens.thinking + tokens.userPrompt + tokens.aiResponses + tokens.toolCalls + tokens.toolResponses + tokens.mediaAndFiles;
            const maxAllowed = Math.floor(model.contextWindowTokens * (compressOnceContextPercentage / 100));

            if (totalTokens > maxAllowed) {
                // Perform compaction to preserve conversational space
                const systemMessages = agentConfig.messages.filter((m: any) => m.type === "system");
                const otherMessages = agentConfig.messages.filter((m: any) => m.type !== "system");

                if (otherMessages.length > 4) {
                    const preserveCount = 4;
                    const messagesToCompact = otherMessages.slice(0, -preserveCount);
                    const messagesToPreserve = otherMessages.slice(-preserveCount);
                    const compactableModel = agentConfig.model as StandardLLMShema;

                    if (!options.forceTruncate && compactableModel.compactionMode === "automatic") {
                        return {
                            status: false
                        };
                    }

                    if (!options.forceTruncate && compactableModel.compact) {
                        const compactedMessages = await compactableModel.compact({
                            messages: messagesToCompact,
                            abort: agentConfig.abort
                        });

                        return {
                            status: true,
                            result: {
                                agentConfig: {
                                    ...agentConfig,
                                    messages: [...systemMessages, ...compactedMessages, ...messagesToPreserve]
                                }
                            }
                        };
                    }

                    const compactedList: MessagesVariations[] = [];
                    const toolTruncateSize = options.truncateSize ?? 400;
                    const userTruncateSize = options.truncateSize ?? 1000;
                    const aiTruncateSize = options.truncateSize ?? 1000;

                    for (const msg of messagesToCompact) {
                        if (msg.type === "tool") {
                            // Truncate large tool content or toolOutput
                            const maxToolLen = toolTruncateSize;
                            let truncatedContent = msg.content;
                            let truncatedOutput = msg.toolOutput;

                            if (msg.content && msg.content.length > maxToolLen) {
                                truncatedContent = msg.content.substring(0, maxToolLen) + `... [Truncated tool content, original length: ${msg.content.length}]`;
                            }
                            if (msg.toolOutput && msg.toolOutput.length > maxToolLen) {
                                truncatedOutput = msg.toolOutput.substring(0, maxToolLen) + `... [Truncated tool output, original length: ${msg.toolOutput.length}]`;
                            }

                            compactedList.push({
                                ...msg,
                                content: truncatedContent,
                                toolOutput: truncatedOutput
                            });
                        } 
                        else if (msg.type === "user") {
                            const maxUserLen = userTruncateSize;
                            let truncatedContent = msg.content;
                            if (msg.content && msg.content.length > maxUserLen) {
                                truncatedContent = msg.content.substring(0, maxUserLen) + `... [Truncated user prompt]`;
                            }
                            compactedList.push({
                                ...msg,
                                content: truncatedContent,
                                imageInput: undefined,
                                audioInput: undefined,
                                fileInput: undefined,
                                videoInput: undefined
                            });
                        } 
                        else if (msg.type === "ai") {
                            const maxAiLen = aiTruncateSize;
                            let truncatedContent = msg.content;
                            if (msg.content && msg.content.length > maxAiLen) {
                                truncatedContent = msg.content.substring(0, maxAiLen) + `... [Truncated AI response]`;
                            }
                            compactedList.push({
                                ...msg,
                                content: truncatedContent,
                                fileInput: null,
                                audioInput: null,
                                audioOutput: null
                            });
                        } 
                        else {
                            compactedList.push(msg);
                        }
                    }

                    return {
                        status: true,
                        result: {
                            agentConfig: {
                                ...agentConfig,
                                messages: [...systemMessages, ...compactedList, ...messagesToPreserve]
                            }
                        }
                    };
                }
            }

            return {
                status: false
            };
        }
    };
}
