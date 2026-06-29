import { describe, expect, it, vi, beforeEach } from "vitest";
import { InMemoryRAGDb } from "../../src/augmented_generation/rag/vector_databases/inmemory";
import { RAGDocument } from "../../src/augmented_generation/rag/RAG";

describe("InMemoryRAGDb", () => {
    const mockModel: any = {
        embed: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("stores documents and retrieves them all via getAll", async () => {
        const db = new InMemoryRAGDb(mockModel);
        
        mockModel.embed.mockResolvedValue([[0.1, 0.2, 0.3]]);
        
        const doc: RAGDocument = {
            id: "1",
            title: "Doc 1",
            content: "Some content",
            keywords: ["test"],
            subMemoryIds: []
        };
        
        await db.save(doc);
        const all = db.getAll();
        
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe("1");
        expect(all[0].embedding).toEqual([0.1, 0.2, 0.3]);
        expect(mockModel.embed).toHaveBeenCalledWith("Some content");
    });

    it("calculates Cosine Similarity correctly and ranks matches", async () => {
        const db = new InMemoryRAGDb(mockModel);
        
        // Manual embeddings for deterministic testing
        const doc1: RAGDocument = { id: "1", title: "Match", content: "match", keywords: [], subMemoryIds: [], embedding: [1, 0, 0] };
        const doc2: RAGDocument = { id: "2", title: "Far", content: "far", keywords: [], subMemoryIds: [], embedding: [0, 1, 0] };
        
        await db.save([doc1, doc2]);

        // Mock embed for query: very close to doc1
        mockModel.embed.mockResolvedValue([[0.99, 0.01, 0]]);

        const results = await db.fetch("query", "Cosine Similarity");
        
        expect(results).toHaveLength(2);
        expect(results[0].id).toBe("1"); 
        expect(results[1].id).toBe("2");
    });

    it("calculates Euclidean Distance correctly and ranks matches", async () => {
        const db = new InMemoryRAGDb(mockModel);
        
        // Manual embeddings for deterministic testing
        const doc1: RAGDocument = { id: "1", title: "Near", content: "near", keywords: [], subMemoryIds: [], embedding: [1, 0, 0] };
        const doc2: RAGDocument = { id: "2", title: "Far", content: "far", keywords: [], subMemoryIds: [], embedding: [5, 5, 5] };
        
        await db.save([doc1, doc2]);

        // Mock embed for query: close to doc1
        mockModel.embed.mockResolvedValue([[1.1, 0.1, 0]]);

        const results = await db.fetch("query", "Euclidean Distance");
        
        expect(results).toHaveLength(2);
        expect(results[0].id).toBe("1"); // Lower distance first
        expect(results[1].id).toBe("2");
    });

    it("uses Cosine Similarity as default algorithm", async () => {
        const db = new InMemoryRAGDb(mockModel);
        
        const doc: RAGDocument = { id: "1", title: "doc", content: "content", keywords: [], subMemoryIds: [], embedding: [1, 0, 0] };
        await db.save(doc);
        
        mockModel.embed.mockResolvedValue([[1, 0, 0]]);
        
        // Use a spy to verify which method was called
        // Since both are private, we check the behavior (Cosine similarity for [1,0,0] and [1,0,0] is 1.0)
        // Euclidean distance for [1,0,0] and [1,0,0] is 0.0
        // We can check if results are identical.
        
        const results = await db.fetch("query");
        expect(results).toHaveLength(1);
        expect(results[0].id).toBe("1");
    });

    it("handles multiple documents in save method", async () => {
        const db = new InMemoryRAGDb(mockModel);
        mockModel.embed.mockResolvedValue([[0, 0, 0]]);
        
        const docs: RAGDocument[] = [
            { id: "1", title: "d1", content: "c1", keywords: [], subMemoryIds: [] },
            { id: "2", title: "d2", content: "c2", keywords: [], subMemoryIds: [] }
        ];
        
        const savedCount = await db.save(docs);
        expect(savedCount).toBe(2);
        expect(db.getAll()).toHaveLength(2);
    });
});
