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

It is a client binding. It does not create an HTTP server or provide an inbound
`ProtocolTaskQueueSchema` yet, so it cannot by itself be used as the inbound source
for `ReActAgent.serve()`.

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
import { ProtocolsSchema } from "@ravenlens/raven-adk";

const a2aServerBinding: ProtocolsSchema.Schema = {
	name: "A2A server",
	version: "1.0",
	client: a2aClient,
	queue: a2aInboundQueue,
	participant: {
		id: "research-agent",
		name: "Research Agent",
		capabilities: ["delegate_task"]
	}
};

await agent.serve(a2aServerBinding, {
	signal: shutdownController.signal
});
```

`a2aInboundQueue` is owned by the HTTP server integration and must implement
`enqueue`, `dequeue`, `complete`, `fail`, `cancel`, and `size` from
`ProtocolTaskQueueSchema`. `dequeue()` should wait while there is no work and wake
when the A2A handler enqueues a request or the abort signal is triggered.

The current `A2A.createBinding()` implementation does not create
`a2aInboundQueue` or an HTTP server, so this server binding is an integration
point to implement in the host application. With the current code, use
`createBinding()` for outbound calls to another A2A agent; use `serve()` only
after pairing the local ReActAgent with a server-side A2A transport and queue.

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
factory creates an outbound client binding without `queue`, so `serve()` will
throw `Protocol "..." does not provide an inbound task queue.`

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