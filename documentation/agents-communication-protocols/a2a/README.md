# A2A (Agent-to-Agent) Communication Protocol

RavenADK's A2A binding connects an agent to a remote A2A endpoint through
JSON-RPC over HTTP. It translates the Raven canonical communication model into
A2A messages and maps remote task responses back into `TaskSnapshot` and
`TaskResult` values.

## Current Scope

The binding currently supports outbound communication:

- agent-card discovery through `/.well-known/agent-card.json`;
- asynchronous delegation through `message/send`;
- task polling through `tasks/get`;
- cancellation through `tasks/cancel`;
- canonical lifecycle events and task result mapping.

The binding also has an HTTP server factory. `createA2AHttpServer()` uses the
reusable HTTP transport wrapper and provides an inbound
`ProtocolTaskQueueSchema` for `ReActAgent.serve()`.

## Using `serve()` with A2A

`ReActAgent.serve()` is the inbound worker side of the protocol boundary. It
does not listen on an HTTP port itself. Instead, it consumes tasks from
`protocol.queue`:

```ts
const processedTasks = await agent.serve(a2aServerBinding, {
	signal: shutdownController.signal,
	maxTasks: 100,
	continueOnError: true
});
```

For this to work, `a2aServerBinding` must provide a server-side
`ProtocolTaskQueueSchema`. The A2A HTTP handler should enqueue an incoming request and
return or stream the assigned task ID. A long-running worker should run
`serve()` and publish the result from `queue.complete()` or `queue.fail()` back
through the A2A task endpoint:

```text
incoming A2A message/send
		|
		v
queue.enqueue(request) -> task ID returned to caller
		|
		v
agent.serve(binding)
		|
		+--> queue.dequeue() -> ReActAgent.invoke()
		|
		+--> queue.complete(task ID, result)
			  or queue.fail(task ID, error)
		|
		v
remote caller reads tasks/get or receives a streamed update
```

The binding supplied to `serve()` must have this shape:

```ts
import { A2A, createA2AHttpServer } from "@ravenlens/raven-adk";

const a2aServer = createA2AHttpServer({
	binding: A2A.createBinding({ endpoint: "http://localhost:8080/a2a" }),
	agent: {
		id: "research-agent",
		name: "Research Agent",
		capabilities: ["delegate_task"]
	}
});

await a2aServer.listen(8080, "127.0.0.1");
const a2aServerBinding = a2aServer.binding;

await agent.serve(a2aServerBinding, {
	signal: shutdownController.signal
});
```

The server creates an in-memory queue when the supplied binding does not have
one. Pass a durable or distributed implementation of `ProtocolTaskQueueSchema`
in the binding when work must survive process restarts or be shared by
multiple workers. Use `createBinding()` alone for outbound calls; use the
server binding for `serve()`.

## Choosing Between `invoke()` and `serve()`

Use `invoke()` when your application owns the current user request and the
ReActAgent may decide to ask another agent for help. The A2A binding is placed
in `communicationProtocols`; ReActAgent exposes delegation and consultation as
tools, and the model chooses whether to call them during this finite run.

Use `serve()` when this ReActAgent is itself an A2A participant that must accept
tasks from other agents. `serve()` is a worker loop: it waits on an inbound
`ProtocolTaskQueueSchema`, calls the ReAct graph for each queued request, and reports
the result back through the queue. It is normally started as a separate,
long-running process alongside the HTTP A2A server.

| Method | Use it for | Required A2A capability |
| --- | --- | --- |
| `invoke()` | A local user or orchestrator starts a finite run and may delegate outward. | `client`; `createBinding()` is sufficient. |
| `serve()` | The local agent receives and processes work submitted by external agents. | `queue`; the current client-only `createBinding()` is not sufficient. |

The two methods can be used by the same application when it both delegates work
and accepts work:

```ts
// Outbound/orchestrator path.
const answer = await agent.invoke({
	messages: [{
		type: "user",
		content: "Compare the latest findings on Mars water reservoirs."
	}]
});

// Inbound/worker path, using a server-side binding with an A2A-backed queue.
const processed = await agent.serve(a2aServerBinding, {
	signal: shutdownController.signal
});
```

Do not call `serve()` with the result of `A2A.createBinding()` alone. That
factory creates an outbound client binding without `queue`; use
`createA2AHttpServer()` or provide a queue-backed binding instead.

## Using A2A with a Custom Communication Protocol

HTTP is the default server transport because `createA2AHttpServer()` wraps the
shared communication adapter in a JSON HTTP endpoint. A2A is not coupled to
HTTP, though. A custom transport should normalize its incoming payload to
`CommunicationRequest`, call the A2A adapter with a queue-backed binding, and
serialize the returned `CommunicationResponse` in the transport's native way:

```ts
import {
	A2A_AgentsCommunicationProtocol as A2A,
	CommunicationProtocolWrapperSchema,
	Queues
} from "@ravenlens/raven-adk";
import type { CommunicationRequest } = CommunicationProtocolWrapperSchema;

const agent = new ReActAgent({ /** Options */ });

const binding = A2A.createBinding({ endpoint: "http://unused-for-custom-transport" });
const queue = new Queues.QueuesLib.InMemoryProtocolTaskQueueSchema();
const adapter = A2A.createA2ACommunicationAdapter(
	// Description for agents 
	{
		id: "worker",
		name: "Worker Agent",
		capabilities: ["delegate_task"]
	}
);

/**
 * Entry point implemented by the custom transport for each incoming message.
 * It translates the transport payload into the shared request contract and
 * delegates A2A task handling to the reusable adapter.
 */
async function handleCustomMessage(payload: CustomMessage): Promise<unknown> {
	const request: CommunicationRequest = {
		id: payload.id,
		method: payload.type, // "message/send", "tasks/get", or "tasks/cancel"
		params: payload.params
	};

	// Use to listend `CommunicationResult` response after each retrival
	const handlingResult = await adapter.handle(request, { binding, queue });

	return handlingResult;
}

const a2aServerBinding = { ...binding, queue };
await agent.serve(a2aServerBinding, { signal: shutdownController.signal });
```

- `handleCustomMessage` is an application-defined transport callback, not a
	RavenADK method. Rename it or connect it to the callback used by your
	WebSocket, Kafka, RabbitMQ, or other custom transport implementation.

The custom transport owns connection handling, authentication, serialization,
retries, and discovery exposure. The adapter owns A2A task semantics and uses
the same queue operations as the default HTTP server. For a durable or shared
worker, replace `InMemoryProtocolTaskQueueSchema` with your implementation of
`ProtocolTaskQueueSchema`. The transport must pass the same queue to the
adapter and to `agent.serve()`.

## ReActAgent `invoke()` Usage

The binding returned by `A2A.createBinding()` can be passed directly to the
`communicationProtocols` option:

```ts
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { A2A } from "@ravenlens/raven-adk";

const a2a = A2A.createBinding({
	endpoint: "https://research-agent.example.com/rpc",
	participant: {
		id: "planner-agent",
		name: "Planner Agent",
		description: "Coordinates research tasks",
		capabilities: ["delegate_task", "consult_agents"]
	},
	pollingIntervalMs: 500,
	waitTimeoutMs: 120_000
});

const agent = new ReActAgent({
	model,
	systemPrompt: "Solve the user's request using reliable external research when needed.",
	messages: [],
	tools: [],
	communicationProtocols: [a2a]
});

const result = await agent.invoke({
	messages: [{
		type: "user",
		content: "Compare the latest findings on Mars water reservoirs."
	}]
});
```

When the agent is constructed, ReActAgent registers two tools for this binding:

- `A2A (Agent-to-Agent Protocol by GOOGLE)_delegate_task` delegates a task and
  awaits `TaskHandle.wait()`;
- `A2A (Agent-to-Agent Protocol by GOOGLE)_consult_agents` sends a consultation
  and awaits its result.

The model decides when to call a tool. The tool call is part of the normal
ReAct loop, so `invoke()` does not finish while the delegated A2A task is still
working. The result is serialized as the tool output, allowing the model to
continue reasoning with the remote agent's answer.

## Direct Client Usage

The client can also be used without ReActAgent:

```ts
import { A2A } from "@ravenlens/raven-adk";

const client = new A2A.A2AProtocolClient({
	endpoint: "https://research-agent.example.com/rpc",
	headers: { Authorization: `Bearer ${token}` }
});

const { agents } = await client.discover({ skill: "research" });
const task = await client.delegate({
	from: "planner-agent",
	to: agents[0].id,
	activity: "delegate_task",
	message: "Find primary sources about Mars water reservoirs."
});
const answer = await task.wait();
```

`pollingIntervalMs` controls calls to `tasks/get`. `waitTimeoutMs` prevents a
remote task from keeping a local workflow waiting indefinitely. A custom
`fetch` implementation can be supplied for tests or a runtime-specific HTTP
client.

## Events

Register listeners with `client.onEvent()`. ReActAgent forwards these events as
its `protocol_event` event with the protocol name and task ID when available.

```ts
const unsubscribe = client.onEvent("task_progress", (task, message) => {
	console.log(task.id, task.status, message?.content);
});

unsubscribe();
```

The canonical event names are defined by `CommunicationEventMap`; protocol
implementations should map native A2A lifecycle events to that shared contract.