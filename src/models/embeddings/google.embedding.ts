import { GoogleGenAI } from "@google/genai";
import { EmbeddingModel } from "./embedding.mutual";
import { LLMConfig } from "../mutual";

export interface GoogleEmbeddingConfig extends Omit<LLMConfig, "messages" | "tools" | "model"> {
    model: "gemini-embedding-2" | (string & {});
    /** 
     * Optional. Determines whether to use the Vertex AI or the Gemini API.
     * When true, the Gemini Enterprise Agent Platform API (Vertex AI) will used.
     */
    vertexai?: boolean;
}

/**
 * Wrapper for Google embedding models for RavenADK
 */
export class GoogleEmbedding implements EmbeddingModel {
    typeAPI: "model" = "model";
    apiName = "Google" as const;
    private client: GoogleGenAI;
    config: GoogleEmbeddingConfig;

    constructor(config: GoogleEmbeddingConfig) {
        this.config = config as any;
        this.client = new GoogleGenAI({
            apiKey: this.config.apiKey,
        });
    }

    async embed(text: string | string[]): Promise<number[][]> {
        if (Array.isArray(text)) {
            const response = await Promise.all(
                text.map(t => this.client.models.embedContent({
                    model: this.config.model,
                    contents: [{ role: "user", parts: [{ text: t }] }]
                }))
            );
            return response.map(r => r.embeddings?.[0]?.values || []);
        } else {
            const response = await this.client.models.embedContent({
                model: this.config.model,
                contents: [{ role: "user", parts: [{ text: text }] }]
            });
            return [response.embeddings?.[0]?.values || []];
        }
    }
}
