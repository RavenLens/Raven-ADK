import { EmbeddingModel, LLMConfig } from "./mutual";

export interface VoyageEmbeddingConfig extends Omit<LLMConfig, "messages" | "tools" | "model"> {
    /** 
     * Voyage AI Embedding models 
     * @see https://docs.voyageai.com/docs/embeddings
     */
    model: "voyage-3" | "voyage-3-lite" | "voyage-2" | "voyage-code-2" | "voyage-law-2" | "voyage-multilingual-2" | "voyage-finance-2" | (string & {});
}

/**
 * Wrapper for Voyage AI embedding models for RavenADK
 */
export class VoyageEmbedding implements EmbeddingModel {
    typeAPI: "model" = "model";
    apiName = { custom: "VoyageAI" } as const;
    config: VoyageEmbeddingConfig;

    constructor(config: VoyageEmbeddingConfig) {
        this.config = config;
    }

    async embed(text: string | string[]): Promise<number[][]> {
        const url = this.config.baseURL ?? "https://api.voyageai.com/v1/embeddings";
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                input: Array.isArray(text) ? text : [text],
                model: this.config.model
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Voyage AI Embedding failed: ${response.status} ${response.statusText} - ${error}`);
        }

        const result = await response.json() as any;
        return result.data.map((d: any) => d.embedding);
    }
}
