import "dotenv/config";
import { describe, expect, it } from "vitest";
import { OpenAI } from "../../src/models/openai";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("OpenAI Live API", () => {
    it("Common output (text generation)", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
            messages: [
                {
                    type: "user",
                    content: "Say 'Hello Raven' and nothing else."
                }
            ]
        });

        const result = await model.invoke();
        const content = result.answer[0].content;
        console.log('Model answer', content)

        expect(content?.toLowerCase()).toContain("hello raven");
    }, 60000);

    it("Streaming output", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
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
            if (chunk.type === "response.output_text.delta") {
                fullContent += (chunk as any).delta;
            }
        }

        expect(fullContent.length).toBeGreaterThan(0);
    }, 60000);
});
