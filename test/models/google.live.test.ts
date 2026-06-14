import "dotenv/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Google } from "../../src/models/google";
import { AIMessage } from "../../src/agent/state";
import { GoogleGenAI } from "@google/genai";

const googleApiKey = (process.env.GEMINI_API_KEY_RAVENADK || process.env.GOOGLE_API_KEY)?.trim();

if (!googleApiKey || googleApiKey === "") {
    console.warn("GEMINI_API_KEY is not set or empty in .env. Live tests will be skipped.");
}

const liveDescribe = (googleApiKey && googleApiKey.length > 0) ? describe : describe.skip;

liveDescribe("Google Gemini live integration", () => {
    it("returns a text answer from the live API", async () => {
        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: googleApiKey!,
            messages: [
                {
                    type: "user",
                    content: "Say 'Hello Raven' and nothing else."
                }
            ]
        });

        const result = await model.invoke();
        const content = (result.answer[0] as AIMessage).content;

        expect(result.answer[0].type).toBe("ai");
        expect(content?.toLowerCase()).toContain("hello raven");
    }, 60000);

    it("returns parsed structuredOutput from the live API", async () => {
        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: googleApiKey!,
            messages: [
                {
                    type: "user",
                    content: "Return a JSON object with city and country for Berlin, Germany."
                }
            ]
        });

        const schema = z.object({
            city: z.string(),
            country: z.string()
        });

        const result = await model.invokeStructuredOutput(schema);
        const structuredOutput = (result.answer[0] as AIMessage).structuredOutput;

        expect(result.answer[0].type).toBe("ai");
        expect(structuredOutput).toBeDefined();
        
        const parsed = schema.parse(structuredOutput);
        expect(parsed.city.toLowerCase()).toContain("berlin");
        expect(parsed.country.toLowerCase()).toContain("germany");
    }, 60000);
});
