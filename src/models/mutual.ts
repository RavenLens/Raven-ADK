import * as z from "zod";
import { AIMessage, MessagesVariations, ReasoningMessage, ToolMessage } from "../agent/state";
import { Tool } from "../agent/tools/tools";

export interface LLMConfig {
    /** The model ID for specified provider e.g: GPT-5.5 */
    model: string;
    weight?: number;
    tools?: Tool<any, any>[];
    apiKey?: string;
    /** The url to the custom provider */
    baseURL?: string;
    /** Specify here user message and the all messages are required to run the llm */
    messages?: MessagesVariations[];
}

export interface LLMAnswer {
    /** Set with all messages llm got and the answers as the last message/s */
    messages: MessagesVariations[];
    /** Are only the answer messages for this model call */
    answer: (ReasoningMessage | AIMessage | ToolMessage)[];
    tokens: {
        input: number;
        output: number;
        /** If not reasoning the value = 0 */
        reasoning: number;
    }
}

export interface InvokeOptions {
    stream?: boolean;
    abort?: AbortSignal;
    /** Model will override his messages called in initialization with the specified here messages */
    messages?: MessagesVariations[];
    /** Model will override his tools called in initialization with the specified here tools */
    tools?: Tool<any, any>[];
    /** 
     * Reasoning configuration.
     * When provided, it enables reasoning for the model call.
     */
    reasoning?: {
        /** 
         * Amount of tokens allowed for reasoning. 
         * Specific to Anthropic (budget_tokens) and Google.
         */
        budgetTokens?: number;
        /** 
         * Effort level for reasoning. 
         * Specific to OpenAI.
         */
        effort?: "low" | "medium" | "high";
    };
}

export interface CompactOptions {
    /** The conversation slice to compact. Defaults to the model's configured messages. */
    messages?: MessagesVariations[];
    abort?: AbortSignal;
}

export interface StandardLLMShema {
    typeAPI: "model";
    apiName: "Anthropic" | "OpenAI" | "Google" | { custom: string };
    config: LLMConfig;
    invoke(options?: InvokeOptions): Promise<LLMAnswer>;
    invokeStructuredOutput(schema: z.ZodTypeAny, maxRecallTries?: number, options?: InvokeOptions): Promise<LLMAnswer>;
    /** Whether the provider compacts inside a normal invocation or through `compact`. */
    compactionMode?: "automatic" | "manual";
    /** Compacts a conversation slice into provider-replayable context when supported. */
    compact?(options?: CompactOptions): Promise<MessagesVariations[]>;
    tts(text: string, options?: any): Promise<Buffer | undefined>;
    stt(speechFile: File, options?: any): Promise<string>;
}

/** Extension of StandardLLMShema for RAG */
export interface EmbeddingModel extends Omit<StandardLLMShema, "invoke" | "invokeStructuredOutput" | "compact" | "tts" | "stt"> {
    embed(text: string | string[]): Promise<number[][]>;
}
