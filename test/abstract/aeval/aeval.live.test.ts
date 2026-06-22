import "dotenv/config";
import { describe, it, expect } from "vitest";
import { OpenAI } from "../../../src/models/openai";
import { ReActAgent } from "../../../src/agent/ReAct.agent";
import { AgenticEvaluator } from "../../../src/agent/abstract/aeval/aeval";
import { MessagesVariations } from "../../../src/agent/state";

/**
 * These tests require an OPENAI_API_KEY environment variable to run.
 * They are marked as .live to indicate they make real network requests.
 */
describe("AgenticEvaluator Live Tests", () => {
    const apiKey = process.env.OPENAI_API_KEY;
    const modelName = "gpt-4o";

    if (!apiKey) {
        it.skip("Skipping live tests because OPENAI_API_KEY is not set", () => {});
        return;
    }

    const model = new OpenAI({
        apiKey,
        model: modelName
    });

    it("should evaluate an AI response successfully", async () => {
        const messages: MessagesVariations[] = [
            { type: "user", content: "What is the capital of France?" },
            { type: "ai", content: "The capital of France is Paris. It is known for the Eiffel Tower and its rich culture." }
        ];

        const evaluator = new AgenticEvaluator(messages, {
            model,
            systemPrompt: "You are an objective AI response evaluator.",
            tools: [],
        });

        let evaluateStartEmitted = false;
        let evaluateEndEmitted = false;
        evaluator.onEvent("evaluate_start", () => { evaluateStartEmitted = true; });
        evaluator.onEvent("evaluate_end", (msg) => { 
            evaluateEndEmitted = true;
            expect(msg.type).toBe("ai");
            expect(msg.structuredOutput).toBeDefined();
        });

        const result = await evaluator.evaluate();

        expect(evaluateStartEmitted).toBe(true);
        expect(evaluateEndEmitted).toBe(true);
        expect(result.result).toBeDefined();
        expect(result.result.score).toBeGreaterThanOrEqual(0.1);
        expect(result.result.score).toBeLessThanOrEqual(1.0);
        expect(['BEST', 'GOOD', 'POOR', 'REJECTED']).toContain(result.result.verdict);
        expect(result.messages.length).toBeGreaterThan(0);
        console.log("Evaluation Result:", JSON.stringify(result.result, null, 2));
    }, 60000);

    it("should run the improvement loop successfully", async () => {
        // We simulate a "poor" initial response to see if it improves
        const messages: MessagesVariations[] = [
            { type: "user", content: "Explain quantum entanglement in exactly one sentence using simple words." },
            { type: "ai", content: "Quantum entanglement is a complex physical phenomenon where particles become correlated in ways that defies classical intuition, involving non-local connections and spooky action at a distance as Einstein once famously called it." }
        ];

        // This initial response is likely too long/complex for the "exactly one sentence" and "simple words" constraint.

        const evaluator = new AgenticEvaluator(messages, {
            model,
            systemPrompt: "You are a strict evaluator for conciseness and simplicity.",
            tools: []
        });

        let iterations: number[] = [];
        evaluator.onEvent("loop_iteration", (iter) => {
            iterations.push(iter);
            console.log(`Evaluator Loop Iteration: ${iter}`);
        });

        const runnerAgent = new ReActAgent({
            model,
            systemPrompt: "You are a helpful assistant that explains things simply.",
            messages: [...messages],
            tools: []
        });

        const loopResult = await evaluator.loop(
            runnerAgent,
            {
                score: 0.9,
                verdict: 'BEST',
                expectationDescription: "The explanation MUST be exactly one single sentence and use very simple words suitable for a child."
            },
            2 // allow 2 retries
        );

        expect(iterations.length).toBeGreaterThan(0);
        expect(iterations[0]).toBe(0);
        expect(loopResult.success).toBeDefined();
        console.log("Loop success:", loopResult.success);
        console.log("Final Message:", loopResult.reasoningMessages.at(-1)?.content);
        
        // Even if it doesn't hit 0.9, we check if it returned valid messages
        expect(loopResult.reasoningMessages.length).toBeGreaterThan(messages.length);
    }, 60000); // 60s timeout for live llm loops
});
