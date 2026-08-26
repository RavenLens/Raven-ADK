import "dotenv/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunPod } from "../../src/models/text-to-text/runpod";
import { AIMessage } from "../../src/agent/state";

const runpodApiKey = process.env.RUNPOD_API_KEY?.trim();
const runpodEndpointId = process.env.RUNPOD_ENDPOINT_ID?.trim();
const runpodModel = process.env.RUNPOD_MODEL?.trim() || "unknown";

const isConfigured = runpodApiKey && runpodEndpointId;

if (!isConfigured) {
    console.warn("RUNPOD_API_KEY or RUNPOD_ENDPOINT_ID is not set. RunPod live tests will be skipped.");
}

const liveDescribe = isConfigured ? describe : describe.skip;

liveDescribe("RunPod live integration", () => {
    it("returns a text answer from the live API", async () => {
        const model = new RunPod({
            model: runpodModel,
            apiKey: runpodApiKey!,
            endpointId: runpodEndpointId!,
            messages: [
                {
                    type: "user",
                    content: "Say 'Hello from RunPod' and nothing else."
                }
            ]
        });

        const result = await model.invoke();
        const content = (result.answer[0] as AIMessage).content;

        expect(result.answer[0].type).toBe("ai");
        expect(content).toBeTypeOf("string");
    }, 60000);

    it("returns parsed structuredOutput from the live API", async () => {
        const model = new RunPod({
            model: runpodModel,
            apiKey: runpodApiKey!,
            endpointId: runpodEndpointId!,
            messages: [
                {
                    type: "user",
                    content: "Return a JSON object with city and country for Paris, France. Return ONLY the JSON."
                }
            ]
        });

        const schema = z.object({
            city: z.string(),
            country: z.string()
        });

        const result = await model.invokeStructuredOutput(schema);
        const content = (result.answer[0] as AIMessage).content;

        expect(result.answer[0].type).toBe("ai");
        
        // The invokeStructuredOutput might return the JSON string or the model might have been prompted to return it.
        // Usually invokeStructuredOutputWithRetries handles the parsing if the model supports tool calls or if it's fallback mode.
        // RunPod in this ADK seems to rely on text extraction.
        
        try {
            const parsed = JSON.parse(content!);
            expect(parsed.city).toBe("Paris");
            expect(parsed.country).toBe("France");
        } catch (e) {
            // If it's not raw JSON, it might be wrapped in markdown
            const jsonMatch = content?.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                expect(parsed.city).toBe("Paris");
                expect(parsed.country).toBe("France");
            } else {
                throw new Error(`Failed to parse JSON from response: ${content}`);
            }
        }
    }, 90000);

    it("streams responses from the live API", async () => {
        const model = new RunPod({
            model: runpodModel,
            apiKey: runpodApiKey!,
            endpointId: runpodEndpointId!,
            messages: [
                {
                    type: "user",
                    content: "Count from 1 to 3."
                }
            ]
        });

        const stream = await model.invoke({ stream: true });
        let chunkCount = 0;

        for await (const chunk of stream) {
             if (chunk) {
                chunkCount++;
             }
        }

        expect(chunkCount).toBeGreaterThan(0);
    }, 60000);
});
