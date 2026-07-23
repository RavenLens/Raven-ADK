import { describe, it, expect, vi } from "vitest";
import { RealTimeVoiceAgent } from "../../src/agent/real-time-voice-agent/agent";
import { CustomSTTModel } from "../../src/agent/real-time-voice-agent/stt/custom";

describe("RealTimeVoiceAgent STT Pipeline Unblocking Integration Test", () => {
    it("runs volatile streaming STT unblockingly on onSpeechStart and finalizes on onSpeechEnd", async () => {
        const interimTranscripts: string[] = [];
        let finalTranscriptReceived = "";

        const mockCustomSTT = new CustomSTTModel({
            providerName: "TestSTT",
            modelName: "test-volatile",
            transcribeInterimFn: async (audio) => {
                return {
                    text: "Final full audio transcript",
                    isFinal: true
                };
            },
            transcribeVolatileFn: async function* (stream) {
                for await (const chunk of stream) {
                    yield {
                        text: `chunk:${chunk.toString()}`,
                        isFinal: false
                    };
                }
            }
        });

        const agent = new RealTimeVoiceAgent({
            executionMode: {
                mode: "local",
                textEventsCommunicationCarrier: { type: "events" }
            },
            agent: {
                models: {
                    stt: mockCustomSTT,
                    sttMode: "volatile",
                    reasoning: {} as any,
                    tts: {} as any
                },
                systemPrompt: "Test prompt",
                messages: [],
                tools: [],
                abort: new AbortController().signal
            }
        });

        (agent as any).internalEvents.on("stt-transcript-interim", (data: any) => {
            interimTranscripts.push(data.transcript);
        });

        (agent as any).internalEvents.on("stt-transcript-final", (data: any) => {
            finalTranscriptReceived = data.transcript;
        });

        const clientID = "client-123";

        // 1. User starts speaking (unblocking call)
        (agent as any).onSpeechStart(clientID, Date.now());

        // 2. Stream subchunks in real-time unblockingly
        agent.pushAudioChunk(clientID, Buffer.from("hello"));
        agent.pushAudioChunk(clientID, Buffer.from("world"));

        // Allow microtask queue to yield volatile results
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(interimTranscripts).toContain("chunk:hello");
        expect(interimTranscripts).toContain("chunk:world");

        // 3. User stops speaking
        await (agent as any).onSpeechEnd(clientID, Date.now());

        expect(finalTranscriptReceived).toBe("Final full audio transcript");
    });
});
