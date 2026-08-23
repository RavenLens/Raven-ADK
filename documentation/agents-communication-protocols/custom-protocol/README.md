# Custom Protocols

Custom protocols let an application connect RavenADK agents to a proprietary
agent network, transport, or workflow while preserving the RavenADK
communication model.

## Agent Protocol

Define the agent-level behavior first: discovery, delegation, messages, task
status, results, errors, events, and cancellation. Implement it against the
canonical types in
[`agentProtocolSchema.ts`](../../../src/agent/communication-protocols/agentProtocols/agentProtocolSchema.ts).
Return a `ProtocolBinding` with a `ProtocolClient` implementation.

```ts
const customBinding: ProtocolBinding = {
	name: "Contoso Agent Protocol",
	version: "1.0",
	client: new ContosoProtocolClient({ endpoint: "https://agents.example.com" }),
	participant: { id: "planner", name: "Planner Agent" }
};
```

The schema is required because RavenADK agents consume these operations and
events directly. A schema-compliant custom protocol can be used by
`ReActAgent`, tools, plugins, and other agent abstractions without teaching
each consumer a new protocol-specific API.

## Communication Wrapper

Wrap the agent protocol in a transport such as HTTP, JSON-RPC, Kafka,
RabbitMQ, MQTT, WebRTC, or an in-process channel. Implement the transport
boundary with the types in
[`communicationProtocolSchema.ts`](../../../src/agent/communication-protocols/communicationProtocols/communicationProtocolSchema.ts).
The wrapper translates transport payloads to the agent protocol and maps
responses, errors, and events back to the canonical model.

The reusable HTTP wrapper accepts a `CommunicationProtocolAdapter`, so an
application can expose a custom agent protocol over HTTP without coupling the
HTTP server to A2A-specific message shapes.

```ts
const customHttpAdapter: CommunicationProtocolAdapter = {
	async handle(request, { queue }) {
		if (request.method !== "task/submit") {
			return { error: { code: -32601, message: "Method not supported" } };
		}

		const taskId = await queue.enqueue({
			from: String(request.params.from),
			to: String(request.params.to),
			message: String(request.params.message),
			activity: "delegate_task"
		});

		return { result: { taskId, status: "submitted" } };
	}
};

const server = createHttpProtocolServer({
	binding: customBinding,
	agent: { id: "worker", name: "Worker Agent" },
	adapter: customHttpAdapter
});

await server.listen(8080);
```

## Queue Integration

Add a queue when requests are asynchronous, long-running, durable, or handled
by multiple workers. The communication wrapper calls `enqueue`; a worker such
as `ReActAgent.serve()` calls `dequeue`, processes the request, and calls
`complete`, `fail`, or `cancel`.

Implement `ProtocolTaskQueueSchema` from
[`queueSchema.ts`](../../../src/agent/communication-protocols/queues/queueSchema.ts).
The implementation may be in memory or backed by PostgreSQL, Redis, MongoDB,
S3, or another system. The agent and wrapper depend on the schema operations,
not on the storage technology.

```ts
class PostgresTaskQueue implements ProtocolTaskQueueSchema {
	async enqueue(request: TaskRequest): Promise<TaskId> { /* insert task */ }
	async dequeue(signal?: AbortSignal): Promise<QueuedTask | undefined> { /* claim task */ }
	async complete(taskId: TaskId, result: TaskResult): Promise<void> { /* store result */ }
	async fail(taskId: TaskId, error: ProtocolError): Promise<void> { /* store failure */ }
	async cancel(taskId: TaskId, reason?: string): Promise<void> { /* mark cancelled */ }
	size(): number { /* return waiting task count */ return 0; }
}
```

The queue implementation owns persistence, locking, retries, and worker
coordination. The communication wrapper and `ReActAgent.serve()` only depend
on the schema methods.

## Extension Checklist

1. Define the native agent messages and lifecycle states.
2. Map them to the [canonical agent protocol schema `AgentProtocolDefinition`](../../../src/agent/communication-protocols/agentProtocols/agentProtocolSchema.ts).
3. Implement a `ProtocolClient` and return a `ProtocolBinding`.
4. Select or implement a transport wrapper using the communication schema.
5. Add a queue when work must outlive the current request or run separately.
6. Map native errors, cancellation, and progress into the canonical events.
7. Test discovery, delegation, completion, failure, cancellation, and retries.
