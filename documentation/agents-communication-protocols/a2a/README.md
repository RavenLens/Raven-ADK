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
`ProtocolTaskQueue` yet, so it cannot by itself be used as the inbound source
for `ReActAgent.serve()`.

## ReActAgent Usage

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

const result = await agent.invoke("Compare the latest findings on Mars water reservoirs.");
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