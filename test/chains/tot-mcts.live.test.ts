import "dotenv/config";
import { describe, it, expect } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { MCTSToT } from "../../src/chains/ToT/strategies/MCTS";
import { OpenAI } from "../../src/models/text-to-text/openai";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("Tree of Thoughts - MCTS Live Test", () => {
    it("should successfully execute an MCTS reasoning process with OpenAI", async () => {
        const apiKey = openAIApiKey!;
        
        // Define logs to track event emission
        const logs: string[] = [];

        // Common model for all units
        const model = new OpenAI({
            model: "gpt-5-mini", // Requested by user
            apiKey: apiKey
        });

        const tot = new TreeOfThoughts({
            query: "How should a distributed system handle accidental data corruption in a zero-trust environment?",
            initialOptionsCount: 2,
            maxThoughtsDepth: 2,
            thoughtsCount: 2,
            graphSearchAlgorithm: new MCTSToT({ 
                iterations: 5,
                explorationConstant: 1.414
            }),
            optionGenerator: model,
            thoughtGenerator: model,
            evaluator: model,
        });

        // Register events to verify they are being called
        tot.onEvent("optionGenerated", (option) => {
            console.log('Option generated', option.content.substring(0, 50) + "...")
            logs.push(`Option Generated: ${option.content.substring(0, 50)}...`);
        });

        tot.onEvent("optionEvaluated", (option) => {
            console.log(`Option Evaluated: ${option.id} - Score: ${option.initialRate?.score}`);
            logs.push(`Option Evaluated: ${option.id} - Score: ${option.initialRate?.score}`);
        });

        tot.onEvent("thoughtsGenerated", (forNode, thoughts) => {
            console.log(`Thoughts Generated for ${forNode.type === 'option-node' ? 'Option' : 'Thought'}: ${thoughts.length} thoughts`);
            logs.push(`Thoughts Generated for ${forNode.type === 'option-node' ? 'Option' : 'Thought'}: ${thoughts.length} thoughts`);
        });

        tot.onEvent("thoughtEvaluated", (thought) => {
            console.log(`Thought Evaluated: ${thought.id} - Score: ${thought.rate?.score}`);
            logs.push(`Thought Evaluated: ${thought.id} - Score: ${thought.rate?.score}`);
        });

        tot.onEvent("finalOptionSelected", (option) => {
            console.log(`Final Option Selected: ${option.content.substring(0, 100)}...`);
            logs.push(`Final Option Selected: ${option.content.substring(0, 50)}...`);
        });

        try {
            console.log("Invoking MCTS ToT...")
            const result = await tot.invoke();

            console.log("Final Result:", result.theBestOption.content);

            expect(result.theBestOption).toBeDefined();
            expect(result.theBestOption.type).toBe("option-node");
            expect(result.allOptions.length).toBeGreaterThan(0);
            expect(result.reasoningChains.length).toBeGreaterThan(0);
            
            // Check if events were triggered
            expect(logs.some(l => l.includes("Option Generated"))).toBe(true);
            expect(logs.some(l => l.includes("Option Evaluated"))).toBe(true);
            expect(logs.some(l => l.includes("Thoughts Generated"))).toBe(true);
        } catch (error) {
            console.error("Test failed with error:", error);
            throw error;
        }
    }, 500_000); 
});
