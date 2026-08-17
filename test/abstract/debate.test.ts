import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Graph, GraphMarkers } from "../../src/graph";
import {
    AgentDebateType,
    StructuredAgentDebate,
} from "../../src/agent";
import { AgentsDebate as AgentsDebateClass } from "../../src/agent/abstract/agentsdebate";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { OpenAI } from "../../src/models/text-to-text/openai";
import type { MessagesVariations } from "../../src/agent/state";
import z from "zod/v4";

const messages: MessagesVariations[] = [
    { type: "user", content: "Solve this task" }
];

const invokeDebateAgent = <Result>(
    logic: StructuredAgentDebate<Result>,
    options: { messages: MessagesVariations[] }
) => new AgentsDebateClass<any>({ agents: [], messages: options.messages }).invokeDebateAgent(
    logic,
    z.any(),
    options
);

describe("AgentsDebate executable participants", () => {
    it("invokes a custom callback participant", async () => {
        const logic: StructuredAgentDebate<string> = {
            invokeStructuredOutput: (_schema, { messages: context }) => {
            const lastMessage = context.at(-1);
            return lastMessage?.type === "user" && typeof lastMessage.content === "string"
                ? lastMessage.content
                : "";
            }
        };

        await expect(invokeDebateAgent(logic, { messages })).resolves.toBe("Solve this task");
    });

    it("invokes an object-based participant", async () => {
        const logic: StructuredAgentDebate<number> = {
            invokeStructuredOutput: (_schema, { messages: context }) => context.length
        };

        await expect(invokeDebateAgent(logic, { messages })).resolves.toBe(1);
    });

    it("accepts a startable graph participant", async () => {
        const graph = new Graph({ value: 0 });
        graph
            .addNode("increment", () => ({ stateUpdate: { value: 1 } }))
            .addEdge(GraphMarkers.START, "increment")
            .addEdge("increment", GraphMarkers.END);

        const participant: AgentDebateType = {
            name: "graph-agent",
            description: "Runs a graph workflow",
            debateBoundary: {},
            tokenizer: content => Math.ceil(content.length / 4),
            agentLogic: {
                invokeStructuredOutput: async () => {
                    await graph.start();
                    return { participate: true, continueConversation: false, messages: [] };
                }
            }
        };

        await invokeDebateAgent(participant.agentLogic, { messages });

        expect(graph.getState()).toEqual({ value: 1 });
    });
});

describe("AgentsDebate conversation protocol", () => {
    it("lets agents abstain initially and continue through bounded rounds", async () => {
        let abstainingCalls = 0;
        let participatingCalls = 0;
        const tokenizedContent: string[] = [];
        const tokenizer = (content: string) => {
            tokenizedContent.push(content);
            return 1;
        };
        const agents: AgentDebateType[] = [
            {
                name: "abstaining-agent",
                description: "Does not participate",
                debateBoundary: { maxRounds: 2, tokens: 1000, timeMs: 1000 },
                tokenizer,
                agentLogic: {
                    invokeStructuredOutput: () => {
                    abstainingCalls++;
                    return {
                        participate: false,
                        continueConversation: true,
                        messages: [{ type: "ai", content: "must not enter the room" }]
                    };
                    }
                }
            },
            {
                name: "participating-agent",
                description: "Participates for two rounds",
                debateBoundary: { maxRounds: 2, tokens: 1000, timeMs: 1000 },
                tokenizer,
                agentLogic: {
                    invokeStructuredOutput: () => {
                    participatingCalls++;
                    return {
                        participate: true,
                        continueConversation: participatingCalls === 1,
                        messages: [{ type: "ai", content: `round ${participatingCalls}` }]
                    };
                    }
                }
            }
        ];
        const debate = new AgentsDebateClass<any>({
            agents,
            messages,
            debateMutualBoundaries: { maxRounds: 2, tokens: 2000, timeMs: 2000 }
        });

        const room = await (debate as any).spawnDebate(
            agents.map(agent => agent.name),
            "Discuss the task",
            "Decide whether to participate and contribute when useful."
        );

        expect(abstainingCalls).toBe(1);
        expect(participatingCalls).toBe(2);
        expect(room.some((message: MessagesVariations) =>
            message.type === "ai" && message.content === "must not enter the room"
        )).toBe(false);
        expect(room.some((message: MessagesVariations) =>
            message.type === "ai" && message.content === "round 2"
        )).toBe(true);
        expect(tokenizedContent).toContain("round 1");
        expect(tokenizedContent).toContain("round 2");
    });

    it("enforces each agent's own maximum round boundary", async () => {
        let singleRoundCalls = 0;
        let continuingCalls = 0;
        const agents: AgentDebateType[] = [
            {
                name: "single-round-agent",
                description: "Can participate only once",
                debateBoundary: { maxRounds: 1 },
                tokenizer: () => 1,
                agentLogic: {
                    invokeStructuredOutput: () => {
                        singleRoundCalls++;
                        return {
                            participate: true,
                            continueConversation: true,
                            messages: [{ type: "ai", content: "single round" }]
                        };
                    }
                }
            },
            {
                name: "continuing-agent",
                description: "Continues for two rounds",
                debateBoundary: { maxRounds: 2 },
                tokenizer: () => 1,
                agentLogic: {
                    invokeStructuredOutput: () => {
                        continuingCalls++;
                        return {
                            participate: true,
                            continueConversation: continuingCalls === 1,
                            messages: [{ type: "ai", content: `continuing ${continuingCalls}` }]
                        };
                    }
                }
            }
        ];
        const debate = new AgentsDebateClass<any>({ agents, messages });

        await (debate as any).spawnDebate(
            agents.map(agent => agent.name),
            "Discuss the task",
            "Contribute when useful."
        );

        expect(singleRoundCalls).toBe(1);
        expect(continuingCalls).toBe(2);
    });

        it("repeats critique and revision for the configured number of loops", async () => {
            let executionCalls = 0;
            let critiqueCalls = 0;
            const agents: AgentDebateType[] = [
                {
                    name: "executor",
                    description: "Executes and revises the task",
                    debateBoundary: { maxRounds: 1 },
                    tokenizer: () => 1,
                    agentLogic: {
                        invokeStructuredOutput: () => {
                            executionCalls++;
                            return {
                                participate: true,
                                continueConversation: false,
                                messages: [{ type: "ai", content: `answer ${executionCalls}` }]
                            };
                        }
                    }
                },
                {
                    name: "critic",
                    description: "Reviews the answer",
                    debateBoundary: { maxRounds: 1 },
                    tokenizer: () => 1,
                    agentLogic: {
                        invokeStructuredOutput: () => {
                            critiqueCalls++;
                            return {
                                participate: true,
                                continueConversation: false,
                                messages: [{ type: "ai", content: `critique ${critiqueCalls}` }]
                            };
                        }
                    }
                }
            ];
            const debate = new AgentsDebateClass<any>({ agents, messages });

            const result = await debate.invokeCritique({
                choosenExecutionAgent: "executor",
                choosenCriticqueAgents: ["critic"],
                useDebateBeforeExecution: false,
                loopsCount: 2
            });

            expect(executionCalls).toBe(3);
            expect(critiqueCalls).toBe(2);
            expect(result?.agentsCritique).toHaveLength(2);
            expect(result?.result.content).toBe("answer 3");
        });

    it("repeats consultation loops and carries prior results forward", async () => {
        let consultantCalls = 0;
        let executionCalls = 0;
        const consultantInputs: MessagesVariations[][] = [];
        const agents: AgentDebateType[] = [
            {
                name: "consultant",
                description: "Provides consultation",
                debateBoundary: { maxRounds: 1 },
                tokenizer: () => 1,
                agentLogic: {
                    invokeStructuredOutput: (_schema, options) => {
                        consultantCalls++;
                        consultantInputs.push(options?.messages ?? []);
                        return {
                            participate: true,
                            continueConversation: false,
                            messages: [{ type: "ai", content: `advice ${consultantCalls}` }]
                        };
                    }
                }
            },
            {
                name: "executor",
                description: "Executes the task",
                debateBoundary: { maxRounds: 1 },
                tokenizer: () => 1,
                agentLogic: {
                    invokeStructuredOutput: () => {
                        executionCalls++;
                        return {
                            participate: true,
                            continueConversation: false,
                            messages: [{ type: "ai", content: `result ${executionCalls}` }]
                        };
                    }
                }
            }
        ];
        const debate = new AgentsDebateClass<any>({ agents, messages });

        const result = await debate.invokeConsultation({
            choosenExecutionAgent: "executor",
            choosenConsultationAgents: ["consultant"],
            loopsCount: 2,
            invokeForStages: { begining: true, betweenExecutionReasoning: true }
        });

        expect(consultantCalls).toBe(4);
        expect(executionCalls).toBe(4);
        expect(result?.result.content).toBe("result 4");
        expect(consultantInputs.some(input => input.some(message =>
            message.type === "ai" && message.content === "result 2"
        ))).toBe(true);
    });
});

describe("AgentsDebate events", () => {
    const createParticipant = (): AgentDebateType => ({
        name: "participant",
        description: "Deterministic participant",
        debateBoundary: { maxRounds: 1 },
        tokenizer: () => 1,
        agentLogic: {
            invokeStructuredOutput: (_schema, options) => {
                const prompt = options?.messages.at(-1);
                if (prompt?.type === "user" && typeof prompt.content === "string" && prompt.content.includes("assessing your suitability")) {
                    return { score: 90, reason: "best fit" };
                }
                return {
                    participate: true,
                    continueConversation: false,
                    messages: [{ type: "ai", content: "response" }]
                };
            }
        }
    });

    it("emits start and end events for every public workflow", async () => {
        const debateAgent = createParticipant();
        const debate = new AgentsDebateClass<any>({
            agents: [
                { ...debateAgent, name: "consultant" },
                { ...debateAgent, name: "executor" },
                { ...debateAgent, name: "critic" },
                { ...debateAgent, name: "conclusion" }
            ],
            messages
        });
        const events: string[] = [];

        debate.onEvent("debate_agent_start", () => { events.push("debate:start"); });
        debate.onEvent("debate_agent_end", () => { events.push("debate:end"); });
        debate.onEvent("consultation_start", () => { events.push("consultation:start"); });
        debate.onEvent("consultation_end", () => { events.push("consultation:end"); });
        debate.onEvent("critique_start", () => { events.push("critique:start"); });
        debate.onEvent("critique_end", () => { events.push("critique:end"); });
        debate.onEvent("handoff_start", () => { events.push("handoff:start"); });
        debate.onEvent("handoff_end", () => { events.push("handoff:end"); });

        await debate.invokeDebateAgent(debateAgent.agentLogic, z.object({
            participate: z.boolean(),
            continueConversation: z.boolean(),
            messages: z.array(z.any())
        }), { messages });
        await debate.invokeConsultation({
            choosenExecutionAgent: "executor",
            choosenConsultationAgents: ["consultant"],
            invokeForStages: { begining: false, betweenExecutionReasoning: false }
        });
        await debate.invokeCritique({
            choosenExecutionAgent: "executor",
            choosenCriticqueAgents: ["critic"],
            useDebateBeforeExecution: false,
            loopsCount: 1
        });
        await debate.invokeHandoff({ choosenConclusionAgent: "conclusion" });

        expect(events).toEqual([
            "debate:start", "debate:end",
            "consultation:start", "consultation:end",
            "critique:start", "critique:end",
            "handoff:start", "handoff:end"
        ]);
    });

    it("emits numbered loop events with messages and error reasons", async () => {
        const debateAgent = createParticipant();
        const debate = new AgentsDebateClass<any>({
            agents: [
                { ...debateAgent, name: "consultant" },
                { ...debateAgent, name: "executor" },
                { ...debateAgent, name: "critic" },
                { ...debateAgent, name: "specialist" },
                { ...debateAgent, name: "reviewer" },
                { ...debateAgent, name: "conclusion" }
            ],
            messages
        });
        const loopEvents: Array<{ name: string; loop: number; loops_count: number; messages: MessagesVariations[]; reason?: string }> = [];

        debate.onEvent("debate_loop_start", event => { loopEvents.push({ name: "debate_start", ...event }); });
        debate.onEvent("debate_loop_end", event => { loopEvents.push({ name: "debate_end", ...event }); });
        debate.onEvent("consultation_loop_start", event => { loopEvents.push({ name: "consultation_start", ...event }); });
        debate.onEvent("consultation_loop_end", event => { loopEvents.push({ name: "consultation_end", ...event }); });
        debate.onEvent("critique_loop_start", event => { loopEvents.push({ name: "critique_start", ...event }); });
        debate.onEvent("critique_loop_end", event => { loopEvents.push({ name: "critique_end", ...event }); });
        debate.onEvent("handoff_loop_start", event => { loopEvents.push({ name: "handoff_start", ...event }); });
        debate.onEvent("handoff_loop_end", event => { loopEvents.push({ name: "handoff_end", ...event }); });
        debate.onEvent("consultation_loop_error", event => { loopEvents.push({ name: "consultation_error", ...event }); });

        await debate.invokeConsultation({
            choosenExecutionAgent: "executor",
            choosenConsultationAgents: ["consultant"],
            loopsCount: 2,
            invokeForStages: { begining: true, betweenExecutionReasoning: false }
        });
        await debate.invokeCritique({
            choosenExecutionAgent: "executor",
            choosenCriticqueAgents: ["critic"],
            useDebateBeforeExecution: false,
            loopsCount: 2
        });
        await debate.invokeHandoff({
            choosenConclusionAgent: "conclusion",
            handoffToAgentsCount: 2,
            executeHandoffParallel: 1
        });

        expect(loopEvents.filter(event => event.name === "consultation_start")).toHaveLength(2);
        expect(loopEvents.filter(event => event.name === "consultation_end")).toHaveLength(2);
        expect(loopEvents.filter(event => event.name === "critique_start")).toHaveLength(2);
        expect(loopEvents.filter(event => event.name === "critique_end")).toHaveLength(2);
        expect(loopEvents.filter(event => event.name === "handoff_start")).toHaveLength(2);
        expect(loopEvents.filter(event => event.name === "handoff_end")).toHaveLength(2);
        expect(loopEvents.filter(event => event.name === "debate_start")).toHaveLength(2);
        expect(loopEvents.filter(event => event.name === "debate_end")).toHaveLength(2);
        expect(loopEvents.every(event => event.messages.length > 0)).toBe(true);
        expect(loopEvents.filter(event => event.name.endsWith("_error"))).toHaveLength(0);
    });

    it("emits an error event and rethrows workflow errors", async () => {
        const debate = new AgentsDebateClass<any>({ agents: [], messages });
        const errors: Error[] = [];
        debate.onEvent("consultation_error", error => { errors.push(error); });

        await expect(debate.invokeConsultation({
            choosenExecutionAgent: "missing",
            choosenConsultationAgents: ["consultant"]
        })).rejects.toThrow('unknown execution agent "missing"');

        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('unknown execution agent "missing"');
    });

    it("does not let a failing event listener change the workflow result", async () => {
        const participant = createParticipant();
        const debate = new AgentsDebateClass<any>({ agents: [participant], messages });
        debate.onEvent("debate_agent_end", () => Promise.reject(new Error("listener failure")));

        await expect(debate.invokeDebateAgent(
            participant.agentLogic,
            z.object({
                participate: z.boolean(),
                continueConversation: z.boolean(),
                messages: z.array(z.any())
            }),
            { messages }
        )).resolves.toEqual({ participate: true, continueConversation: false, messages: [{ type: "ai", content: "response" }] });
    });
});

const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const openaiModel = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
const liveDescribe = openaiApiKey ? describe : describe.skip;

const createOpenAIAgent = (name: string, description: string): AgentDebateType => ({
    name,
    description,
    debateBoundary: { maxRounds: 1, timeMs: 90_000 },
    tokenizer: content => Math.ceil(content.length / 4),
    agentLogic: new ReActAgent({
        model: new OpenAI({ model: openaiModel, apiKey: openaiApiKey! }),
        systemPrompt: [
            "You are an agent participating in an AgentsDebate workflow.",
            "Follow the structured output schema exactly.",
            "When asked for a DebateAgentResponse, participate and return useful AI messages.",
            "Keep answers concise and grounded in the task."
        ].join(" "),
        messages,
        tools: [],
        maximumReasoningRecalls: 1
    })
});

liveDescribe("AgentsDebate OpenAI live workflows", () => {
    it("invokes a ReActAgent with OpenAI through invokeDebateAgent", async () => {
        const agent = createOpenAIAgent("structured-agent", "Returns a concise structured answer.");
        const result = await new AgentsDebateClass<any>({
            agents: [agent],
            messages: [{ type: "user", content: "Return the answer 42." }]
        }).invokeDebateAgent(
            agent.agentLogic,
            z.object({ answer: z.string() }),
            { messages: [{ type: "user", content: "Return the answer 42." }] }
        );

        expect(result.answer).toContain("42");
    }, 120_000);

    it("runs consultation with OpenAI-backed agents", async () => {
        const consultant = createOpenAIAgent("consultant", "Provides practical advice.");
        const executor = createOpenAIAgent("executor", "Executes the task using received advice.");
        const result = await new AgentsDebateClass<any>({
            agents: [consultant, executor],
            messages: [{ type: "user", content: "Explain why testing matters in one sentence." }]
        }).invokeConsultation({
            choosenExecutionAgent: "executor",
            choosenConsultationAgents: ["consultant"],
            invokeForStages: { begining: true, betweenExecutionReasoning: false }
        });

        expect(result?.consultation.begining.length).toBeGreaterThan(0);
        expect(result?.choosenAgentResult.length).toBeGreaterThan(1);
        expect(result?.result.type).toBe("ai");
    }, 180_000);

    it("runs critique and revision with OpenAI-backed agents", async () => {
        const executor = createOpenAIAgent("executor", "Produces and revises task answers.");
        const critic = createOpenAIAgent("critic", "Identifies one concrete improvement.");
        const result = await new AgentsDebateClass<any>({
            agents: [executor, critic],
            messages: [{ type: "user", content: "Write one sentence explaining clean code." }]
        }).invokeCritique({
            choosenExecutionAgent: "executor",
            choosenCriticqueAgents: ["critic"],
            useDebateBeforeExecution: false,
            loopsCount: 1
        });

        expect(result?.agentsCritique).toHaveLength(1);
        expect(result?.result.type).toBe("ai");
    }, 180_000);

    it("runs handoff and conclusion with OpenAI-backed agents", async () => {
        const specialist = createOpenAIAgent("specialist", "Solves the task directly.");
        const reviewer = createOpenAIAgent("reviewer", "Solves the task and checks assumptions.");
        const conclusion = createOpenAIAgent("conclusion", "Combines handoff results into one answer.");
        const result = await new AgentsDebateClass<any>({
            agents: [specialist, reviewer, conclusion],
            messages: [{ type: "user", content: "State one benefit of automated testing." }]
        }).invokeHandoff({
            choosenConclusionAgent: "conclusion",
            handoffToAgentsCount: 2,
            executeHandoffParallel: 2,
            handoffInstructions: "Keep the answer to one concise sentence."
        });

        expect(result?.selectedAgents).toHaveLength(2);
        expect(result?.handoffExecutions).toHaveLength(2);
        expect(result?.handoffExecutions.every(execution => execution.status === "completed")).toBe(true);
        expect(result?.result.type).toBe("ai");
    }, 240_000);
});
