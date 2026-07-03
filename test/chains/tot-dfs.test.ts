import { describe, it, expect, vi, beforeEach } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { DFSToT } from "../../src/chains/ToT/strategies/DFS";
import * as crypto from "node:crypto";

vi.mock("node:crypto", () => ({
    randomUUID: vi.fn(),
}));

describe("Tree of Thoughts - DFS Logic Unit Test", () => {
    let mockGenerator: any;
    let mockEvaluator: any;

    beforeEach(() => {
        mockGenerator = {
            agentConfig: { messages: [] },
            invokeStructuredOutput: vi.fn()
        };
        mockEvaluator = {
            agentConfig: { messages: [] },
            invokeStructuredOutput: vi.fn()
        };
    });

    it("should correctly backtrack when threshold is not met and explore deep when it is", async () => {
        const mockedUUIDs = ["opt-1-uuid", "th-1-uuid", "th-2-uuid"];
        let uuidIdx = 0;
        (crypto.randomUUID as any).mockImplementation(() => mockedUUIDs[uuidIdx++] || `gen-${uuidIdx}`);

        const events = {
            optionGenerated: vi.fn(),
            optionEvaluated: vi.fn(),
            thoughtsGenerated: vi.fn(),
            thoughtEvaluated: vi.fn(),
            backtrack: vi.fn(),
            finalOptionSelected: vi.fn(),
        };

        // 1. Option Generation
        mockGenerator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    options: [{ id: "opt-1", content: "Option 1" }]
                }
            }]
        });

        // 2. Option Evaluation (above threshold 0.7)
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    ratings: [{ id: "opt-1-uuid", rate: { score: 0.8, decision: "good" } }]
                }
            }]
        });

        // 3. Thought Generation (Depth 1)
        mockGenerator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    thoughts: [{ id: "th-1", content: "Step 1" }]
                }
            }]
        });

        // 4. Thought Evaluation (below threshold 0.7 -> should backtrack)
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    ratings: [{ id: "th-1-uuid", rate: { score: 0.5, decision: "bad" } }]
                }
            }]
        });

        const tot = new TreeOfThoughts({
            query: "test",
            initialOptionsCount: 1,
            maxThoughtsDepth: 2,
            thoughtsCount: 1,
            graphSearchAlgorithm: new DFSToT(0.7),
            optionGenerator: mockGenerator as any,
            thoughtGenerator: mockGenerator as any,
            evaluator: mockEvaluator as any
        });

        Object.keys(events).forEach(evt => tot.onEvent(evt as any, events[evt as keyof typeof events]));
        tot.callableUnitInvokeStructured = async (unit, schema, instr) => {
            const target = unit === "evaluator" ? mockEvaluator : mockGenerator;
            const res = await target.invokeStructuredOutput(schema);
            return res.messages[0];
        };

        const result = await tot.invoke();

        expect(events.backtrack).toHaveBeenCalled();
        expect(result.allOptions.length).toBe(1);
    });
});
