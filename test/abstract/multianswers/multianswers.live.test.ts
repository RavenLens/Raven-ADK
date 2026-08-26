import "dotenv/config";
import { describe, it, expect } from "vitest";
import { MultipleAnswers } from "../../../src/agent/abstract/multianswers/multipleanswers";
import { OpenAI } from "../../../src/models/text-to-text/openai";
import { MessagesVariations } from "../../../src/agent/state";

describe("MultipleAnswers Live Test", () => {
    const apiKey = process.env.OPENAI_API_KEY;
    
    it("should run parallel tasks and pick the best answer", async () => {
        if (!apiKey) {
            console.warn("Skipping live test: OPENAI_API_KEY not found");
            return;
        }

        const sharedContext: MessagesVariations[] = [
            { type: "user", content: "What is the capital of France?" }
        ];

        const runner = new MultipleAnswers([
            // Correct answer
            async () => ({
                messages: [
                    ...sharedContext,
                    { type: "ai", content: "The capital of France is Paris." }
                ]
            }),
            // Incorrect answer
            async () => ({
                messages: [
                    ...sharedContext,
                    { type: "ai", content: "The capital of France is London." }
                ]
            })
        ]);

        const evalConfig = {
            model: new OpenAI({
                apiKey,
                model: "gpt-5-mini"
            }),
            systemPrompt: "You are a helpful assistant evaluating answers about geography.",
            tools: []
        };

        await runner.invoke();
        const evaluations = await runner.evaluate(sharedContext, evalConfig);
        
        for (const ev of evaluations) {
            console.log(`Run ID: ${ev.id}`);
            console.log(`Content: ${ev.result.messages?.at(-1)?.content || ev.result.answer?.at(-1)?.content}`);
            console.log(`Score: ${ev.evaluation.result.score}`);
            console.log(`Reasoning: ${ev.evaluation.result.reasoning}`);
            console.log("---");
        }

        evaluations.sort((a, b) => b.evaluation.result.score - a.evaluation.result.score);
        const best = evaluations[0];
        
        expect(best.evaluation.result.score).toBeGreaterThan(0.8);
        expect(best.result.messages.at(-1).content).toContain("Paris");
    }, 60000);

    it("should emit events during the process", async () => {
        if (!apiKey) return;

        const sharedContext: MessagesVariations[] = [
            { type: "user", content: "Solve 2+2" }
        ];

        const runner = new MultipleAnswers([
            async () => ({
                answer: [{ type: "ai", content: "4" }]
            })
        ]);

        const events: string[] = [];
        runner.onEvent("start_run", () => events.push("start_run"));
        runner.onEvent("end_run", () => events.push("end_run"));
        runner.onEvent("evaluate_start", () => events.push("evaluate_start"));
        runner.onEvent("evaluate_end", () => events.push("evaluate_end"));

        const evalConfig = {
            model: new OpenAI({
                apiKey,
                model: "gpt-5-mini"
            }),
            systemPrompt: "Evaluate math answers.",
            tools: []
        };

        await runner.getBest(sharedContext, evalConfig);

        expect(events).toContain("start_run");
        expect(events).toContain("end_run");
        expect(events).toContain("evaluate_start");
        expect(events).toContain("evaluate_end");
    }, 60000);
});
