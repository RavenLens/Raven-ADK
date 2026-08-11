// Contains things mutual for each embedding model
import { StandardLLMShema } from "../mutual";

/** Extension of StandardLLMShema for RAG */
export interface EmbeddingModel extends Omit<StandardLLMShema, "invoke" | "invokeStructuredOutput" | "compact" | "tts" | "stt"> {
    embed(text: string | string[]): Promise<number[][]>;
}
