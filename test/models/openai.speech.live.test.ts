import "dotenv/config";
import { describe, expect, it } from "vitest";
import { OpenAISTT } from "../../src/models/speech-to-text/openai";
import { OpenAITTS } from "../../src/models/text-to-speech/openai";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;
const phrase = "Raven ADK speech round trip test.";

liveDescribe("OpenAI speech models live API", () => {
    it("synthesizes speech and transcribes the generated audio", async () => {
        const tts = new OpenAITTS({
            model: "gpt-4o-mini-tts",
            apiKey: openAIApiKey,
            voice: "alloy",
            outputFormat: "wav"
        });
        const stt = new OpenAISTT({
            model: "gpt-4o-mini-transcribe",
            apiKey: openAIApiKey
        });

        const audio = await tts.synthesize(phrase);
        expect(audio).toBeInstanceOf(Buffer);
        expect(audio.byteLength).toBeGreaterThan(1000);

        const transcription = await stt.transcribe(audio, {
            mimeType: "audio/wav",
            prompt: phrase
        });

        expect(transcription.trim().length).toBeGreaterThan(0);
        expect(transcription.toLowerCase()).toContain("raven");
        expect(transcription.toLowerCase()).toContain("speech");
    }, 500_000);
});