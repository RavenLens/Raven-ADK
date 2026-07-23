import { describe, it, expect, vi } from "vitest";
import { OpenAISTTModel } from "../../src/agent/real-time-voice-agent/stt/openai";
import { DeepgramSTTModel } from "../../src/agent/real-time-voice-agent/stt/deepgram";
import { ElevenLabsSTTModel } from "../../src/agent/real-time-voice-agent/stt/elevenlabs";
import { CustomSTTModel } from "../../src/agent/real-time-voice-agent/stt/custom";

describe("STT Models Test Suite", () => {
    it("CustomSTTModel interim and volatile execution", async () => {
        const mockInterim = vi.fn().mockResolvedValue({
            text: "Hello world interim",
            isFinal: true,
            confidence: 0.98
        });

        const custom = new CustomSTTModel({
            providerName: "TestProvider",
            modelName: "test-v1",
            transcribeInterimFn: mockInterim
        });

        expect(custom.provider).toBe("TestProvider");
        expect(custom.modelName).toBe("test-v1");

        const audioBuf = Buffer.from("mock-audio");
        const res = await custom.transcribeInterim(audioBuf);
        expect(res.text).toBe("Hello world interim");
        expect(mockInterim).toHaveBeenCalledWith(audioBuf, undefined);

        async function* generateChunks() {
            yield Buffer.from("chunk1");
            yield Buffer.from("chunk2");
        }

        const volatileResults = [];
        for await (const result of custom.transcribeVolatile(generateChunks())) {
            volatileResults.push(result);
        }

        expect(volatileResults.length).toBe(1);
        expect(volatileResults[0].text).toBe("Hello world interim");
    });

    it("OpenAISTTModel instantiates correctly with whisper-1", () => {
        const model = new OpenAISTTModel({ apiKey: "test-key" });
        expect(model.provider).toBe("OpenAI");
        expect(model.modelName).toBe("whisper-1");
    });

    it("DeepgramSTTModel instantiates correctly with nova-3", () => {
        const model = new DeepgramSTTModel({ apiKey: "test-key" });
        expect(model.provider).toBe("Deepgram");
        expect(model.modelName).toBe("nova-3");
    });

    it("ElevenLabsSTTModel instantiates correctly with scribe_v1", () => {
        const model = new ElevenLabsSTTModel({ apiKey: "test-key" });
        expect(model.provider).toBe("ElevenLabs");
        expect(model.modelName).toBe("scribe_v1");
    });
});
