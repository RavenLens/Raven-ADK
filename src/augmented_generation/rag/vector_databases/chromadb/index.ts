import { ChromaClient, Collection } from "chromadb";
import { RAGDbSchema, RAGDocument, SimilarityAlgorithm } from "../../RAG";
import { Mutual } from "../../../../models";
import { recordEventWithData, withTelemetry } from "../../../../telemetry";

export class ChromaDB implements RAGDbSchema {
    name: string = "ChromaDB";
    private client: ChromaClient;
    private collection: Collection | null = null;
    private model: Mutual.EmbeddingModel;
    private collectionName: string;

    constructor(config: { 
        client: ChromaClient, 
        model: Mutual.EmbeddingModel,
        collectionName?: string 
    }) {
        this.client = config.client;
        this.model = config.model;
        this.collectionName = config.collectionName || "raven_adk_collection";
    }

    private async getCollection(): Promise<Collection> {
        if (!this.collection) {
            this.collection = await this.client.getOrCreateCollection({
                name: this.collectionName
            });
        }
        return this.collection;
    }

    async fetch(query: string | string[], algorithm?: SimilarityAlgorithm): Promise<RAGDocument[]> {
        return withTelemetry("chroma_fetch", {
            "db.type": "chromadb",
            "db.collection": this.collectionName
        }, async (span) => {
            const collection = await this.getCollection();
            const embeddings = await this.model.embed(query);
            
            const results = await collection.query({
                queryEmbeddings: embeddings,
                nResults: 5
            });

            const documents: RAGDocument[] = [];
            
            if (results.ids && results.ids[0]) {
                for (let i = 0; i < results.ids[0].length; i++) {
                    const id = results.ids[0][i];
                    const content = results.documents[0]?.[i] || "";
                    const metadata = results.metadatas[0]?.[i] || {};
                    
                    documents.push({
                        id,
                        content,
                        title: (metadata.title as string) || "",
                        keywords: metadata.keywords ? (metadata.keywords as string).split(",") : [],
                        subMemoryIds: [] 
                    });
                }
            }
            
            span?.setAttribute("db.result_count", documents.length);
            
            recordEventWithData("chroma_fetch_success", {
                query,
                count: documents.length
            });

            return documents;
        });
    }

    async save(documents: RAGDocument | RAGDocument[]): Promise<number> {
        const docs = Array.isArray(documents) ? documents : [documents];
        
        return withTelemetry("chroma_save", {
            "db.type": "chromadb",
            "db.collection": this.collectionName,
            "db.doc_count": docs.length
        }, async (span) => {
            const collection = await this.getCollection();
            
            for (const doc of docs) {
                const embeddings = await this.model.embed(doc.content);
                
                await collection.add({
                    ids: [doc.id],
                    embeddings: embeddings,
                    metadatas: [{ 
                        title: doc.title, 
                        keywords: doc.keywords.join(","),
                        subMemoryIds: JSON.stringify(doc.subMemoryIds)
                    }],
                    documents: [doc.content]
                });
            }
            
            recordEventWithData("chroma_save_success", {
                docCount: docs.length
            });
            
            return docs.length;
        });
    }

    getAll(): RAGDocument[] {
        // ChromaDB typically requires an async 'get' call or a client scan.
        // RAGDbSchema requires this to be synchronous for now based on InMemory.
        throw new Error("getAll is not supported by ChromaDB implementation yet.");
    }
}
