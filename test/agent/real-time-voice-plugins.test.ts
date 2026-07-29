import { describe, expect, it, vi } from "vitest";
import { RealTimeVoiceAgent } from "../../src/agent/real-time-voice-agent/agent";
import { RealTimeVoiceAgentPluginSpec } from "../../src/agent/real-time-voice-agent/agentConfig";
import { OpenAI } from "../../src/models/openai";

const clientID = "plugin-voice-client";

function createVoiceAgent(voiceConfig?: RealTimeVoiceAgentPluginSpec["describeVoiceInstruction"]) {
    const reasoning = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });
    vi.spyOn(reasoning, "invoke").mockImplementation(async (options) => {
        const messages = options?.messages ?? reasoning.config.messages ?? [];
        const aiMessage = { type: "ai" as const, content: "Plugin work is complete." };

        return {
            messages: [...messages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 10, output: 5, reasoning: 0 }
        };
    });

    const plugin: RealTimeVoiceAgentPluginSpec = {
        name: "status-plugin",
        executionWay: "before_agent_run",
        execute: async () => ({ status: true }),
        describeVoiceInstruction: voiceConfig
    };
    const tts = vi.fn(async () => Buffer.alloc(640));
    const agent = new RealTimeVoiceAgent({
        executionMode: {
            mode: "local",
            textEventsCommunicationCarrier: { type: "events" }
        },
        communicationSpeechLevels: "all",
        agent: {
            models: {
                stt: { model: {} as any, speechApproach: "blocking" },
                reasoning,
                tts: { tts } as any
            },
            systemPrompt: "Test prompt",
            messages: [],
            tools: [],
            plugins: [plugin],
            withConclusion: false
        }
    } as any);

    (agent as any).activeClients.set(clientID, {
        audioSource: { onData: () => undefined },
        authParams: { query: {}, headers: {} },
        logicAbortController: null
    });
    agent.clientsDataChannels.operand.set(clientID, {
        events: { send: () => undefined } as any
    });

    return { agent, tts };
}

async function invokeVoiceAgent(agent: RealTimeVoiceAgent<any, any, any>) {
    const completed = new Promise<void>((resolve) => {
        agent.onRealTimeVoiceAgentEvents("logic_finish", () => resolve());
    });

    (agent as any).internalEvents.emit("stt_transcript_final", {
        clientID,
        transcript: "Run the plugin",
        audioBuffer: Buffer.alloc(0)
    });

    await completed;
}

describe("RealTimeVoiceAgent plugin speech", () => {
    it("uses default narration when a plugin has no voice override", async () => {
        const { agent, tts } = createVoiceAgent();

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining([
                "I'm using status-plugin plugin to help you",
                "I've executed status-plugin plugin and successfully retrieved output"
            ]));
        });
    });

    it("uses configured plugin instructions with the lifecycle result", async () => {
        const { agent, tts } = createVoiceAgent({
            speakBefore: {
                defaultInstruction: (pluginName, executionWay) => `Starting ${pluginName} at ${executionWay}`
            },
            speakAfter: {
                defaultInstruction: (pluginName, executionWay, result) => `Finished ${pluginName} at ${executionWay}; ${result?.status ? "result received" : "result missing"}`
            }
        });

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining([
                "Starting status-plugin at before_agent_run",
                "Finished status-plugin at before_agent_run; result received"
            ]));
        });
    });

    it("does not announce a plugin result when speakAfter is disabled", async () => {
        const { agent, tts } = createVoiceAgent({
            speakBefore: {
                defaultInstruction: "Starting status plugin"
            },
            speakAfter: false
        });

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toContain("Starting status plugin");
        });
        expect(tts.mock.calls.map(([text]) => text)).not.toContain("I've executed status-plugin plugin and successfully retrieved output");
    });
});