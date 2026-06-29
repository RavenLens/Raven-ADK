import { Pinecone, Index } from "@pinecone-database/pinecone";
import { RAGDbSchema, RAGDocument, SimilarityAlgorithm } from "../../RAG";
import { Mutual } from "../../../../models";

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
        const queryText = Array.isArray(query) ? query.join(" ") : query;
        const embeddings = await this.model.embed(queryText);
        
        // Pinecone query takes a single vector, so we use the first one if query was an array
        const vector = embeddings[0];

        const queryResponse = await this.index.namespace(this.namespace || "").query({
            vector,
            topK: 5,
            includeMetadata: true
        });

        return (queryResponse.matches || []).map(match => {
            const metadata = (match.metadata || {}) as any;
            return {
                id: match.id,
                content: metadata.content || "",
                title: metadata.title || "",
                keywords: metadata.keywords ? metadata.keywords.split(",") : [],
                subMemoryIds: []
            };
        });
    }

    async save(documents: RAGDocument | RAGDocument[]): Promise<number> {
        const docs = Array.isArray(documents) ? documents : [documents];
        
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

        return docs.length;
    }
}
