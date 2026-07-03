import "dotenv/config";
import { describe, it, expect } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { DFSToT } from "../../src/chains/ToT/strategies/DFS";
import { OpenAI } from "../../src/models/openai";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("Tree of Thoughts - DFS Live Test", () => {
    it("should successfully execute a DFS reasoning process with OpenAI", async () => {
        const apiKey = openAIApiKey!;
        const logs: string[] = [];

        const model = new OpenAI({
            model: "gpt-4o-mini",
            apiKey: apiKey
        });

        const tot = new TreeOfThoughts({
            query: "Explain the concept of 'Backtracking' in the context of DFS in 3 deep steps.",
            initialOptionsCount: 1,
            maxThoughtsDepth: 2,
            thoughtsCount: 1,
            graphSearchAlgorithm: new DFSToT(0.6),
            optionGenerator: model,
            thoughtGenerator: model,
            evaluator: model,
        });

        tot.onEvent("optionGenerated", (opt) => {
            console.log("DFS Option:", opt.content);
            logs.push(`Option: ${opt.content}`);
        });

        tot.onEvent("thoughtEvaluated", (thought) => {
            console.log(`DFS Thought Evaluated: ${thought.id} - Score: ${thought.rate?.score}`);
            logs.push(`Thought: ${thought.id} - Score: ${thought.rate?.score}`);
        });

        tot.onEvent("backtrack" as any, (path: any[], node: any) => {
            console.log(`DFS Backtracking from: ${node.id}`);
            logs.push(`Backtrack: ${node.id}`);
        });

        try {
            const result = await tot.invoke();
            console.log("DFS Final Answer:", result.theBestOption.content);

            expect(result.theBestOption).toBeDefined();
            expect(result.reasoningChains).toBeDefined();
        } catch (error) {
            console.error("DFS Live Test Error:", error);
            throw error;
        }
    }, 300_000);
});
