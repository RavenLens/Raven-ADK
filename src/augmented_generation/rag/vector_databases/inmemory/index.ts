import { RAGDbSchema, RAGDocument, SimilarityAlgorithm } from "../../RAG";
import { Mutual } from "../../../../models";
import { recordEventWithData, withTelemetry } from "../../../../telemetry";

export class InMemoryRAGDb implements RAGDbSchema {
    name: string = "InMemoryRAGDb";
    private documents: RAGDocument[] = [];
    private model: Mutual.EmbeddingModel;

    constructor(model: Mutual.EmbeddingModel) {
        this.model = model;
    }

    async fetch(query: string | string[], algorithm: SimilarityAlgorithm = 'Cosine Similarity'): Promise<RAGDocument[]> {
        return withTelemetry("inmemory_fetch", {
            "db.type": "inmemory",
            "db.algorithm": algorithm
        }, async (span) => {
            const queryText = Array.isArray(query) ? query.join(" ") : query;
            const queryEmbeddings = await this.model.embed(queryText);
            const queryVector = queryEmbeddings[0];

            const scoredDocs = this.documents
                .filter(doc => doc.embedding)
                .map(doc => {
                    let score = 0;
                    if (algorithm === 'Cosine Similarity') {
                        score = this.cosineSimilarity(queryVector, doc.embedding!);
                    } else if (algorithm === 'Euclidean Distance') {
                        score = this.euclideanDistance(queryVector, doc.embedding!);
                    }
                    return { doc, score };
                });

            // Sort by score
            if (algorithm === 'Cosine Similarity') {
                // Higher cosine similarity is better
                scoredDocs.sort((a, b) => b.score - a.score);
            } else {
                // Lower Euclidean distance is better
                scoredDocs.sort((a, b) => a.score - b.score);
            }

            const results = scoredDocs.slice(0, 5).map(sd => sd.doc);
            
            span?.setAttribute("db.result_count", results.length);
            recordEventWithData("inmemory_fetch_success", {
                query,
                count: results.length
            });

            return results;
        });
    }

    async save(documents: RAGDocument | RAGDocument[]): Promise<number> {
        const docs = Array.isArray(documents) ? documents : [documents];
        
        return withTelemetry("inmemory_save", {
            "db.type": "inmemory",
            "db.doc_count": docs.length
        }, async (span) => {
            for (const doc of docs) {
                if (!doc.embedding) {
                    const embeddings = await this.model.embed(doc.content);
                    doc.embedding = embeddings[0];
                }
                this.documents.push(doc);
            }

            recordEventWithData("inmemory_save_success", {
                docCount: docs.length
            });

            return docs.length;
        });
    }

    getAll(): RAGDocument[] {
        return withTelemetry("inmemory_get_all", {
            "db.type": "inmemory",
            "db.doc_count": this.documents.length
        }, () => {
            return this.documents;
        }) as any;
    }

    private dotProduct(a: number[], b: number[]): number {
        return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
    }

    private magnitude(a: number[]): number {
        return Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    }

    private cosineSimilarity(a: number[], b: number[]): number {
        const magA = this.magnitude(a);
        const magB = this.magnitude(b);
        if (magA === 0 || magB === 0) return 0;
        return this.dotProduct(a, b) / (magA * magB);
    }

    private euclideanDistance(a: number[], b: number[]): number {
        return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - (b[i] || 0), 2), 0));
    }
}
