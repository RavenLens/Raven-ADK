import { InvokeOptions, LLMAnswer, LLMConfig, StandardLLMShema } from "./mutual";
import { GoogleGenAI } from "@google/genai";
import type { 
    GenerateContentResponse, 
    Content, 
    Part, 
    Tool as GoogleTool,
    GenerateContentConfig,
    FunctionCall,
    Candidate
} from "@google/genai";
import { parseToolCallContentToParams, parseToolDescription } from "../agent/tools/tools";
import { AIMessage, ToolMessage } from "../agent/state";
import * as z from "zod";
import { invokeStructuredOutputWithRetries } from "./structuredOutput";

export interface GoogleConfig extends LLMConfig {
    /** 
     * Optional. Determines whether to use the Vertex AI or the Gemini API.
     * When true, the Gemini Enterprise Agent Platform API (Vertex AI) will used.
     */
    vertexai?: boolean;
    /** Optional. The Google Cloud project ID for Vertex AI clients. */
    project?: string;
    /** Optional. The Google Cloud project location for Vertex AI clients. */
    location?: string;
    temperature?: number;
    topP?: number;
    topK?: number;
    candidateCount?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
}

interface GoogleAIEvents {
    stream: (event: GenerateContentResponse) => void | Promise<void>;
}

/**
 * Wrapper for Google Gemini models for RavenADK
 */
export class Google implements StandardLLMShema {
    apiName = "Google" as const;
    private client: GoogleGenAI;
    private EventsListeners: Partial<{ [EventName in keyof GoogleAIEvents]: GoogleAIEvents[EventName] }> = {};
    config: GoogleConfig;

    constructor(config: GoogleConfig) {
        this.config = config;
        if (!this.config.apiKey && !this.config.vertexai) {
            console.warn("Google model initialized without apiKey or vertexai config. Calls may fail.");
        }
        this.client = new GoogleGenAI({
            apiKey: this.config.apiKey,
            /* vertexai: this.config.vertexai,
            project: this.config.project,
            location: this.config.location */
        });
    }

    onEvent<EventName extends keyof GoogleAIEvents>(eventName: EventName, eventListener: GoogleAIEvents[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof GoogleAIEvents>(eventName: EventName, ...eventArgs: Parameters<GoogleAIEvents[EventName]>) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as GoogleAIEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    private prepareContents(): Content[] {
        const contents: Content[] = [];
        const messages = this.config.messages ?? [];

        for (const message of messages) {
            if (message.type === "system") continue;

            switch (message.type) {
                case "user":
                    contents.push({
                        role: "user",
                        parts: [{ text: message.content }]
                    });
                    break;
                case "ai":
                    const parts: Part[] = [{ text: message.content ?? "" }];
                    if (message.calledTools) {
                        for (const tool of message.calledTools) {
                            parts.push({
                                functionCall: {
                                    name: tool.tool_name,
                                    args: tool.arguments ?? {},
                                    id: tool.tool_id
                                }
                            });
                        }
                    }
                    contents.push({
                        role: "model",
                        parts: parts
                    });
                    break;
                case "thinking":
                    contents.push({
                        role: "model",
                        parts: [{ 
                            text: message.content,
                            thought: true,
                            thoughtSignature: message.signature
                        }]
                    });
                    break;
                case "tool":
                    contents.push({
                        role: "user",
                        parts: [{
                            functionResponse: {
                                name: message.tool_name ?? "unknown",
                                response: { result: message.content },
                                id: message.tool_id
                            }
                        }]
                    });
                    break;
            }
        }

        return contents;
    }

    private prepareSystemInstruction(): Content | undefined {
        const systemMessages = (this.config.messages ?? [])
            .filter((message): message is { type: "system"; content: string } => message.type === "system")
            .map((message) => message.content.trim())
            .filter((content) => content.length > 0);

        if (!systemMessages.length) {
            return undefined;
        }

        return {
            role: "system",
            parts: [{ text: systemMessages.join("\n\n") }]
        };
    }

    private prepareTools(): GoogleTool[] {
        if (!this.config.tools?.length) return [];

        return [{
            functionDeclarations: this.config.tools.map((tool) => {
                const schema = z.toJSONSchema(tool.toolConfig.toolArguments);
                return {
                    name: tool.toolConfig.toolName,
                    description: parseToolDescription(tool.toolConfig),
                    parameters: schema as any
                };
            })
        }];
    }

    private parseResponseToAnswer(response: GenerateContentResponse): LLMAnswer {
        const text = response.text ?? "";
        const functionCalls = response.functionCalls ?? [];

        const calledTools: ToolMessage[] = functionCalls.map((fc: FunctionCall) => {
            return {
                type: "tool",
                tool_id: fc.id ?? "",
                tool_name: fc.name,
                content: JSON.stringify(fc.args),
                arguments: fc.args as Record<string, any>
            } satisfies ToolMessage;
        });

        const aiAnswer: AIMessage = {
            type: "ai",
            content: text,
            calledTools: calledTools.length > 0 ? calledTools : undefined
        };

        const answer: (AIMessage | ToolMessage)[] = [
            aiAnswer,
            ...calledTools
        ];

        return {
            messages: [
                ...(this.config.messages ?? []),
                ...answer
            ],
            answer,
            tokens: {
                input: response.usageMetadata?.promptTokenCount ?? 0,
                output: response.usageMetadata?.candidatesTokenCount ?? 0,
                reasoning: 0 // Google currently doesn't provide a specific reasoning token count in a separate field in usageMetadata
            }
        };
    }

    private async *streamWithEvents(stream: AsyncGenerator<GenerateContentResponse>) {
        for await (const event of stream) {
            this.emitEvent("stream", event);
            yield event;
        }
    }

    async invoke(): Promise<LLMAnswer>;
    async invoke(options?: { stream?: false | undefined; messages?: InvokeOptions["messages"] }): Promise<LLMAnswer>;
    async invoke(options: { stream: true; messages?: InvokeOptions["messages"] }): Promise<AsyncGenerator<GenerateContentResponse>>;
    async invoke(options?: InvokeOptions): Promise<LLMAnswer | AsyncGenerator<GenerateContentResponse>> {
        if (options?.messages) {
            this.config.messages = options.messages;
        }

        const contents = this.prepareContents();
        const systemInstruction = this.prepareSystemInstruction();
        const tools = this.prepareTools();

        if (options?.stream) {
            const stream = await this.client.models.generateContentStream({
                model: this.config.model,
                contents,
                config: {
                    systemInstruction,
                    tools,
                    temperature: this.config.temperature,
                    topP: this.config.topP,
                    topK: this.config.topK,
                    candidateCount: this.config.candidateCount,
                    maxOutputTokens: this.config.maxOutputTokens,
                    stopSequences: this.config.stopSequences
                }
            });

            return this.streamWithEvents(stream);
        }

        const response = await this.client.models.generateContent({
            model: this.config.model,
            contents,
            config: {
                systemInstruction,
                tools,
                temperature: this.config.temperature,
                topP: this.config.topP,
                topK: this.config.topK,
                candidateCount: this.config.candidateCount,
                maxOutputTokens: this.config.maxOutputTokens,
                stopSequences: this.config.stopSequences
            }
        });

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
}
