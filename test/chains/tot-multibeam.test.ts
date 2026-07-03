import { describe, it, expect, vi, beforeEach } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { MultiBeamToT } from "../../src/chains/ToT/strategies/MultiBeam";
import { OptionNode, ThoughtNode } from "../../src/chains/ToT/nodes";
import * as crypto from "node:crypto";

vi.mock("node:crypto", () => ({
    randomUUID: vi.fn(),
}));

describe("Tree of Thoughts - Multi-Beam Logic Unit Test", () => {
    let mockGenerator: any;
    let mockEvaluator: any;

    beforeEach(() => {
        // Simple mock implementation for callable units
        mockGenerator = {
            agentConfig: { messages: [] },
            invokeStructuredOutput: vi.fn()
        };
        mockEvaluator = {
            agentConfig: { messages: [] },
            invokeStructuredOutput: vi.fn()
        };
    });

    it("should correctly trigger events and follow BFS logic with mocked outputs", async () => {        // Mock UUIDs for predictable testing
        const mockedUUIDs = ["opt-1-uuid", "opt-2-uuid", "opt-3-uuid", "opt-4-uuid", "th-1-uuid"];
        let uuidIndex = 0;
        (crypto.randomUUID as any).mockImplementation(() => mockedUUIDs[uuidIndex++]);
        const events = {
            optionGenerated: vi.fn(),
            optionEvaluated: vi.fn(),
            thoughtsGenerated: vi.fn(),
            thoughtEvaluated: vi.fn(),
            optionsPruned: vi.fn(),
            thoughtsPruned: vi.fn(),
            finalOptionSelected: vi.fn(),
        };

        // Mock option generation - 2 calls expected
        const optionGenOutput = {
            messages: [{
                type: "ai",
                structuredOutput: {
                    options: [
                        { id: "ignored-1", type: "option-node", content: "Option 1" },
                        { id: "ignored-2", type: "option-node", content: "Option 2" }
                    ]
                }
            }]
        };
        mockGenerator.invokeStructuredOutput.mockResolvedValueOnce(optionGenOutput);
        mockGenerator.invokeStructuredOutput.mockResolvedValueOnce(optionGenOutput);

        // Mock option evaluation (rateNodes)
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    ratings: [
                        { id: "opt-1-uuid", rate: { decision: "good", score: 0.9, justification: "Great" } },
                        { id: "opt-2-uuid", rate: { decision: "good", score: 0.8, justification: "Good" } },
                        { id: "opt-3-uuid", rate: { decision: "good", score: 0.7, justification: "Meh" } },
                        { id: "opt-4-uuid", rate: { decision: "good", score: 0.6, justification: "Nah" } }
                    ]
                }
            }]
        });

        // Mock getTheBestOptions (pruning)
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    topOptions: [{ id: "opt-1-uuid", type: "option-node", content: "Option 1" }]
                }
            }]
        });

        // Mock thought generation for the branch
        mockGenerator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    thoughts: [
                        { id: "ignored-th-1", type: "though-node", content: "Step 1", dependingThoughNodes: [] }
                    ]
                }
            }]
        });

        // Mock thought evaluation
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    ratings: [
                        { id: "th-1-uuid", rate: { decision: "good", score: 0.95, justification: "Logical step" } }
                    ]
                }
            }]
        });

        // Mock getTheBestThoughts (pruning)
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    topThoughts: [{ id: "th-1-uuid", type: "though-node", content: "Step 1", dependingThoughNodes: [] }]
                }
            }]
        });

        // Mock final scoring for the branch (before final selection)
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    ratings: [
                        { id: "opt-1-uuid", rate: { decision: "good", score: 0.99, justification: "Verified chain" } }
                    ]
                }
            }]
        });

        // Mock final selection
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            messages: [{
                type: "ai",
                structuredOutput: {
                    theBestOption: [{ id: "opt-1-uuid", type: "option-node", content: "Option 1" }]
                }
            }]
        });

        // ToT instance is needed because callableUnitInvokeStructured checks for instance type
        // We'll mock the internal call instead of passing the plain mock object
        const tot = new TreeOfThoughts({
            query: "test",
            initialOptionsCount: 2,
            maxThoughtsDepth: 1,
            thoughtsCount: 1,
            graphSearchAlgorithm: new MultiBeamToT({ topK: 1, pruneAtBegining: true }),
            optionGenerator: mockGenerator as any,
            thoughtGenerator: mockGenerator as any,
            evaluator: mockEvaluator as any
        });

        // Register all events
        Object.keys(events).forEach(evt => tot.onEvent(evt as any, events[evt as keyof typeof events]));

        // Override callableUnitInvokeStructured to bypass the ReActAgent vs AgentModel checks for this unit test
        tot.callableUnitInvokeStructured = async (unit, schema, instruction) => {
            const target = unit === "evaluator" ? mockEvaluator : mockGenerator;
            const res = await target.invokeStructuredOutput(schema);
            return res.messages[0];
        };

        const result = await tot.invoke();

        expect(result.theBestOption.content).toBe("Option 1");
        expect(result.reasoningChains.length).toBe(1); // topK is 1
        expect(result.allOptions.length).toBe(4); // 2 calls * 2 options each

        expect(events.optionGenerated).toHaveBeenCalled();
        expect(events.optionEvaluated).toHaveBeenCalled();
        expect(events.optionsPruned).toHaveBeenCalled();
        expect(events.thoughtsGenerated).toHaveBeenCalled();
        expect(events.thoughtEvaluated).toHaveBeenCalled();
        expect(events.thoughtsPruned).toHaveBeenCalled();
        expect(events.finalOptionSelected).toHaveBeenCalled();
    });
});
