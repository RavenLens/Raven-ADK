import { LLMConfig } from "../mutual";
import { EmbeddingModel } from "./embedding.mutual";
import { withTelemetry, RecordTracker, RecordTrackerType, recordLog } from "../../telemetry/telemetry";
import { TelemetryProviderSchema } from "../../telemetry/providers/schema";

export interface VoyageEmbeddingConfig extends Omit<LLMConfig, "messages" | "tools" | "model"> {
    /** 
     * Voyage AI Embedding models 
     * @see https://docs.voyageai.com/docs/embeddings
     */
    model: "voyage-3" | "voyage-3-lite" | "voyage-2" | "voyage-code-2" | "voyage-law-2" | "voyage-multilingual-2" | "voyage-finance-2" | (string & {});
    telemetry?: TelemetryProviderSchema;
}

/**
 * Wrapper for Voyage AI embedding models for RavenADK
 */
export class VoyageEmbedding implements EmbeddingModel {
    typeAPI: "model" = "model";
    apiName = { custom: "VoyageAI" } as const;
    config: VoyageEmbeddingConfig;
    telemetry?: TelemetryProviderSchema;
    private Tracker: RecordTracker<VoyageEmbeddingConfig>;

    constructor(config: VoyageEmbeddingConfig) {
        this.config = config;
        this.telemetry = config.telemetry;
        this.Tracker = new RecordTracker(this.config, RecordTrackerType.Embedding, "voyageai");
    }

    async embed(text: string | string[]): Promise<number[][]> {
        return await withTelemetry(
            `llm.embedding.voyageai`,
            {
                "llm.provider": "voyageai",
                "llm.model": this.config.model,
                "llm.task_query": text instanceof Array ? JSON.stringify(text, null, 4) : text
            },
            async () => {
                try {
                    this.Tracker
                        .registerConfig()
                        .registerTimeTracker("embedding");

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
                    const embedding = result.data.map((d: any) => d.embedding);
                    const tokens = {
                        input: result.usage.total_tokens,
                        output: 0,
                        reasoning: 0
                    };

                    this.Tracker
                        .finishTimeTracker()
                        .setUsage(tokens)
                        .setEmbeddingAnswer(embedding);
                    
                    recordLog({
                        event: "llm_embedding_success",
                        model: this.config.model,
                        input_type: typeof text === 'string' ? 'string' : 'array',
                        tokens: result.usage.total_tokens
                    });

                    return embedding;
                } catch (error: any) {
                    recordLog({
                        event: "llm_embedding_error",
                        model: this.config.model,
                        error: error.message || error,
                        stack: error.stack
                    });
                    throw error;
                } finally {
                    if (this.telemetry) {
                        await this.telemetry.send();
                    }
                }
            }
        );
    }
}
