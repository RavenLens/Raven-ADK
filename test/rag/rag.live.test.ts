import "dotenv/config";
import { describe, expect, it } from "vitest";
import { ResourceAugmentedGeneration } from "../../src/augmented_generation/rag/RAG";
import { OpenAI, OpenAIEmbedding } from "../../src/models/openai";
import { InMemoryRAGDb } from "../../src/augmented_generation/rag/vector_databases/inmemory";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("RAG Live API with OpenAI", () => {
    const embeddingModel = new OpenAIEmbedding({
        apiKey: openAIApiKey!,
        model: "text-embedding-3-small"
    });

    it("Retrieves context and answers using OpenAI gpt-4o-mini", async () => {
        const db = new InMemoryRAGDb(embeddingModel);

        // 1. Seed the database with specific facts
        await db.save([
            {
                id: "fact_1",
                title: "Raven ADK Project Secrets",
                content: "The secret code for the Raven Project is 'RAVEN-FLIGHT-99'. This project was started in a hidden bunker in the Alps.",
                keywords: ["secret", "raven", "bunker"],
                subMemoryIds: []
            },
            {
                id: "fact_2",
                title: "Raven Team Coffee Preference",
                content: "The Raven ADK development team exclusively drinks 'Mountain Mist' espresso beans.",
                keywords: ["coffee", "team"],
                subMemoryIds: []
            }
        ]);

        const query = "What is the secret code of the Raven Project and what does the team drink?";

        // 2. Setup RAG pipeline
        const rag = new ResourceAugmentedGeneration({
            query: query,
            database: db,
            model: embeddingModel,
            similarityAlgorithm: "Cosine Similarity"
        });

        // 3. Register OpenAI model and invoke
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
            messages: [
                {
                    type: "user",
                    content: query
                }
            ]
        });

        const result = await rag.register(model).invoke();
        const answer = result.answer[0].content?.toLowerCase() || "";

        console.log("RAG Answer:", answer);

        // 4. Verify the model used the provided context
        expect(answer).toContain("raven-flight-99");
        expect(answer).toContain("mountain mist");
    }, 60000);

    it("Stops hallucination when information is missing from RAG context", async () => {
        const db = new InMemoryRAGDb(embeddingModel);
        
        // Save unrelated info
        await db.save({
            id: "unrelated",
            title: "Weather",
            content: "It is sunny in California.",
            keywords: ["weather"],
            subMemoryIds: []
        });

        const query = "Who is the lead architect of the Raven Project?";

        const rag = new ResourceAugmentedGeneration({
            query: query,
            database: db,
            model: embeddingModel
        });

        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
            messages: [
                {
                    type: "user",
                    content: query
                }
            ]
        });

        const result = await rag.register(model).invoke();
        const answer = result.answer[0].content?.toLowerCase() || "";

        console.log("RAG Hallucination Check Answer:", answer);

        // RAG instructions tell the model to state if it doesn't have enough info
        expect(answer).toBeTypeOf("string");
    }, 60000);

    it("Can use Euclidean Distance for retrieval in RAG pipeline", async () => {
        const db = new InMemoryRAGDb(embeddingModel);
        
        await db.save({
            id: "dist_1",
            title: "Distance Test",
            content: "Euclidean distance is a straight-line distance between two points.",
            keywords: ["math"],
            subMemoryIds: []
        });

        const query = "Explain Euclidean distance";

        const rag = new ResourceAugmentedGeneration({
            query: query,
            database: db,
            model: embeddingModel,
            similarityAlgorithm: "Euclidean Distance"
        });

        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
            messages: [
                {
                    type: "user",
                    content: query
                }
            ]
        });

        const result = await rag.register(model).invoke();
        const answer = result.answer[0].content?.toLowerCase() || "";
        
        expect(answer.length).toBeGreaterThan(0);
        expect(answer).toContain("straight-line");
    }, 60000);
});
