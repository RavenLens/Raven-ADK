import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import z4 from "zod/v4";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { OptionNode } from "../../src/chains/ToT/nodes";
import { BFSToT } from "../../src/chains/ToT/strategies/BFS";
import { DFSToT } from "../../src/chains/ToT/strategies/DFS";
import { BestFirstToT } from "../../src/chains/ToT/strategies/BestFirst";
import { MCTSToT } from "../../src/chains/ToT/strategies/MCTS";
import { MultiBeamToT } from "../../src/chains/ToT/strategies/MultiBeam";
import { OpenAI } from "../../src/models";

const structuredOutputSchema = z4.object({
    answer: z4.string(),
    confidence: z4.number()
});

const strategyCases = [
    ["BFS", () => new BFSToT({ topK: 1 })],
    ["DFS", () => new DFSToT(0.5)],
    ["Best-First", () => new BestFirstToT({ acceptanceTreshold: 0.5 })],
    ["Multi-Beam", () => new MultiBeamToT({ topK: 1 })],
    ["MCTS", () => new MCTSToT({ iterations: 0 })]
] as const;

describe("Tree of Thoughts structured output", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it.each(strategyCases)("uses the caller schema for %s and returns parsed option output", async (_name, createStrategy) => {
        const structuredOutput = {
            answer: "candidate answer",
            confidence: 0.91
        };
        const optionNode = {
            id: "ignored-id",
            type: "option-node" as const,
            content: "candidate reasoning",
            zodSchema: structuredOutput
        };
        let generatedOptionId: string | undefined;
        let optionGenerationSchema: z4.ZodTypeAny | undefined;

        const tot = new TreeOfThoughts({
            query: "Return a structured answer",
            initialOptionsCount: 1,
            earlyExitThreshold: 0.9,
            graphSearchAlgorithm: createStrategy(),
            optionGenerator: {} as any,
            thoughtGenerator: {} as any,
            evaluator: {} as any
        });

        tot.onEvent("optionGenerated", (option: OptionNode) => {
            generatedOptionId = option.id;
        });

        tot.callableUnitInvokeStructured = async (unitName, schema) => {
            if (unitName === "optionGenerator") {
                optionGenerationSchema = schema;
                return {
                    type: "ai",
                    content: "",
                    structuredOutput: { options: [optionNode] }
                } as any;
            }

            return {
                type: "ai",
                content: "",
                structuredOutput: {
                    ratings: [{
                        id: generatedOptionId,
                        rate: {
                            decision: "the-best",
                            score: 0.99,
                            justification: "Matches the requested result"
                        }
                    }]
                }
            } as any;
        };

        const result = await tot.invokeStructuredOutput(structuredOutputSchema);

        expect(optionGenerationSchema).toBeDefined();
        expect(optionGenerationSchema!.safeParse({ options: [optionNode] }).success).toBe(true);
        expect(optionGenerationSchema!.safeParse({
            options: [{ ...optionNode, zodSchema: { answer: 123, confidence: "invalid" } }]
        }).success).toBe(false);
        expect(result.allOptions).toHaveLength(1);
        expect(result.theBestOption.zodSchema).toEqual(structuredOutput);
        expect(result.allOptions[0].zodSchema).toEqual(structuredOutput);
        expect(structuredOutputSchema.parse(result.theBestOption.zodSchema)).toEqual(structuredOutput);
    });
});

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("Tree of Thoughts structured output with OpenAI", () => {
    it("returns a schema-validated structured option from a live model", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!
        });

        const tot = new TreeOfThoughts({
            query: "Recommend one programming language for someone learning to code. Return a concise answer and a confidence score between 0 and 1.",
            initialOptionsCount: 1,
            maxThoughtsDepth: 1,
            thoughtsCount: 1,
            earlyExitThreshold: 0,
            graphSearchAlgorithm: new BFSToT({ topK: 1 }),
            optionGenerator: model,
            thoughtGenerator: model,
            evaluator: model
        });

        const result = await tot.invokeStructuredOutput(structuredOutputSchema);
        const structuredOption = structuredOutputSchema.parse(result.theBestOption.zodSchema);
        console.log(result)

        expect(result.theBestOption.type).toBe("option-node");
        expect(result.allOptions).toHaveLength(1);
        expect(structuredOption.answer).toEqual(expect.any(String));
        expect(structuredOption.answer.length).toBeGreaterThan(0);
        expect(structuredOption.confidence).toEqual(expect.any(Number));
        expect(structuredOption.confidence).toBeGreaterThanOrEqual(0);
        expect(structuredOption.confidence).toBeLessThanOrEqual(1);
    }, 180_000);
});
