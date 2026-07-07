import "dotenv/config";
import { describe, it, expect } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { BestFirstToT } from "../../src/chains/ToT/strategies/BestFirst";
import { OpenAI } from "../../src/models/openai";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("Tree of Thoughts - Best-First Live Test", () => {
    it("should successfully execute a Best-First reasoning process with OpenAI", async () => {
        const apiKey = openAIApiKey!;
        
        const logs: string[] = [];
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: apiKey
        });

        const tot = new TreeOfThoughts({
            query: "Solve this riddle: I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?",
            initialOptionsCount: 2,
            maxThoughtsDepth: 2,
            thoughtsCount: 2,
            earlyExitThreshold: 0.9, 
            graphSearchAlgorithm: new BestFirstToT({ 
                acceptanceTreshold: 0.4
            }),
            optionGenerator: model,
            thoughtGenerator: model,
            evaluator: model,
        });

        tot.onEvent("optionGenerated", (option) => {
            console.log('Option generated', option.content.substring(0, 50) + "...")
            logs.push(`Option Generated: ${option.id}`);
        });

        tot.onEvent("optionEvaluated", (option) => {
            console.log(`Option Evaluated: ${option.id} - Score: ${option.initialRate?.score}`);
            logs.push(`Option Evaluated: ${option.id} - Score: ${option.initialRate?.score}`);
        });

        tot.onEvent("thoughtsGenerated", (forNode, thoughts) => {
            console.log(`Thoughts Generated for ${forNode.type}: ${thoughts.length}`);
            logs.push(`Thoughts Generated for ${forNode.type}`);
        });

        tot.onEvent("thoughtEvaluated", (thought) => {
            console.log(`Thought Evaluated: ${thought.id} - Score: ${thought.rate?.score}`);
            logs.push(`Thought Evaluated: ${thought.id} - Score: ${thought.rate?.score}`);
        });

        tot.onEvent("finalOptionSelected", (option) => {
            console.log(`Final Option Selected: ${option.content.substring(0, 100)}...`);
            logs.push(`Final Option Selected`);
        });

        try {
            console.log("Invoking Best-First ToT...")
            const result = await tot.invoke();

            console.log("Final Result:", result.theBestOption.content);

            expect(result.theBestOption).toBeDefined();
            expect(result.allOptions.length).toBeGreaterThan(0);
            
            expect(logs.some(l => l.includes("Option Generated"))).toBe(true);
            expect(logs.some(l => l.includes("Option Evaluated"))).toBe(true);
            
            // Note: Thoughts Generated might not happen if earlyExitThreshold is met immediately
            expect(logs.some(l => l.includes("Final Option Selected"))).toBe(true);
        } catch (error) {
            console.error("Test failed:", error);
            throw error;
        }
    }, 600_000); 
});
