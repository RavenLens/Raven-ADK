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
