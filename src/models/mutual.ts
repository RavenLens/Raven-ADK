import * as z from "zod";
import { AIMessage, MessagesVariations, ReasoningMessage, ToolMessage } from "../agent/state";
import { Tool } from "../agent/tools/tools";
import { TelemetryProviderSchema } from "../telemetry/providers/schema";

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
    answer: MessagesVariations[];
    tokens: {
        input: number;
        output: number;
        /** If not reasoning the value = 0 */
        reasoning: number;
    }
}

export interface InvokeOptions {
    stream?: boolean;
    /** Model will override his messages called in initialization with the specified here messages */
    messages?: MessagesVariations[];
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

export interface StandardLLMShema<TelemetryProviderSchemaSkew extends TelemetryProviderSchema | undefined = undefined> {
    typeAPI: "model";
    apiName: "Anthropic" | "OpenAI" | "Google" | { custom: string };
    config: LLMConfig;
    telemetry?: TelemetryProviderSchemaSkew;
    invoke(): Promise<LLMAnswer>;
    invokeStructuredOutput(schema: z.ZodTypeAny, maxRecallTries?: number): Promise<LLMAnswer>;
    tts(text: string, options?: any): Promise<Buffer | undefined>;
    stt(speechFile: File, options?: any): Promise<string>;
}

/** Extension of StandardLLMShema for RAG */
export interface EmbeddingModel extends Omit<StandardLLMShema, "invoke" | "invokeStructuredOutput" | "tts" | "stt"> {
    embed(text: string | string[]): Promise<number[][]>;
}
