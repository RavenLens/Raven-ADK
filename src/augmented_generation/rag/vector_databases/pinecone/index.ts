import { Pinecone, Index } from "@pinecone-database/pinecone";
import { RAGDbSchema, RAGDocument, SimilarityAlgorithm } from "../../RAG";
import { Mutual } from "../../../../models";
import { recordEventWithData, withTelemetry } from "../../../../telemetry";

export class PineconeDB implements RAGDbSchema {
    name: string = "Pinecone";
    private client: Pinecone;
    private index: Index;
    private model: Mutual.EmbeddingModel;
    private namespace?: string;

    constructor(config: { 
        client: Pinecone, 
        indexName: string,
        model: Mutual.EmbeddingModel,
        namespace?: string
    }) {
        this.client = config.client;
        this.index = this.client.index(config.indexName);
        this.model = config.model;
        this.namespace = config.namespace;
    }

    async fetch(query: string | string[], algorithm?: SimilarityAlgorithm): Promise<RAGDocument[]> {
        return withTelemetry("pinecone_fetch", {
            "db.type": "pinecone",
            "db.namespace": this.namespace || "default"
        }, async (span) => {
            const queryText = Array.isArray(query) ? query.join(" ") : query;
            const embeddings = await this.model.embed(queryText);
            
            // Pinecone query takes a single vector, so we use the first one if query was an array
            const vector = embeddings[0];

            const queryResponse = await this.index.namespace(this.namespace || "").query({
                vector,
                topK: 5,
                includeMetadata: true
            });

            const documents = (queryResponse.matches || []).map(match => {
                const metadata = (match.metadata || {}) as any;
                return {
                    id: match.id,
                    content: metadata.content || "",
                    title: metadata.title || "",
                    keywords: metadata.keywords ? metadata.keywords.split(",") : [],
                    subMemoryIds: []
                };
            });

            span?.setAttribute("db.result_count", documents.length);
            recordEventWithData("pinecone_fetch_success", {
                query,
                count: documents.length
            });

            return documents;
        });
    }

    async save(documents: RAGDocument | RAGDocument[]): Promise<number> {
        const docs = Array.isArray(documents) ? documents : [documents];
        
        return withTelemetry("pinecone_save", {
            "db.type": "pinecone",
            "db.namespace": this.namespace || "default",
            "db.doc_count": docs.length
        }, async (span) => {
            for (const doc of docs) {
                const embeddings = await this.model.embed(doc.content);
                const vector = embeddings[0];

                await this.index.namespace(this.namespace || "").upsert([{
                    id: doc.id,
                    values: vector,
                    metadata: {
                        content: doc.content,
                        title: doc.title,
                        keywords: doc.keywords.join(","),
                        subMemoryIds: JSON.stringify(doc.subMemoryIds)
                    }
                }]);
            }

            recordEventWithData("pinecone_save_success", {
                docCount: docs.length
            });

            return docs.length;
        });
    }

    getAll(): RAGDocument[] {
        // Pinecone typically doesn't support 'getAll' efficiently without a scan/list-all approach
        // which might be resource intensive. For consistency, we throw or return empty.
        // However, RAGDbSchema now requires it.
        throw new Error("getAll is not supported by PineconeDB implementation yet.");
    }
}
