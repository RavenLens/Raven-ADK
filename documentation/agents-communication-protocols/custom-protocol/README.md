# Custom Protocols

Custom protocols let an application connect RavenADK agents to a proprietary
agent network, transport, or workflow while preserving the RavenADK
communication model.

## Telemetry

Custom protocols using the shared HTTP wrapper automatically receive a `protocol.http.request` span around `CommunicationProtocolAdapter.handle()` and a `protocol.http.response` event containing the protocol, method, and success/error status. Queue implementations use the shared `protocol.queue.*` lifecycle event names.

Custom transports should preserve the same boundary semantics: create a span with protocol and operation metadata, record failures through span status, and never record message bodies, headers, credentials, or full request parameters. `ReActAgent.serve()` adds `agent.react_serve` and per-task `agent.serve.task` telemetry independently of the transport.

> You as the contributor for custom RavenADK agent communication protocol should explicitly grant OpenTelemetry Support for protocol to make it observable - use `withTelemetry` and its Telemetry methods reserved for that task

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

## Custom Protocol Class Schema
`ProtocolBinding` has to implement the `client` can have shape like this
- Client is made to allow agent to delegate the tasks and messages to the foregin agents
- `convertToolsToProtocolTools` improves the setup syntax: pass ordinary `Tool` instances to the client constructor and the helper returns `ProtocolCustomClientTool` instances that emit the protocol events.

```typescript
import { AgentCommunicationProtocolsSchema } from "@ravenlens/raven-adk/communication-protocols"

/** Example custom protocol client that demonstrates the ProtocolClient contract. */
export class CustomProtocol implements AgentCommunicationProtocolsSchema.ProtocolClient {
	/** Specify list of custom tools to allow client to communicate with custom tools.  */
    customCommunicationTools: AgentCommunicationProtocolsSchema.ProtocolCustomClientTool<any, any>[];
    readonly listeners: Map<keyof CommunicationEventMap, Set<(...args: any[]) => void | Promise<void>>> = new Map();

	constructor(customTools: Tool<any, any>[] = []) {
		// Convert common tools into event-emitting protocol tools during construction.
		this.customCommunicationTools = AgentCommunicationProtocolsSchema.convertToolsToProtocolTools(this, customTools);
    }

    onEvent<K extends keyof CommunicationEventMap>(event: K, listener: CommunicationEventMap[K]): () => void {
        const listeners = this.listeners.get(event) ?? new Set();
        const callback = listener as (...args: any[]) => void | Promise<void>;
        listeners.add(callback);
        this.listeners.set(event, listeners);
        return () => listeners.delete(callback);
    }

    emitEvent<K extends keyof CommunicationEventMap>(eventName: K, ...eventArgs: Parameters<CommunicationEventMap[K]>): boolean {
        const listeners = this.listeners.get(eventName);
        if (!listeners) return false;
        for (const listener of listeners) void listener(...eventArgs);
        return listeners.size > 0;
    }

    async discover(_request: DiscoveryRequest): Promise<DiscoveryResult> {
        return { agents: [] };
    }

    async delegate(_request: TaskRequest): Promise<TaskHandle> {
        throw new Error("CustomProtocol delegate transport is not configured");
    }

    async consult(_request: ConsultationRequest): Promise<TaskResult> {
        throw new Error("CustomProtocol consult transport is not configured");
    }

    async cancel(_taskId: TaskId, _reason?: string): Promise<void> {
        throw new Error("CustomProtocol cancellation transport is not configured");
    }

    async getTask(_taskId: TaskId): Promise<TaskSnapshot> {
        throw new Error("CustomProtocol task transport is not configured");
    }
}
```

- Pass common `Tool` instances to the custom protocol constructor. `convertToolsToProtocolTools` converts them into `ProtocolCustomClientTool` instances, so the client stores tools that produce protocol events without requiring manual assignment:
	- `custom_use_communication_tool` before that tool is called
	- `custom_output_communication_tool` - once tool returns outcome
- `customCommunicationTools` can communicate with external tools with `communication adpater`
- `ProtocolCustomClientTool` wraps the underlying tool logic to produce protocol events before and after the tool runs.

The conversion flow is:

1. Define a normal `Tool` containing the operation to perform.
2. Pass the tool to the custom protocol constructor.
3. Let `convertToolsToProtocolTools` create the event-emitting
   `ProtocolCustomClientTool` instance and store it in
   `customCommunicationTools`.
4. Register listeners with `onEvent` and expose the protocol through a
   `ProtocolBinding`.

### Use Custom Tools with a Communication Adapter

`ProtocolCustomClientTool` can expose an operation that communicates with an
external agent. The tool logic performs the outbound call through the custom
protocol client, while `CommunicationProtocolAdapter.handle()` remains the
transport boundary for requests arriving from external agents. The adapter does
not open an outbound connection by itself; the custom transport owns that part.

```ts
import { z } from "zod";
import {
	AgentCommunicationProtocolsSchema,
	CommunicationProtocolWrapperSchema,
	Queues
} from "@ravenlens/raven-adk/communication-protocols";
import { tool } from "@ravenlens/raven-adk";

declare const externalAgentClient: AgentCommunicationProtocolsSchema.ProtocolClient;
declare const externalTransport: CommunicationProtocolWrapperSchema.CommunicationProtocolAdapter; // Define here your transport uses `CommunicationProtocolAdapter`
declare const queue: Queues.QueueSchema.ProtocolTaskQueueSchema;

const askExternalAgent = tool(
	async ({ question }) => {
		const task = await externalAgentClient.delegate({
			from: "planner",
			to: "research-agent",
			activity: "delegate_task",
			message: question
		});
		const result = await task.wait();
		return result.message?.content ?? "The external agent returned no answer.";
	},
	{
		toolName: "ask_external_agent",
		toolDescription: "Ask a remote agent to answer a question.",
		toolArguments: z.object({ question: z.string() })
	}
);
// The constructor converts this common Tool into ProtocolCustomClientTool.
const protocol = new CustomProtocol([askExternalAgent]);
const customTool = protocol.customCommunicationTools[0];

// ProtocolCustomClientTool emits the two custom events around this call.
const answer = await customTool.invoke({ question: "Find the latest Mars water findings." });

// The same protocol can expose an inbound transport adapter for other agents.
const adapter: CommunicationProtocolWrapperSchema.CommunicationProtocolAdapter = {
	async handle(request, context) {
		return externalTransport.handle(request, context);
	}
};

const binding: AgentCommunicationProtocolsSchema.ProtocolBinding = {
	name: "Custom Protocol",
	version: "1.0",
	client: protocol,
	queue
};
```

- Use `ProtocolCustomClientTool` when a ReActAgent should be able to invoke an
  external-agent operation as a tool and receive its result in the reasoning
  loop.
- Use `CommunicationProtocolAdapter` when a transport receives a request and
  must translate it into the canonical communication model. A custom transport
  can pass that request to the adapter and serialize its response using its own
  wire format.
- The same `ProtocolClient` can be used by the tool and by the binding, but the
  outbound client and inbound adapter remain separate responsibilities.

> Each New or Custom agent gives support to `communicationProtocols` has to grant support for tools to be called and for plugins

### Listen Custom Tools Events
```typescript
import {
	AgentCommunicationProtocolsSchema,
	A2A_AgentsCommunicationProtocol as A2A
} from "@ravenlens/raven-adk";
import { ReActAgent } from "@ravenlens/raven-adk/agents";

// `protocol` is the CustomProtocol instance created above. Listen directly on
// the custom client when only this protocol's events are needed.
protocol.onEvent("custom_use_communication_tool", (protocolName, toolName) => {
	console.log(`[${protocolName ?? "custom"}] tool started: ${toolName}`);
});

protocol.onEvent("custom_output_communication_tool", (protocolName, toolName, output) => {
	console.log(`[${protocolName ?? "custom"}] tool finished: ${toolName}`, output);
});

protocol.onEvent("task_submitted", task => {
	console.log(`[${protocol.protocolName ?? "custom"}] task submitted: ${task.taskId}`);
});

// A2A bindings expose the same ProtocolClient event contract. The A2A client
// emits task lifecycle events while delegate/consult tools are running.
const a2aBinding = A2A.createBinding({
	endpoint: "https://research.example.com/a2a",
	participant: { id: "planner", name: "Planning Agent" }
});

a2aBinding.client.onEvent("task_completed", result => {
	console.log(`[${a2aBinding.name}] task completed: ${result.taskId}`);
});

a2aBinding.client.onEvent("task_failed", (taskId, error) => {
	console.error(`[${a2aBinding.name}] task failed: ${taskId}`, error.message);
});

// ProtocolCustomClientTool is already a Tool. ReActAgent automatically adds
// every item in client.customCommunicationTools to its model tool list.
const agent = new ReActAgent({
	model,
	systemPrompt: "Use remote agents when their expertise is useful.",
	messages: [],
	tools: [],
	communicationProtocols: [
		customBinding,
		a2aBinding
	]
});

// Observe every protocol event through the agent, regardless of its source.
agent.onEvent("protocol_event", (protocolName, eventName, taskId, eventArgs) => {
	console.log({ protocolName, eventName, taskId, eventArgs });
});

// This also receives custom_use_communication_tool and
// custom_output_communication_tool events from customBinding.
await agent.invoke({
	messages: [{
		type: "user",
		content: "Ask the research network for the latest Mars water findings."
	}]
});
```

- `ProtocolClient.onEvent()` listens to events from one protocol client. It
  returns an unsubscribe function, so a temporary listener can be removed with
  `const stop = protocol.onEvent(...); stop();`.
- `custom_use_communication_tool` fires immediately before a custom tool runs;
  `custom_output_communication_tool` fires after it returns its string output.
- `task_submitted`, `task_progress`, `task_completed`, `task_failed`, and the
  other lifecycle events use the same canonical event names for custom clients,
  A2A, and other protocol implementations.
- `ReActAgent` automatically registers `client.customCommunicationTools` and
  the standard delegate/consult tools. Do not add the same converted tool to
  `tools` a second time unless you intentionally want a different tool name.
- `ReActAgent.onEvent("protocol_event", ...)` is the unified application-level
  listener. Its arguments are `protocolName`, `eventName`, an optional
  `taskId`, and the original protocol event arguments in `eventArgs`.
- The protocol client receives and emits protocol-specific events; the agent
  listener observes them. Calling `invoke()` still awaits the selected tool's
  result, so the returned external answer continues through the ReAct loop.

### Define a System Prompt for a Custom Client Protocol

Use the optional `systemPrompt` on `ProtocolBinding` to describe how the agent
should use a custom client protocol. This instruction is added to the agent's
protocol context when the binding is attached to `ReActAgent` or anyother agent. Keep protocol
instructions focused on the operations and tools exposed by the custom client.

```ts
const customClient = new CustomProtocol([askExternalAgent]);

const customBinding: AgentCommunicationProtocolsSchema.ProtocolBinding = {
	name: "Research Network Protocol",
	version: "1.0",
	client: customClient,
	systemPrompt: `
You can communicate with the Research Network through the custom protocol.
Use the ask_external_agent tool when you need information from a remote agent.
Address research requests to research-agent and summarize the returned answer
before continuing your response.
`,
	participant: {
		id: "planner",
		name: "Planning Agent",
		description: "Coordinates work with the research network."
	}
};

const agent = new ReActAgent({
	model,
	systemPrompt: "Solve the user's request and use available protocol tools when needed.",
	messages: [],
	tools: [],
	communicationProtocols: [customBinding]
});

await agent.invoke({
	messages: [{ type: "user", content: "Ask the research network about Mars water findings." }]
});
```

The binding's `systemPrompt` supplements the agent's general `systemPrompt`.
The custom client remains responsible for implementing `delegate`, discovery,
and the tool behavior; the prompt only tells the agent when and how to use
those protocol capabilities.

## Communication Wrapper

Wrap the agent protocol in a transport such as HTTP, JSON-RPC, Kafka,
RabbitMQ, MQTT, WebRTC, or an in-process channel. Implement the transport
boundary with the types in
[`communicationProtocolSchema.ts`](../../../src/agent/communication-protocols/communicationProtocols/communicationProtocolSchema.ts).
The wrapper translates transport payloads to the agent protocol and maps
responses, errors, and events back to the canonical model.

### Match the Communication Adapter to the Agent Protocol

The communication adapter is the boundary between a transport and an agent
protocol. The transport converts its native message into a
`CommunicationRequest`. The adapter interprets `request.method` and
`request.params` according to the agent protocol, uses the binding's queue or
client, and returns a `CommunicationResponse`. The transport then serializes
that response in its own wire format.

Use the same binding and queue when handling transport messages and serving the
agent. The adapter enqueues the canonical `TaskRequest`; `agent.serve()`
dequeues and processes that task. This keeps the transport independent from
whether the binding carries a custom protocol, A2A, or another implementation.

```ts
import type {
	CommunicationProtocolAdapter,
	CommunicationRequest,
	CommunicationResponse
} from "@ravenlens/raven-adk/communication-protocols";

const adapter: CommunicationProtocolAdapter = {
	async handle(request, { binding, queue }): Promise<CommunicationResponse> {
		if (request.method !== "task/submit") {
			return { error: { code: -32601, message: "Method not supported" } };
		}

		const taskId = await queue.enqueue({
			from: String(request.params.from),
			to: String(request.params.to),
			message: String(request.params.message),
			activity: "delegate_task"
		});

		return { result: { protocol: binding.name, taskId, status: "submitted" } };
	}
};

async function handleTransportMessage(payload: {
	id: string;
	type: string;
	params: Record<string, unknown>;
}): Promise<CommunicationResponse> {
	const request: CommunicationRequest = {
		id: payload.id,
		method: payload.type,
		params: payload.params
	};

	return adapter.handle(request, { binding, queue });
}
```

Here `task/submit` is an application-defined agent-protocol method. For a
different protocol, change the method mapping and queued `TaskRequest` fields
to that protocol's semantics; the transport callback and adapter contract stay
the same.

### Implement a RabbitMQ Custom Communication Protocol

RabbitMQ is a transport, not an agent protocol. A RabbitMQ wrapper consumes
native messages, normalizes them to `CommunicationRequest`, passes them to
`CommunicationProtocolAdapter.handle()`, and publishes the resulting
`CommunicationResponse` to the reply queue. The same queue-backed binding is
passed to `ReActAgent.serve()` so submitted work reaches the worker.

The example below uses `amqplib`. `CustomProtocol` is the `ProtocolClient`
implementation described above; passing `askExternalAgent` to its constructor
converts the ordinary tool into a `ProtocolCustomClientTool` before the tool is
made available through the binding.

```ts
import amqp, { type Channel, type Connection } from "amqplib";
import {
	AgentCommunicationProtocolsSchema,
	CommunicationProtocolWrapperSchema,
	Queues
} from "@ravenlens/raven-adk/communication-protocols";
import { ReActAgent } from "@ravenlens/raven-adk/agents";

const customClient = new CustomProtocol([askExternalAgent]);
const queue = new Queues.QueuesLib.InMemoryProtocolTaskQueueSchema();
const binding: AgentCommunicationProtocolsSchema.ProtocolBinding = {
	name: "RabbitMQ Custom Protocol",
	version: "1.0",
	client: customClient,
	queue,
	participant: { id: "worker", name: "Worker Agent" },
	systemPrompt: `
Use the ask_external_agent tool when a remote agent can provide information.
Send research requests through the RabbitMQ custom protocol and summarize the
returned result before continuing.
`
};

const adapter: CommunicationProtocolWrapperSchema.CommunicationProtocolAdapter = {
	async handle(request, context) {
		if (request.method !== "task/submit") {
			return { error: { code: -32601, message: "Method not supported" } };
		}

		const taskId = await context.queue.enqueue({
			from: String(request.params.from),
			to: String(request.params.to),
			message: String(request.params.message),
			activity: "delegate_task"
		});

		return { result: { protocol: context.binding.name, taskId, status: "submitted" } };
	}
};

class RabbitMQProtocolServer {
	constructor(
		private readonly channel: Channel,
		private readonly inputQueue: string,
		private readonly replyQueue: string
	) {}

	async start(): Promise<void> {
		await this.channel.assertQueue(this.inputQueue, { durable: true });
		await this.channel.consume(this.inputQueue, async (message) => {
			if (!message) return;

			const payload = JSON.parse(message.content.toString()) as {
				id: string;
				type: string;
				params: Record<string, unknown>;
			};
			const request: CommunicationProtocolWrapperSchema.CommunicationRequest = {
				id: payload.id,
				method: payload.type,
				params: payload.params
			};
			const response = await adapter.handle(request, { binding, queue });

			this.channel.sendToQueue(
				message.properties.replyTo ?? this.replyQueue,
				Buffer.from(JSON.stringify(response)),
				{ correlationId: message.properties.correlationId }
			);
			this.channel.ack(message);
		});
	}
}

const connection: Connection = await amqp.connect(process.env.RABBITMQ_URL!);
const channel = await connection.createChannel();
const server = new RabbitMQProtocolServer(channel, "agent.tasks", "agent.replies");
await server.start();

const agent = new ReActAgent({
	model,
	systemPrompt: "Solve the user's request and use remote research when needed.",
	messages: [],
	tools: [],
	communicationProtocols: [binding]
});

await agent.serve(binding);
```

`customClient` owns outbound communication and exposes its converted custom
tools through the binding. The binding's `systemPrompt` is protocol-specific
guidance added alongside the agent's general prompt when the binding is
attached. RabbitMQ owns connection handling, acknowledgements, serialization,
and reply routing; the adapter owns translation into the canonical agent
protocol. In production, replace the in-memory queue with a durable
`ProtocolTaskQueueSchema` implementation and add authentication, retry,
dead-letter, and shutdown handling for the RabbitMQ deployment.

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

Queues also provide typed lifecycle events through `onEvent` and `emitEvent`.
Subscribe with `onEvent` and remove the subscription with the returned function:

```ts
const stopQueueLogging = queue.onEvent("task_dequeued", task => {
    console.log(`Worker claimed ${task.taskId}`);
});

queue.onEvent("task_cancelled", cancellation => {
    console.log(`Task ${cancellation.taskId} was cancelled`);
});

stopQueueLogging();
```

The available queue events are `task_enqueued`, `task_dequeued`,
`task_completed`, `task_failed`, `task_cancelled`, and `error`. Events use the
canonical `QueuedTask`, `TaskResult`, `ProtocolError`, and `Cancellation`
payloads. `emitEvent` returns `true` when listeners are present and dispatches
async listeners without making queue operations wait for them.

### Implement a Custom Queue

For a durable or distributed custom queue, implement every operation in
`ProtocolTaskQueueSchema` and the event methods. Replace the storage operations
with database or broker calls, and emit only after each operation succeeds:

```ts
class PostgresTaskQueue implements ProtocolTaskQueueSchema {
	onEvent<K extends ProtocolQueueEvent>(event: K, listener: ProtocolQueueEventMap[K]): () => void { /* register listener */ throw new Error("not implemented"); }
	emitEvent<K extends ProtocolQueueEvent>(event: K, ...args: Parameters<ProtocolQueueEventMap[K]>): boolean { /* notify listeners */ return false; }
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
