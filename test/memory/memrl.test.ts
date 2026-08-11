import { describe, expect, it } from "vitest";
import { MemRL, type MemRLResourceType, type MemRLScoreStore } from "../../src/agent/memory/systems/memrl";

describe("MemRL", () => {
    it("re-ranks semantic candidates after outcome feedback updates a Q-score", async () => {
        const memory = new MemRL({
            name: "Deployment episodes",
            purpose: "Learn which deployment approaches work.",
            learningRate: 0.5,
            utilityWeight: 0.8
        });
        const candidates = [
            {
                resourceId: "strategy-a",
                resourceType: "memory" as const,
                similarity: 0.9,
                content: "Use strategy A."
            },
            {
                resourceId: "strategy-b",
                resourceType: "memory" as const,
                similarity: 0.8,
                content: "Use strategy B."
            }
        ];

        const firstRetrieval = await memory.retrieve(candidates, { scope: "deploy" });
        expect(firstRetrieval.candidates.map(candidate => candidate.candidate.resourceId)).toEqual(["strategy-a", "strategy-b"]);

        await memory.selectCandidates(firstRetrieval.trace.traceId, [{
            resourceId: "strategy-b",
            resourceType: "memory"
        }]);
        await memory.applyFeedback(firstRetrieval.trace.traceId, 1);

        const secondRetrieval = await memory.retrieve(candidates, { scope: "deploy" });
        expect(secondRetrieval.candidates.map(candidate => candidate.candidate.resourceId)).toEqual(["strategy-b", "strategy-a"]);
        expect(secondRetrieval.candidates[0].qScore).toBe(0.75);
    });

    it("keeps learned Q-scores isolated to their retrieval scope", async () => {
        const memory = new MemRL({
            name: "Deployment episodes",
            purpose: "Learn which deployment approaches work.",
            learningRate: 0.5
        });
        const candidate = {
            resourceId: "strategy-a",
            resourceType: "memory" as const,
            similarity: 0.8,
            content: "Use strategy A."
        };

        const deployTrace = await memory.retrieve([candidate], { scope: "deploy" });
        await memory.applyFeedback(deployTrace.trace.traceId, 1);

        expect((await memory.getQScore(candidate, "deploy")).qScore).toBe(0.75);
        expect((await memory.getQScore(candidate, "rollback")).qScore).toBe(0.5);
    });

    it("admits only semantic top-K candidates at or above the similarity threshold", async () => {
        const queriedResourceIds: string[] = [];
        const scoreStore = {
            async get(scope: string, resourceType: MemRLResourceType, resourceId: string) {
                queriedResourceIds.push(resourceId);
                return undefined;
            },
            async set() {}
        } satisfies MemRLScoreStore;
        const memory = new MemRL({
            name: "Deployment episodes",
            purpose: "Learn which deployment approaches work.",
            topK: 3,
            similarityThreshold: 0.8,
            scoreStore
        });
        const candidates = [
            { resourceId: "highest", resourceType: "memory" as const, similarity: 0.95, content: "Highest match" },
            { resourceId: "second", resourceType: "memory" as const, similarity: 0.9, content: "Second match" },
            { resourceId: "third", resourceType: "memory" as const, similarity: 0.85, content: "Third match" },
            { resourceId: "boundary", resourceType: "memory" as const, similarity: 0.8, content: "Boundary match" },
            { resourceId: "below-threshold", resourceType: "memory" as const, similarity: 0.79, content: "Excluded match" }
        ];

        const cappedRetrieval = await memory.retrieve(candidates, { scope: "deploy" });
        expect(cappedRetrieval.candidates.map(candidate => candidate.candidate.resourceId)).toEqual(["highest", "second", "third"]);
        expect(queriedResourceIds).toEqual(["highest", "second", "third"]);

        queriedResourceIds.length = 0;
        const boundaryRetrieval = await memory.retrieve(candidates, { scope: "deploy", topK: 4 });
        expect(boundaryRetrieval.candidates.map(candidate => candidate.candidate.resourceId)).toEqual(["highest", "second", "third", "boundary"]);
        expect(queriedResourceIds).toEqual(["highest", "second", "third", "boundary"]);
    });

    it("adapts semantic retrieval into deterministic agent-aware context", async () => {
        const memory = new MemRL({
            name: "Deployment episodes",
            purpose: "Learn which deployment approaches work.",
            topK: 2,
            similarityThreshold: 0.8,
            candidateProvider: async (_, context) => {
                expect(context.semanticSearch).toEqual({
                    topK: 2,
                    similarityThreshold: 0.8
                });

                return {
                scope: "deploy",
                candidates: [{
                    resourceId: "strategy-a",
                    resourceType: "memory",
                    similarity: 0.9,
                    content: "Use a rolling deployment."
                }]
                };
            }
        });

        const outcome = await memory.beforeOrchestratorAgentRun({
            contextAgentState: {
                messages: []
            }
        });

        expect(outcome).toEqual([{
            memoryInformations: [expect.stringContaining("Use a rolling deployment.")],
            attchToAgentAwareness: true
        }]);
    });

    it("returns an empty trace when semantic retrieval has no candidates", async () => {
        const memory = new MemRL({
            name: "Deployment episodes",
            purpose: "Learn which deployment approaches work."
        });

        const retrieval = await memory.retrieve([], { scope: "deploy" });

        expect(retrieval.candidates).toEqual([]);
        expect(retrieval.trace.candidates).toEqual([]);
        expect(retrieval.trace.selectedResources).toEqual([]);
    });
});