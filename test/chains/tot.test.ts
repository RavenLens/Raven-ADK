import { describe, it, expect, vi } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT.Example";

describe("TreeOfThoughts", () => {
    it("should solve a simple path finding problem using BFS", async () => {
        const events = {
            thoughtGenerated: vi.fn(),
            thoughtEvaluated: vi.fn(),
            backtrack: vi.fn()
        };

        const tot = new TreeOfThoughts<string, string>({
            graphSearchAlgorithm: "bfs",
            runner: (state) => {
                if (state === "start") return ["A", "B"];
                if (state === "A") return ["A2", "A1"];
                if (state === "B") return ["B1"];
                return [];
            },
            evaluator: (thought) => {
                if (thought === "A1") return { score: 1, verdict: "sure" };
                if (thought === "B") return { score: 0.5, verdict: "likely" };
                if (thought === "A") return { score: 0.5, verdict: "likely" };
                if (thought === "A2") return { score: 0, verdict: "rejected" };
                return { score: 0.2, verdict: "likely" };
            },
            events
        });

        const result = await tot.solve("start");

        expect(result).toBe("A1");
        expect(events.thoughtGenerated).toHaveBeenCalledWith("A", { level: 1 });
        expect(events.thoughtEvaluated).toHaveBeenCalledWith("A2", expect.objectContaining({ verdict: "rejected" }));
        expect(events.backtrack).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining("rejected") }));
    });

    it("should solve a simple path finding problem using DFS", async () => {
        const tot = new TreeOfThoughts<number, number>({
            graphSearchAlgorithm: "dfs",
            runner: (state) => [state + 1, state + 2],
            evaluator: (thought) => {
                if (thought === 5) return { score: 1, verdict: "sure" };
                return { score: 0.5, verdict: "likely" };
            },
            maxDepth: 5
        });

        const result = await tot.solve(0);
        expect(result).toBe(5);
    });
});
