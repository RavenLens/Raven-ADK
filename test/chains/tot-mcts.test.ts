import { describe, it, expect, vi, beforeEach } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { MCTSToT } from "../../src/chains/ToT/strategies/MCTS";
import { OptionNode, ThoughtNode } from "../../src/chains/ToT/nodes";
import * as crypto from "node:crypto";

vi.mock("node:crypto", () => ({
    randomUUID: vi.fn(),
}));

describe("Tree of Thoughts - MCTS Logic Unit Test", () => {
    let mockGenerator: any;
    let mockEvaluator: any;

    beforeEach(() => {
        mockGenerator = {
            agentConfig: { messages: [] },
            invokeStructuredOutput: vi.fn(),
            typeAPI: "model",
            config: { messages: [] }
        };
        mockEvaluator = {
            agentConfig: { messages: [] },
            invokeStructuredOutput: vi.fn(),
            typeAPI: "model",
            config: { messages: [] }
        };
    });

    it("should correctly trigger events and follow MCTS logic with mocked outputs", async () => {
        // Mock UUIDs
        let uuidCounter = 0;
        (crypto.randomUUID as any).mockImplementation(() => `uuid-${uuidCounter++}`);

        const events = {
            optionGenerated: vi.fn(),
            optionEvaluated: vi.fn(),
            thoughtsGenerated: vi.fn(),
            thoughtEvaluated: vi.fn(),
        };

        // 1. Initial Options Generation
        mockGenerator.invokeStructuredOutput.mockResolvedValueOnce({
            answer: [{
                type: "ai",
                structuredOutput: {
                    options: [
                        { id: "opt-1", type: "option-node", content: "Option 1" },
                        { id: "opt-2", type: "option-node", content: "Option 2" }
                    ]
                }
            }]
        });

        // 2. Initial Ratings for options
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            answer: [{
                type: "ai",
                structuredOutput: {
                    ratings: [{ id: "uuid-0", rate: { decision: "good", score: 0.8, justification: "J1" } }]
                }
            }]
        });
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            answer: [{
                type: "ai",
                structuredOutput: {
                    ratings: [{ id: "uuid-1", rate: { decision: "good", score: 0.7, justification: "J2" } }]
                }
            }]
        });

        // 3. MCTS Iteration 1 (Selection picks Opt 1, Expansion generates thoughts)
        mockGenerator.invokeStructuredOutput.mockResolvedValueOnce({
            answer: [{
                type: "ai",
                structuredOutput: {
                    thoughts: [
                        { id: "th-1", type: "though-node", content: "Thought 1.1", dependingThoughNodes: [] },
                        { id: "th-2", type: "though-node", content: "Thought 1.2", dependingThoughNodes: [] }
                    ]
                }
            }]
        });

        // 4. Evaluation of new thoughts in expansion
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            answer: [{
                type: "ai",
                structuredOutput: {
                    ratings: [{ id: "uuid-2", rate: { decision: "good", score: 0.9, justification: "J3" } }]
                }
            }]
        });
        mockEvaluator.invokeStructuredOutput.mockResolvedValueOnce({
            answer: [{
                type: "ai",
                structuredOutput: {
                    ratings: [{ id: "uuid-3", rate: { decision: "good", score: 0.6, justification: "J4" } }]
                }
            }]
        });

        const tot = new TreeOfThoughts({
            query: "Test Query",
            initialOptionsCount: 2,
            graphSearchAlgorithm: new MCTSToT({ 
                iterations: 1, // Run 1 iteration for simplicity
                explorationConstant: 1.414 
            }),
            optionGenerator: mockGenerator,
            thoughtGenerator: mockGenerator,
            evaluator: mockEvaluator,
        });

        tot.onEvent("optionGenerated", events.optionGenerated);
        tot.onEvent("optionEvaluated", events.optionEvaluated);
        tot.onEvent("thoughtsGenerated", events.thoughtsGenerated);
        tot.onEvent("thoughtEvaluated", events.thoughtEvaluated);

        const result = await tot.invoke();

        expect(result.theBestOption).toBeDefined();
        // With iterations=1, it selection picks uuid-0 (Opt 1) because it has higher initial score/visits aren't used yet in selection for first pick?
        // Actually logic() selects rootId children after they are rated.
        
        expect(events.optionGenerated).toHaveBeenCalledTimes(2);
        expect(events.optionEvaluated).toHaveBeenCalledTimes(2);
        expect(events.thoughtsGenerated).toHaveBeenCalledTimes(1);
        expect(events.thoughtEvaluated).toHaveBeenCalledTimes(2);
    });
});
