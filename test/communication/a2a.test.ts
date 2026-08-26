/* Includes tests for A2A Google Protocol implemented for RavenADK */
import { describe, expect, it, vi } from "vitest";
import { A2AProtocolClient, createA2ACommunicationAdapter, createA2AHttpServer, createA2ABinding, PROTOCOL_NAME } from "../../src/agent/communication-protocols/agentProtocols/a2a";
import { InMemoryProtocolTaskQueueSchema } from "../../src/agent/communication-protocols/queues/queue-types";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { DummyModel } from "../../src/models/text-to-text/dummy";

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

    it("communicates between two spawned A2A protocol instances over HTTP", async () => {
        const worker = createA2AHttpServer({
            binding: createA2ABinding({ endpoint: "http://localhost" }),
            agent: { id: "worker", name: "Worker Agent", capabilities: ["delegate_task"] }
        });
        await worker.listen(0, "127.0.0.1");
        const workerAddress = worker.httpServer.address();
        if (!workerAddress || typeof workerAddress === "string") throw new Error("Worker did not bind to a port");

        const caller = createA2AHttpServer({
            binding: createA2ABinding({ endpoint: `http://127.0.0.1:${workerAddress.port}/a2a`, participant: { id: "caller", name: "Caller Agent" } }),
            agent: { id: "caller", name: "Caller Agent", capabilities: ["delegate_task"] }
        });

        try {
            await caller.listen(0, "127.0.0.1");

            const handle = await caller.binding.client.delegate({
                from: "caller",
                to: "worker",
                activity: "delegate_task",
                message: "Use the worker HTTP protocol"
            });
            const queued = await worker.queue.dequeue();
            console.log('Dequeued', queued)

            expect(queued?.request).toMatchObject({
                from: "caller",
                to: "worker",
                message: "Use the worker HTTP protocol"
            });

            await worker.queue.complete(queued!.taskId, {
                taskId: queued!.taskId,
                status: "completed",
                message: { id: "answer", role: "agent", content: "HTTP communication works" }
            });

            await expect(handle.wait()).resolves.toMatchObject({
                taskId: queued!.taskId,
                status: "completed",
                message: { content: "HTTP communication works" }
            });
        } finally {
            await caller.close();
            await worker.close();
        }
    });

    it("communicates between two ReActAgents through A2A using serve and DummyModel", async () => {
        const worker = createA2AHttpServer({
            binding: createA2ABinding({ endpoint: "http://localhost" }),
            agent: { id: "consumer", name: "Consumer Agent", capabilities: ["delegate_task"] }
        });
        await worker.listen(0, "127.0.0.1");
        const workerAddress = worker.httpServer.address();
        if (!workerAddress || typeof workerAddress === "string") throw new Error("Worker did not bind to a port");

        const consumerModel = new DummyModel({
            invokeOutcome: {
                messages: [{ type: "ai", content: "Consumer completed the delegated task." }],
                answer: [{ type: "ai", content: "Consumer completed the delegated task." }],
                tokens: { input: 3, output: 4, reasoning: 0 }
            }
        });
        const consumerAgent = new ReActAgent({
            model: consumerModel,
            systemPrompt: "Complete delegated tasks.",
            messages: [],
            tools: [],
            withConclusion: false
        });

        const serveTaskStart = vi.fn();
        const serveTaskFinished = vi.fn();
        const serveAbort = vi.fn();
        const serveMaxTasksReached = vi.fn();
        consumerAgent.onEvent("serve_task_start", serveTaskStart);
        consumerAgent.onEvent("serve_task_finished", serveTaskFinished);
        consumerAgent.onEvent("serve_abort", serveAbort);
        consumerAgent.onEvent("serve_max_tasks_reached", serveMaxTasksReached);

        const callerBinding = createA2ABinding({
            endpoint: `http://127.0.0.1:${workerAddress.port}/a2a`,
            participant: { id: "caller", name: "Caller Agent" }
        });
        const delegateToolName = `${PROTOCOL_NAME}_delegate_task`;
        const callerModel = new DummyModel({
            handleOverflow: () => ({
                messages: [{ type: "ai", content: "The consumer returned the delegated report." }],
                answer: [{ type: "ai", content: "The consumer returned the delegated report." }],
                tokens: { input: 2, output: 3, reasoning: 0 }
            }),
            messagesFlow: [
                {
                    messages: [],
                    answer: [{
                        type: "tool",
                        tool_id: "delegate-call",
                        tool_name: delegateToolName,
                        content: JSON.stringify({ to: "consumer", message: "Prepare the delegated report." }),
                        arguments: { to: "consumer", message: "Prepare the delegated report." }
                    }],
                    tokens: { input: 2, output: 3, reasoning: 0 }
                }
            ]
        });
        const callerAgent = new ReActAgent({
            model: callerModel,
            systemPrompt: "Delegate work when another agent can complete it.",
            messages: [{ type: "user", content: "Get the delegated report." }],
            tools: [],
            communicationProtocols: [callerBinding],
            withConclusion: false
        });

        try {
            const serving = consumerAgent.serve(worker.binding, { maxTasks: 1 });
            const callerResult = await callerAgent.invoke();
            await expect(serving).resolves.toBe(1);

            expect(serveTaskStart).toHaveBeenCalledOnce();
            expect(serveTaskStart).toHaveBeenCalledWith(expect.objectContaining({
                request: expect.objectContaining({
                    message: "Prepare the delegated report."
                })
            }));
            expect(serveTaskFinished).toHaveBeenCalledOnce();
            expect(serveTaskFinished).toHaveBeenCalledWith(
                expect.objectContaining({ taskId: expect.any(String) }),
                expect.objectContaining({ status: "completed" })
            );
            expect(serveMaxTasksReached).toHaveBeenCalledOnce();
            expect(serveMaxTasksReached).toHaveBeenCalledWith(1, 1);

            const abortController = new AbortController();
            const waitingServe = consumerAgent.serve(worker.binding, { signal: abortController.signal });
            abortController.abort();
            await expect(waitingServe).resolves.toBe(0);
            expect(serveAbort).toHaveBeenCalledOnce();
            expect(serveAbort).toHaveBeenCalledWith(0);

            expect(consumerModel.config.messages?.some(message =>
                message.type === "user" && message.content.includes("Prepare the delegated report.")
            )).toBe(true);
            expect(callerResult.messages.some(message =>
            message.type === "ai" && message.content === "The consumer returned the delegated report."
        )).toBe(true);
            expect(callerResult.messages.some(message =>
            message.type === "tool" && message.tool_name === delegateToolName && message.toolOutput?.includes("Consumer completed the delegated task.")
        )).toBe(true);
        } finally {
            await worker.close();
        }
    });

    it("exposes the inbound adapter for non-HTTP communication transports", async () => {
        const queue = new InMemoryProtocolTaskQueueSchema();
        const adapter = createA2ACommunicationAdapter({ id: "worker", name: "Worker Agent" });

        const response = await adapter.handle({
            id: "request-1",
            method: "message/send",
            params: {
                message: {
                    parts: [{ kind: "text", text: "Use the custom transport" }],
                    metadata: { raven: { from: "caller", to: "worker" } }
                }
            }
        }, {
            binding: createA2ABinding({ endpoint: "http://localhost" }),
            queue
        });

        const queued = await queue.dequeue();
        expect(response).toMatchObject({ result: { id: queued?.taskId, status: { state: "working" } } });
        expect(queued?.request).toMatchObject({ from: "caller", to: "worker", message: "Use the custom transport" });
    });

    it("emits queue lifecycle events and supports unsubscribing", async () => {
        const queue = new InMemoryProtocolTaskQueueSchema();
        const events: string[] = [];
        const removeEnqueuedListener = queue.onEvent("task_enqueued", task => {events.push(`enqueued:${task.taskId}`)});
        queue.onEvent("task_dequeued", task => {events.push(`dequeued:${task.taskId}`)});
        queue.onEvent("task_completed", result => {events.push(`completed:${result.taskId}`)});

        const taskId = await queue.enqueue({ from: "caller", to: "worker", message: "Run the task" });
        const queued = await queue.dequeue();
        await queue.complete(taskId, { taskId, status: "completed" });

        expect(events).toEqual([`enqueued:${taskId}`, `dequeued:${taskId}`, `completed:${taskId}`]);
        removeEnqueuedListener();
        await queue.enqueue({ from: "caller", to: "worker", message: "Do not notify this listener" });
        expect(events).toHaveLength(3);
        expect(queued?.taskId).toBe(taskId);
    });
});
