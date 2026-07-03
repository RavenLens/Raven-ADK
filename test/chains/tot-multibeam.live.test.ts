import "dotenv/config";
import { describe, it, expect } from "vitest";
import { TreeOfThoughts } from "../../src/chains/ToT/ToT";
import { MultiBeamToT } from "../../src/chains/ToT/strategies/MultiBeam";
import { OpenAI } from "../../src/models/openai";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("Tree of Thoughts - Multi-Beam Live Test", () => {
    it("should successfully execute a Multi-Beam reasoning process with OpenAI", async () => {
        const apiKey = openAIApiKey!;
        
        // Define logs to track event emission
        const logs: string[] = [];

        // Common model for all units
        const model = new OpenAI({
            model: "gpt-4o-mini", // Correcting the model name to a valid one
            apiKey: apiKey
        });


        const tot = new TreeOfThoughts({
            query: "What are the three most significant technological advancements in the 21st century and why?",
            initialOptionsCount: 2,
            maxThoughtsDepth: 2,
            thoughtsCount: 2,
            graphSearchAlgorithm: new MultiBeamToT({ 
                topK: 1,
                pruneAtBegining: true 
            }),
            optionGenerator: model,
            thoughtGenerator: model,
            evaluator: model,
        });

        // Register events to verify they are being called
        tot.onEvent("optionGenerated", (option) => {
            console.log('Option generated', option)
            logs.push(`Option Generated: ${option.content}`);
        });

        tot.onEvent("optionEvaluated", (option) => {
            console.log(`Option Evaluated: ${option.content} - Initial Score: ${option.initialRate?.score}, Final Score: ${option.finalRate?.score}`);
            logs.push(`Option Evaluated: ${option.content} - Initial Score: ${option.initialRate?.score}, Final Score: ${option.finalRate?.score}`);
        });

        tot.onEvent("thoughtsGenerated", (forNode, thoughts) => {
            console.log(`Thoughts Generated for ${forNode.type === 'option-node' ? 'Option' : 'Thought'}: ${thoughts.length} thoughts`);
            logs.push(`Thoughts Generated for ${forNode.type === 'option-node' ? 'Option' : 'Thought'}: ${thoughts.length} thoughts`);
        });

        tot.onEvent("thoughtEvaluated", (thought) => {
            console.log(`Thought Evaluated: ${thought.content.substring(0, 50)}... - Score: ${thought.rate?.score}`);
            logs.push(`Thought Evaluated: ${thought.content.substring(0, 50)}... - Score: ${thought.rate?.score}`);
        });

        tot.onEvent("optionsPruned", (all, topK) => {
            console.log(`Options Pruned: ${all.length} -> ${topK.length}`);
            logs.push(`Options Pruned: ${all.length} -> ${topK.length}`);
        });

        tot.onEvent("thoughtsPruned", (root, path, all, topK) => {
            console.log(`Thoughts Pruned: ${all.length} -> ${topK.length}`);
            logs.push(`Thoughts Pruned: ${all.length} -> ${topK.length}`);
        });

        tot.onEvent("finalOptionSelected", (option) => {
            console.log(`Final Option Selected: ${option.content}`);
            logs.push(`Final Option Selected: ${option.content}`);
        });

        try {
            console.log("Before invoke")
            const result = await tot.invoke();

            console.log("Full Event Log:\n", logs.join("\n"));
            console.log("Final Result:", result.theBestOption.content);

            expect(result.theBestOption).toBeDefined();
            expect(result.theBestOption.type).toBe("option-node");
            expect(result.theBestOption.content).toBeDefined();
            expect(result.theBestOption.finalRate).toBeDefined();
            expect(result.allOptions.length).toBeGreaterThan(0);
            expect(result.reasoningChains.length).toBeGreaterThan(0);
            
            // Check if essential Multi-Beam events were triggered
            expect(logs.some(l => l.includes("Option Generated"))).toBe(true);
            expect(logs.some(l => l.includes("Option Evaluated"))).toBe(true);
        } catch (error) {
            console.error("Test failed with error:", error);
            console.log("Full Event Log until crash:\n", logs.join("\n"));
            throw error;
        }
        expect(logs.some(l => l.includes("Options Pruned"))).toBe(true);
        expect(logs.some(l => l.includes("Final Option Selected"))).toBe(true);
    }, 500_000_000); 
});
