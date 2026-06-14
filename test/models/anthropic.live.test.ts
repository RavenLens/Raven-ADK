import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Anthropic } from "../../src/models/anthropic";

const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
const liveDescribe = anthropicApiKey ? describe : describe.skip;

liveDescribe("Anthropic Live API", () => {
    it("Common output (text generation)", async () => {
        const model = new Anthropic({
            model: "claude-4.8-haiku-latest",
            apiKey: anthropicApiKey!,
            messages: [
                {
                    type: "user",
                    content: "Say 'Hello Raven' and nothing else."
                }
            ]
        });

        const result = await model.invoke();
        const content = result.answer[0].content;

        expect(content?.toLowerCase()).toContain("hello raven");
    }, 60000);

    it("Streaming output", async () => {
        const model = new Anthropic({
            model: "claude-4.8-haiku-latest",
            apiKey: anthropicApiKey!,
            messages: [
                {
                    type: "user",
                    content: "Write a short poem about ravens."
                }
            ]
        });

        const stream = await model.invoke({ stream: true });
        let fullContent = "";
        
        for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
                fullContent += chunk.delta.text;
            }
        }

        expect(fullContent.length).toBeGreaterThan(0);
    }, 60000);

    it("Thinking (Reasoning) output", async () => {
        const model = new Anthropic({
            model: "claude-4.8-haiku-latest",
            apiKey: anthropicApiKey!,
            thinking: {
                type: "enabled",
                budget_tokens: 1024
            },
            messages: [
                {
                    type: "user",
                    content: "Think about why ravens are so smart, then tell me your conclusion."
                }
            ]
        });

        const result = await model.invoke();
        
        // Find thinking message
        const thinkingMessage = result.answer.find(m => m.type === "thinking");
        const aiMessage = result.answer.find(m => m.type === "ai");

        expect(thinkingMessage).toBeDefined();
        expect(thinkingMessage?.content?.length).toBeGreaterThan(0);
        expect(aiMessage?.content?.length).toBeGreaterThan(0);
    }, 120000);
});
