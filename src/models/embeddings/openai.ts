import { OpenAIEmbeddingConfig } from "../text-to-text/openai";
import { EmbeddingModel } from "./embedding.mutual";
import { OpenAI as OpenAIStandalone } from 'openai';

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