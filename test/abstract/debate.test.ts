import { describe, expect, it } from "vitest";
import { Graph, GraphMarkers } from "../../src/graph";
import {
    AgentDebateType,
    StructuredAgentDebate,
} from "../../src/agent";
import { AgentsDebate as AgentsDebateClass } from "../../src/agent/abstract/agentsdebate";
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
                    return { participate: false, continueConversation: false, messages: [] };
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
            message.type === "ai" && message.content === "round 2"
        )).toBe(true);
        expect(tokenizedContent).toContain("round 1");
        expect(tokenizedContent).toContain("round 2");
    });
});
