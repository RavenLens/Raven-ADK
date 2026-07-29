import { describe, expect, it, vi } from "vitest";
import { RealTimeVoiceAgent } from "../../src/agent/real-time-voice-agent/agent";
import { RealTimeVoiceAgentSchemaMemoryStore } from "../../src/agent/real-time-voice-agent/agentConfig";
import { OpenAI } from "../../src/models/openai";

const clientID = "voice-events-client";

function createVoiceAgent(reasoning: OpenAI, memory?: RealTimeVoiceAgentSchemaMemoryStore) {
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
            memory: memory ? () => memory : undefined,
            tools: [],
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
        transcript: "Use your memory",
        audioBuffer: Buffer.alloc(0)
    });

    await completed;
}

describe("RealTimeVoiceAgent event speech", () => {
    it("speaks reasoning events without an internal thought plugin", async () => {
        const reasoning = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });
        vi.spyOn(reasoning, "invoke").mockImplementation(async (options) => {
            const messages = options?.messages ?? reasoning.config.messages ?? [];
            (reasoning as any).emitEvent("reasoning", "I am checking the request.");
            const aiMessage = { type: "ai" as const, content: "Done." };

            return {
                messages: [...messages, aiMessage],
                answer: [aiMessage],
                tokens: { input: 10, output: 5, reasoning: 0 }
            };
        });
        const { agent, tts } = createVoiceAgent(reasoning);

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toContain("I am checking the request.");
        });
    });

    it("speaks configured memory actions from memory_action events", async () => {
        const memory: RealTimeVoiceAgentSchemaMemoryStore = {
            config: {
                hasToRemember: "",
                actionsVoiceDescriptionInstruction: {
                    fetchMemory: {
                        speakAfter: {
                            defaultInstruction: (memoryName, action, _details, result) => `${memoryName}:${action}:${Array.isArray(result) ? result.length : 0}`
                        }
                    }
                }
            },
            fetchMemoryConclusionFile: vi.fn().mockResolvedValue(""),
            writeMemoryConclusionFile: vi.fn().mockResolvedValue(true),
            fetchMemory: vi.fn().mockResolvedValue([{
                id: "memory-1",
                title: "Preference",
                content: "Prefers concise replies",
                keywords: [],
                subMemoryIds: []
            }]),
            saveMemory: vi.fn().mockResolvedValue(true)
        };
        let callCount = 0;
        const reasoning = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });
        vi.spyOn(reasoning, "invoke").mockImplementation(async (options) => {
            const messages = options?.messages ?? reasoning.config.messages ?? [];
            callCount++;
            const aiMessage = callCount === 1
                ? {
                    type: "ai" as const,
                    content: "",
                    calledTools: [{
                        tool_id: "memory-fetch",
                        tool_name: "fetch_memory",
                        arguments: { mode: "semantic", words: ["preference"] }
                    }]
                }
                : { type: "ai" as const, content: "Memory complete." };

            return {
                messages: [...messages, aiMessage],
                answer: [aiMessage],
                tokens: { input: 10, output: 5, reasoning: 0 }
            };
        });
        const { agent, tts } = createVoiceAgent(reasoning, memory);

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toContain("default:fetch:1");
        });
        expect(tts.mock.calls.map(([text]) => text)).not.toContain("Let me check my memory for a moment");
    });
});