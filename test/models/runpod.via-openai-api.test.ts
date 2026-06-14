import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAI } from "../../src/models/openai";

const runpodApiKey = process.env.RUNPOD_API_KEY?.trim();
const runpodEndpointId = process.env.RUNPOD_ENDPOINT_ID?.trim();
const runpodModel = process.env.RUNPOD_MODEL?.trim() || "unknown";

describe("Call RunPod via OpenAI API", () => {
    it("Common output", async () => {
        const model = new OpenAI({
            model: runpodModel,
            apiKey: runpodApiKey,
            baseURL: `https://api.runpod.ai/v2/${runpodEndpointId}/openai/v1`,
            messages: [
                {
                    type: "user",
                    content: "Could you tell me who has started the 2 World War? Was he a criminal?"
                }
            ]
        });

        const result = await model.invoke();
        const content = result.answer[0].content;

        expect(content).toBeTypeOf("string");
        console.log(content)
    }, 120000)
})
