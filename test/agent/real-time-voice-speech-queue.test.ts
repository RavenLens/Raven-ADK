import { describe, expect, it, vi } from "vitest";
import { RealTimeVoiceAgent } from "../../src/agent/real-time-voice-agent/agent";

const clientID = "speech-queue-client";

function createDeferred<Result>() {
    let resolve!: (result: Result) => void;
    const promise = new Promise<Result>((complete) => {
        resolve = complete;
    });

    return { promise, resolve };
}

function createAgent(speechApproach: "blocking" | "flush", tts: (text: string) => Promise<Buffer | undefined>) {
    const agent = new RealTimeVoiceAgent({
        executionMode: {
            mode: "local",
            textEventsCommunicationCarrier: { type: "events" }
        },
        agent: {
            models: {
                stt: { model: {} as any, speechApproach },
                reasoning: {} as any,
                tts: { tts } as any
            },
            systemPrompt: "Test prompt",
            messages: [],
            tools: []
        }
    } as any);

    const audioFrames: Buffer[] = [];
    const events: Array<{ event: string; data: any }> = [];

    (agent as any).activeClients.set(clientID, {
        audioSource: {
            onData: ({ samples }: { samples: Buffer }) => audioFrames.push(samples)
        }
    });
    agent.clientsDataChannels.operand.set(clientID, {
        events: {
            send: (payload: string) => events.push(JSON.parse(payload))
        } as any
    });

    return { agent, audioFrames, events };
}

describe("RealTimeVoiceAgent speech queue", () => {
    it("plays blocking speech sequentially and releases its idle queue state", async () => {
        const tts = vi.fn(async (_text: string) => Buffer.alloc(640));
        const { agent, audioFrames, events } = createAgent("blocking", tts);

        const first = (agent as any).speak(clientID, "first", "result");
        const second = (agent as any).speak(clientID, "second", "result");

        await Promise.all([first, second]);

        expect(tts.mock.calls.map(([text]) => text)).toEqual(["first", "second"]);
        expect(audioFrames).toHaveLength(2);
        expect(events.map(({ event }) => event)).toEqual([
            "realtime_agent.speech_start",
            "realtime_agent.speech_segment",
            "realtime_agent.speech_end",
            "realtime_agent.speech_start",
            "realtime_agent.speech_segment",
            "realtime_agent.speech_end"
        ]);
        expect((agent as any).outputSpeechQueues.has(clientID)).toBe(false);
    });

    it("flushes a slow TTS request without sending its late audio", async () => {
        const slowAudio = createDeferred<Buffer>();
        const tts = vi.fn((text: string) => text === "old" ? slowAudio.promise : Promise.resolve(Buffer.alloc(640)));
        const { agent, audioFrames, events } = createAgent("flush", tts);

        const oldSpeech = (agent as any).speak(clientID, "old", "result");
        await Promise.resolve();

        const newSpeech = (agent as any).speak(clientID, "new", "result");
        await Promise.all([oldSpeech, newSpeech]);

        slowAudio.resolve(Buffer.alloc(640));
        await Promise.resolve();

        expect(tts.mock.calls.map(([text]) => text)).toEqual(["old", "new"]);
        expect(audioFrames).toHaveLength(1);
        expect(events).toContainEqual(expect.objectContaining({
            event: "realtime_agent.speech_interrupted",
            data: [{ clientID, reason: "flush" }]
        }));
        expect((agent as any).outputSpeechQueues.has(clientID)).toBe(false);
    });

    it("disposes a queue without waiting for an uncooperative TTS provider", async () => {
        const slowAudio = createDeferred<Buffer>();
        const { agent, audioFrames } = createAgent("blocking", () => slowAudio.promise);

        const speech = (agent as any).speak(clientID, "old", "result");
        await Promise.resolve();
        (agent as any).disposeSpeakQueue(clientID);

        await speech;
        slowAudio.resolve(Buffer.alloc(640));
        await Promise.resolve();

        expect(audioFrames).toHaveLength(0);
        expect((agent as any).outputSpeechQueues.has(clientID)).toBe(false);
    });
});