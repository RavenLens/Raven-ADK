import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TreeOfThoughts } from '../../src/chains/ToT/ToT';
import { BestFirstToT } from '../../src/chains/ToT/strategies/BestFirst';
import * as crypto from 'node:crypto';

vi.mock('node:crypto', () => ({
    randomUUID: vi.fn(),
}));

describe('Tree of Thoughts - Best-First Logic Unit Test', () => {
    let mockGenerator: any;
    let mockEvaluator: any;

    beforeEach(() => {
        mockGenerator = {
            typeAPI: 'model',
            config: { messages: [] },
            invokeStructuredOutput: vi.fn()
        };
        mockEvaluator = {
            typeAPI: 'model',
            config: { messages: [] },
            invokeStructuredOutput: vi.fn()
        };
    });

    it('should correctly follow Best-First logic: expanding the highest scored node first', async () => {
        const mockedUUIDs = ['opt-A-uuid', 'opt-B-uuid', 'th-B1-uuid', 'th-A1-uuid'];
        let uuidIndex = 0;
        (crypto.randomUUID as any).mockImplementation(() => {
            if (uuidIndex < mockedUUIDs.length) return mockedUUIDs[uuidIndex++];
            return 'gen-uuid-' + (uuidIndex++);
        });

        const mockResp = (output: any) => ({
            answer: [{
                type: 'ai',
                structuredOutput: output
            }]
        });

        let evCallCount = 0;
        mockEvaluator.invokeStructuredOutput.mockImplementation(async (schema: any) => {
            evCallCount++;
            if (evCallCount === 1) {
                return mockResp({
                    options: [
                        { id: 'ignored', type: 'option-node', content: 'Option A' },
                        { id: 'ignored', type: 'option-node', content: 'Option B' }
                    ]
                });
            }
            if (evCallCount === 2) {
                return mockResp({
                    ratings: [
                        { id: 'opt-A-uuid', rate: { decision: 'good', score: 0.7, justification: 'Okay' } },
                        { id: 'opt-B-uuid', rate: { decision: 'good', score: 0.9, justification: 'Excellent' } }
                    ]
                });
            }
            if (evCallCount === 3) {
                return mockResp({
                    ratings: [
                        { id: 'th-B1-uuid', rate: { decision: 'good', score: 0.6, justification: 'Drop' } }
                    ]
                });
            }
            if (evCallCount === 4) {
                return mockResp({
                    ratings: [
                        { id: 'th-A1-uuid', rate: { decision: 'excellent', score: 0.95, justification: 'Perfect' } }
                    ]
                });
            }
            return mockResp({});
        });

        let genCallCount = 0;
        mockGenerator.invokeStructuredOutput.mockImplementation(async (schema: any) => {
            genCallCount++;
            if (genCallCount === 1) {
                return mockResp({
                    thoughts: [
                        { id: 'skipped', type: 'though-node', content: 'Thought B1', dependingThoughNodes: [] }
                    ]
                });
            }
            if (genCallCount === 2) {
                return mockResp({
                    thoughts: [
                        { id: 'skipped', type: 'though-node', content: 'Thought A1', dependingThoughNodes: [] }
                    ]
                });
            }
            return mockResp({});
        });

        const tot = new TreeOfThoughts({
            query: 'Test',
            initialOptionsCount: 2,
            maxThoughtsDepth: 3,
            earlyExitThreshold: 0.95,
            graphSearchAlgorithm: new BestFirstToT({ 
                acceptanceTreshold: 0.5
            }),
            optionGenerator: mockEvaluator,
            thoughtGenerator: mockGenerator,
            evaluator: mockEvaluator,
        });

        const finalSelection = vi.fn();
        tot.onEvent('finalOptionSelected', finalSelection);

        const result = await tot.invoke();

        expect(result.theBestOption.id).toBe('opt-A-uuid');
        expect(genCallCount).toBe(2);
        expect(finalSelection).toHaveBeenCalledWith(expect.objectContaining({ id: 'opt-A-uuid' }));
    });
});
