# Agent Protocols

An agent protocol defines how one agent communicates with another agent at the
application or wire level. It describes discovery, delegation, messages, task
states, results, errors, events, and cancellation.

Each implementation follows [agentProtocolSchema.ts](./agentProtocolSchema.ts).
The schema is the compatibility boundary because RavenADK agents implement
their communication behavior against these canonical types and operations.
Following it allows the same agent logic to work with A2A or a custom agent
protocol without protocol-specific changes in the agent.

An agent protocol is not the same as its transport. The protocol can be carried
by an HTTP, JSON-RPC, Kafka, RabbitMQ, MQTT, WebRTC, or local wrapper. See the
[communication protocol documentation](../communicationProtocols/README.md)
for the transport layer.

## Custom Agent Protocols

To add one, implement `ProtocolClient`, map the native protocol to the
canonical request, task, result, and event types, and expose the client through
a `ProtocolBinding`. Add protocol-specific fields only in metadata or in the
native adapter; keep the shared contract stable so `ReActAgent`, tools, and
plugins can consume it consistently.

```ts
import type {
	CommunicationEventMap,
	ConsultationRequest,
	DiscoveryRequest,
	DiscoveryResult,
	ProtocolClient,
	TaskHandle,
	TaskRequest,
	TaskResult,
	TaskSnapshot
} from "./agentProtocolSchema.js";

class CustomProtocolClient implements ProtocolClient {
	async discover(request: DiscoveryRequest): Promise<DiscoveryResult> {
		return this.send("agents/discover", request);
	}

	async delegate(request: TaskRequest): Promise<TaskHandle> {
		return this.send("tasks/delegate", request);
	}

	async consult(request: ConsultationRequest): Promise<TaskResult> {
		return this.send("tasks/consult", request);
	}

	async getTask(taskId: string): Promise<TaskSnapshot> {
		return this.send("tasks/get", { taskId });
	}

	async cancel(taskId: string, reason?: string): Promise<void> {
		await this.send("tasks/cancel", { taskId, reason });
	}

	onEvent<K extends keyof CommunicationEventMap>(
		event: K,
		listener: CommunicationEventMap[K]
	): () => void {
		return this.subscribe(event, listener);
	}

	private send<T>(operation: string, payload: unknown): Promise<T> {
		// Translate operation and payload to the native protocol here.
		throw new Error(`Implement ${operation}`);
	}

	private subscribe<K extends keyof CommunicationEventMap>(
		event: K,
		listener: CommunicationEventMap[K]
	): () => void {
		// Register the native event and map it to the canonical event payload.
		void event;
		void listener;
		return () => undefined;
	}
}

const customBinding: ProtocolBinding = {
	name: "Contoso Agent Protocol",
	version: "1.0",
	client: new CustomProtocolClient(),
	participant: { id: "planner", name: "Planner Agent" }
};
```

Each method translates the canonical request or result to the native protocol.
The agent only receives the stable `ProtocolClient` and `ProtocolBinding`
interfaces.

## Protocol Factory

While making the protocols use `AgentCommunicationProtocolFactory` to maintain a consistent factory shape
among protocols. It describes a reusable protocol definition, while the
`ProtocolBinding` returned by `createBinding()` is the configured runtime
instance used by RavenADK agents.

The factory metadata is optional and declarative. It can identify supported
protocol `versions`, `transports`, `activities`, inbound queue support,
discovery metadata, a stable `identifier`, documentation, and compatibility
requirements. These fields help registries and host applications select and
describe protocols; `createBinding()` remains responsible for constructing the
working client and binding.

```ts
const customProtocol: AgentCommunicationProtocolFactory<CustomOptions> = {
	name: "Contoso Agent Protocol",
	identifier: "com.contoso.agent-protocol",
	versions: ["1.0"],
	transports: ["http", "redis"],
	activities: ["delegate_task", "consult_agents"],
	supportsInboundQueue: true,
	documentationUrl: "https://docs.example.com/agent-protocol",
	discoveryMetadata: { vendor: "Contoso", regionAware: true },
	compatibility: { ravenAdk: ">=0.0.14" },
	createBinding: options => createCustomBinding(options)
};

const binding = customProtocol.createBinding({
	endpoint: "https://agents.example.com",
	participant: { id: "planner", name: "Planner Agent" }
});

const task = await binding.client.delegate({
	from: binding.participant!,
	to: { id: "researcher", name: "Research Agent" },
	activity: "delegate_task",
	message: "Find primary sources about Mars water reservoirs."
});
```

The factory can be registered once and used to create multiple configured
bindings for different endpoints or participants.