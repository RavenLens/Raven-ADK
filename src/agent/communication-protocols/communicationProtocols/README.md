# Communication Protocols

Communication protocols are transport wrappers used to carry an agent protocol
between RavenADK agents and external agents. The wrapper may use HTTP,
JSON-RPC, Kafka, RabbitMQ, MQTT, WebRTC, an in-process channel, or another
transport. It translates transport payloads into the canonical agent protocol
model and maps responses back again.

An agent protocol defines the agent-to-agent semantics; a communication
protocol defines how those semantics travel. Keeping the layers separate lets
the same A2A or custom agent protocol use different transports and lets an
agent remain independent from networking details.

## Schema

The [communicationProtocolSchema.ts](./communicationProtocolSchema.ts) file
defines the transport-neutral request, response, adapter, and server contracts.
Every wrapper should follow this schema because RavenADK agent and protocol
implementations already depend on the normalized communication model. This
prevents each transport from requiring a separate agent integration.

`CommunicationProtocolAdapter` is the main extension point for a custom
wrapper. It receives a normalized request and returns a normalized response;
the transport is responsible for serialization, connection handling,
authentication, retries, and other delivery concerns.

The schema is intentionally independent of any particular agent protocol. A
wrapper can carry A2A or a custom protocol, provided it maps that protocol to
the canonical contract. See the [custom protocol guide](../../../../documentation/agents-communication-protocols/custom-protocol/README.md).

## Usage

### Outbound Protocol Binding

Create an agent-protocol binding and pass it to an agent when the application
needs to delegate work to a remote participant:

```ts
import { A2A } from "@ravenlens/raven-adk";
import { ReActAgent } from "@ravenlens/raven-adk/agents";

const protocol = A2A.createBinding({
	endpoint: "https://research-agent.example.com/rpc",
	participant: {
		id: "planner-agent",
		name: "Planner Agent",
		capabilities: ["delegate_task", "consult_agents"]
	}
});

const agent = new ReActAgent({
	model,
	systemPrompt: "Delegate research when another agent can help.",
	messages: [],
	tools: [],
	communicationProtocols: [protocol]
});

const result = await agent.invoke("Find primary sources about Mars water reservoirs.");
```

The binding translates the canonical task and event types into the selected
agent protocol. The agent does not need to know whether the binding uses A2A,
another protocol, or a different transport.

### Inbound HTTP Protocol

Use the generic HTTP wrapper when a communication-protocol adapter should accept
requests from external agents. The wrapper supplies an in-memory queue when the
binding does not provide one:

```ts
import { createHttpProtocolServer } from "./protocols/http.js";
import { InMemoryProtocolTaskQueueSchema } from "../queues/queue-types/InMemory.js";
import type { ProtocolBinding } from "../agentProtocols/agentProtocolSchema.js";

const server = createHttpProtocolServer({
	binding: {
		name: "Custom agent protocol",
		version: "1.0",
		client: customClient,
		queue: new InMemoryProtocolTaskQueueSchema()
	},
	agent: { id: "worker-agent", name: "Worker Agent" },
	path: "/communication",
	adapter: customAdapter
});

await server.listen(8080, "127.0.0.1");
```

The adapter receives a normalized `CommunicationRequest`, enqueues a
canonical `TaskRequest`, and returns a normalized `CommunicationResponse`.
`ReActAgent.serve(server.binding)` can then consume the queue in a worker
process.

### Custom Communication Adapter

An adapter maps the native transport method to the agent-protocol schema. This
example accepts a simple task submission method:

```ts
const customAdapter: CommunicationProtocolAdapter = {
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
```

The adapter is deliberately independent from HTTP. The same adapter can be
used by another transport wrapper that produces the same normalized request
shape.

## Queues

Use a queue when communication is asynchronous, long-running, or processed by
a separate worker. The wrapper enqueues inbound work, while an agent worker
dequeues and processes it, then publishes completion, failure, or cancellation.
Queue implementations follow
[`ProtocolTaskQueueSchema`](../queues/queueSchema.ts), which keeps the wrapper
independent from storage and allows in-memory, PostgreSQL, Redis, MongoDB, S3,
or other implementations. See the [queue guide](../queues/README.md).
