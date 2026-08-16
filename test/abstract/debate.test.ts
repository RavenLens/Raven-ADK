import { describe, expect, it } from "vitest";
import { Graph, GraphMarkers } from "../../src/graph";
import {
    AgentDebateType,
    ExecutableAgentDebateFn,
    InvokableAgentDebate,
} from "../../src/agent";
import type { MessagesVariations } from "../../src/agent/state";

const messages: MessagesVariations[] = [
    { type: "user", content: "Solve this task" }
];

describe("AgentsDebate executable participants", () => {
    it("invokes a custom callback participant", async () => {
        const logic: ExecutableAgentDebateFn<string> = ({ messages: context }) =>
            context.at(-1)?.type === "user" ? context.at(-1).content : "";

        await expect(invokeDebateAgent(logic, { messages })).resolves.toBe("Solve this task");
    });

    it("invokes an object-based participant", async () => {
        const logic: InvokableAgentDebate<number> = {
            invoke: ({ messages: context }) => context.length
        };

        await expect(invokeDebateAgent(logic, { messages })).resolves.toBe(1);
    });

    it("accepts a startable graph participant", async () => {
        const graph = new Graph({ value: 0 });
        graph
            .addNode("increment", () => ({ stateUpdate: { value: 1 } }))
            .addEdge(GraphMarkers.START, "increment")
            .addEdge("increment", GraphMarkers.END);

        const participant: AgentDebateType<void> = {
            name: "graph-agent",
            description: "Runs a graph workflow",
            agentLogic: graph
        };

        await invokeDebateAgent(participant.agentLogic, { messages });

        expect(graph.getState()).toEqual({ value: 1 });
    });
});
