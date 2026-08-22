import { describe, expect, it, vi } from "vitest";
import { A2AProtocolClient, createA2AHttpServer, createA2ABinding, PROTOCOL_NAME } from "../../src/agent/communication-protocols/protocols/a2a";

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
    });
}

describe("A2A protocol binding", () => {
    it("delegates through JSON-RPC and waits for a terminal task result", async () => {
        const fetchMock = vi.fn<typeof fetch>();
        let taskReads = 0;
        fetchMock.mockImplementation(async (_input, init) => {
            const request = JSON.parse(String(init?.body)) as { method: string; params: Record<string, any> };
            if (request.method === "message/send") {
                expect(request.params.message.parts).toEqual([{ kind: "text", text: "Research Mars" }]);
                return jsonResponse({ result: { id: "task-1", status: { state: "working" } } });
            }
            if (request.method === "tasks/get") {
                taskReads++;
                return jsonResponse({
                    result: taskReads === 1
                        ? { id: "task-1", status: { state: "working" }, messages: [] }
                        : {
                            id: "task-1",
                            status: { state: "completed" },
                            messages: [{ messageId: "answer-1", role: "agent", parts: [{ text: "Mars is a planet." }] }]
                        }
                });
            }
            throw new Error(`Unexpected method: ${request.method}`);
        });

        const completed = vi.fn();
        const client = new A2AProtocolClient({
            endpoint: "https://agent.example.com/rpc",
            pollingIntervalMs: 1,
            fetch: fetchMock
        });
        client.onEvent("task_completed", completed);

        const handle = await client.delegate({
            from: "local-agent",
            to: "research-agent",
            activity: "delegate_task",
            message: "Research Mars"
        });
        const result = await handle.wait();

        expect(handle.taskId).toBe("task-1");
        expect(result).toMatchObject({
            taskId: "task-1",
            status: "completed",
            message: { content: "Mars is a planet." }
        });
        expect(taskReads).toBe(2);
        expect(completed).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("discovers and filters agents from agent cards", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
            name: "Research Agent",
            description: "Finds scientific facts",
            capabilities: ["delegate_task"],
            skills: ["research"],
            url: "https://agent.example.com"
        }));
        const client = new A2AProtocolClient({
            endpoint: "https://agent.example.com/rpc",
            discoveryEndpoints: ["https://agent.example.com"],
            fetch: fetchMock
        });

        const result = await client.discover({ capability: "delegate_task", skill: "research" });

        expect(result.agents).toHaveLength(1);
        expect(result.agents[0]).toMatchObject({ name: "Research Agent", skills: ["research"] });
        expect(fetchMock).toHaveBeenCalledWith(
            "https://agent.example.com/.well-known/agent-card.json",
            expect.objectContaining({ headers: undefined })
        );
    });

    it("exposes a binding that ReActAgent can consume", () => {
        const binding = createA2ABinding({
            endpoint: "https://agent.example.com/rpc",
            participant: { id: "local-agent", name: "Local ReAct Agent" }
        });

        expect(binding).toMatchObject({
            name: PROTOCOL_NAME,
            version: "1.0",
            participant: { id: "local-agent" }
        });
        expect(binding.client).toBeInstanceOf(A2AProtocolClient);
        expect(binding.queue).toBeUndefined();
        expect(binding.adapter).toBeUndefined();
    });

    it("cancels a remote task and emits the canonical cancellation event", async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ result: {} }));
        const cancelled = vi.fn();
        const client = new A2AProtocolClient({ endpoint: "https://agent.example.com/rpc", fetch: fetchMock });
        client.onEvent("task_cancelled", cancelled);

        await client.cancel("task-1", "No longer needed");

        const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(request).toMatchObject({ method: "tasks/cancel", params: { id: "task-1", metadata: { reason: "No longer needed" } } });
        expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1", reason: "No longer needed" }));
    });

    it("serves inbound A2A requests through a queue consumed by ReActAgent.serve", async () => {
        const service = createA2AHttpServer({
            binding: createA2ABinding({ endpoint: "http://localhost" }),
            agent: { id: "worker", name: "Worker Agent", capabilities: ["delegate_task"] }
        });
        await service.listen(0, "127.0.0.1");
        const address = service.httpServer.address();
        if (!address || typeof address === "string") throw new Error("Server did not bind to a port");
        const endpoint = `http://127.0.0.1:${address.port}/a2a`;

        const request = fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "message/send",
                params: {
                    message: {
                        parts: [{ kind: "text", text: "Calculate 2 + 2" }],
                        metadata: { raven: { from: "orchestrator", to: "worker" } }
                    }
                }
            })
        });
        const queued = await service.queue.dequeue();
        expect(queued?.request).toMatchObject({
            from: "orchestrator",
            to: "worker",
            message: "Calculate 2 + 2"
        });
        await service.queue.complete(queued!.taskId, {
            taskId: queued!.taskId,
            status: "completed",
            message: { id: "answer", role: "agent", content: "4" }
        });
        const accepted = await (await request).json();
        expect(accepted.result).toMatchObject({ id: queued!.taskId, status: { state: "working" } });

        const task = await (await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tasks/get", params: { id: queued!.taskId } })
        })).json();
        expect(task.result).toMatchObject({ status: { state: "completed" }, message: { content: "4" } });

        const card = await (await fetch(`${endpoint.replace("/a2a", "")}/.well-known/agent-card.json`)).json();
        expect(card).toMatchObject({ id: "worker", name: "Worker Agent" });
        await service.close();
    });
});
