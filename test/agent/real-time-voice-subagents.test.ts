import { describe, expect, it, vi } from "vitest";
import { RealTimeVoiceAgent } from "../../src/agent/real-time-voice-agent/agent";
import type { RealTimeVoiceSubAgent } from "../../src/agent/real-time-voice-agent/agentConfig";
import { tool } from "../../src/agent/tools/tools";
import { OpenAI } from "../../src/models/openai";
import * as z from "zod";

const clientID = "subagent-voice-client";

function createModelResponses() {
    let mainCallCount = 0;
    const mainModel = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });
    vi.spyOn(mainModel, "invoke").mockImplementation(async (options) => {
        const messages = options?.messages ?? mainModel.config.messages ?? [];
        mainCallCount++;

        const aiMessage = mainCallCount === 1
            ? { type: "ai" as const, content: "[[RAVEN_CALL_SUBAGENT]] Researcher | Find Mars facts" }
            : { type: "ai" as const, content: "Mars is cold." };

        return {
            messages: [...messages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 10, output: 5, reasoning: 0 }
        };
    });

    const subagentModel = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });
    vi.spyOn(subagentModel, "invoke").mockImplementation(async (options) => {
        const messages = options?.messages ?? subagentModel.config.messages ?? [];
        const aiMessage = { type: "ai" as const, content: "Mars is cold." };

        return {
            messages: [...messages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 5, output: 5, reasoning: 0 }
        };
    });

    return { mainModel, subagentModel };
}

function createVoiceAgent(speakAfter?: boolean) {
    const { mainModel, subagentModel } = createModelResponses();
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
                reasoning: mainModel,
                tts: { tts } as any
            },
            systemPrompt: "Test prompt",
            messages: [],
            tools: [],
            withConclusion: false,
            subagents: [{
                role: "Researcher",
                roleDescription: "Finds facts",
                model: subagentModel,
                systemPrompt: "Research prompt",
                tools: [],
                describeVoiceInstruction: speakAfter === undefined ? undefined : {
                    speakBefore: {
                        defaultInstruction: (role, instruction) => `Starting ${role}: ${instruction}`
                    },
                    speakAfter: speakAfter
                        ? { defaultInstruction: (role, instruction, result) => `Finished ${role}: ${instruction}; ${result ? "result received" : "result missing"}` }
                        : false
                }
            }]
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

function createToolUsingVoiceAgent() {
    let mainCallCount = 0;
    const mainModel = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });
    vi.spyOn(mainModel, "invoke").mockImplementation(async (options) => {
        const messages = options?.messages ?? mainModel.config.messages ?? [];
        mainCallCount++;
        const aiMessage = mainCallCount === 1
            ? { type: "ai" as const, content: "[[RAVEN_CALL_SUBAGENT]] Researcher | Find Mars facts" }
            : { type: "ai" as const, content: "Mars is cold." };

        return {
            messages: [...messages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 10, output: 5, reasoning: 0 }
        };
    });

    let subagentCallCount = 0;
    const subagentModel = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });
    vi.spyOn(subagentModel, "invoke").mockImplementation(async (options) => {
        const messages = options?.messages ?? subagentModel.config.messages ?? [];
        subagentCallCount++;
        const aiMessage = subagentCallCount === 1
            ? {
                type: "ai" as const,
                content: "",
                calledTools: [{
                    tool_id: "sub-search",
                    tool_name: "sub_search",
                    arguments: { query: "Mars" }
                }]
            }
            : { type: "ai" as const, content: "Mars is cold." };

        return {
            messages: [...messages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 5, output: 5, reasoning: 0 }
        };
    });

    const subagentTool = tool(
        async ({ query }) => `Info for ${query}`,
        {
            toolName: "sub_search",
            toolDescription: "Searches for subagent facts",
            toolArguments: z.object({ query: z.string() })
        }
    );
    const subagent: RealTimeVoiceSubAgent = {
        role: "Researcher",
        roleDescription: "Finds facts",
        model: subagentModel,
        systemPrompt: "Research prompt",
        tools: [subagentTool],
        describeVoiceInstruction: {
            toolCalls: {
                speakBefore: {
                    defaultInstruction: (toolName, toolParams) => `Starting ${toolName}: ${toolParams.query}`
                },
                speakAfter: {
                    defaultInstruction: (toolName, _toolParams, toolOutput) => `Finished ${toolName}: ${toolOutput}`
                }
            }
        }
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
                reasoning: mainModel,
                tts: { tts } as any
            },
            systemPrompt: "Test prompt",
            messages: [],
            tools: [],
            withConclusion: false,
            subagents: [subagent]
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
        transcript: "Tell me about Mars",
        audioBuffer: Buffer.alloc(0)
    });

    await completed;
}

describe("RealTimeVoiceAgent subagent speech", () => {
    it("uses default narration when a subagent has no voice override", async () => {
        const { agent, tts } = createVoiceAgent();

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining([
                "I'm delegating this task to my specialist Researcher",
                "I've received the result from my specialist Researcher"
            ]));
        });
    });

    it("uses configured before and after subagent voice instructions", async () => {
        const { agent, tts } = createVoiceAgent(true);

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining([
                "Starting Researcher: Find Mars facts",
                "Finished Researcher: Find Mars facts; result received"
            ]));
        });
    });

    it("does not announce a subagent result when speakAfter is disabled", async () => {
        const { agent, tts } = createVoiceAgent(false);

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toContain("Starting Researcher: Find Mars facts");
        });
        const spokenTexts = tts.mock.calls.map(([text]) => text);
        expect(spokenTexts.some((text) => text.startsWith("Finished Researcher:"))).toBe(false);
        expect(spokenTexts).not.toContain("I've received the result from my specialist Researcher");
    });

    it("maps configured subagent tool speech positions to tool lifecycle events", async () => {
        const { agent, tts } = createToolUsingVoiceAgent();

        await invokeVoiceAgent(agent);

        await vi.waitFor(() => {
            expect(tts.mock.calls.map(([text]) => text)).toEqual(expect.arrayContaining([
                "Starting sub_search: Mars",
                "Finished sub_search: Info for Mars"
            ]));
        });
    });
});