# Agent Communication Protocols

AI-Agent communication protocols give RavenADK agents a common way to discover
one another, delegate work, exchange messages, and coordinate results across
local, remote, and parallel workflows.

The useful question is not only *which agent can answer?* It is also *which
agent is adjacent to this task and best positioned to help?* Communication
protocols provide the boundary for making that choice explicit while keeping
agent implementations independent from network transports and wire formats.

## What This Layer Owns

The communication layer is responsible for the semantics of agent-to-agent
work. It can describe:

- agent identity, specialization, capabilities, limits, and availability;
- task requests, delegation, handoffs, consultations, and critiques;
- messages, structured data, tool calls, artifacts, and approvals;
- task lifecycle events, progress, cancellation, errors, and resource usage;
- discovery of agents, skills, tools, and knowledge sources.

It does not require a particular transport. A binding may use an external
protocol or a local in-process adapter, depending on the deployment.

## Protocol Landscape

These are the protocol surfaces currently represented in the repository:

| Protocol | Focus | Documentation and implementation status |
| --- | --- | --- |
| [A2A (Agent-to-Agent)](./a2a/README.md) | HTTP JSON-RPC communication with remote agents. | Outbound client binding implemented; inbound server queue is not yet included. |
<!-- | [ACP (Agent Communication Protocol)](./acp/README.md) | Communication for edge and local agentic systems. | The RavenADK protocol namespace exists; the guide is being expanded. | -->
<!-- | [G4A](./g4a/README.md) | Agent treats agents pool  | -->
| Custom Protocols with RavenADK bindings | An application-specific protocol mapped to the RavenADK communication model. | Use the canonical concepts below as the compatibility boundary with whatever protocol you wish to hug. |

Protocol names describe different wire-level or topology choices. They should
not change the way an agent reasons about a task, reports a result, or handles
cancellation.

## RavenADK Integration

The communication model is intended to work with `ReActAgent`, `AgentsDebate`,
coding agents as `CodeAct` and `SupervisedCodeAct`, and custom agent abstractions. Integration is split into small
surfaces so a host application can choose who controls communication:

| Surface | Use it when | Typical responsibilities |
| --- | --- | --- |
| **Protocol client** | The host or orchestrator must make the decision deterministically. | Discovery, task invocation, cancellation, retries, fallback, and subscriptions. |
| **Tools** | The model should decide whether another agent is useful. | Narrow actions such as discovering agents, delegating a task, requesting a consultation, or critiquing a result. |
| **Plugins** | The behavior must happen automatically around execution. | Authorization, policy, budgets, tracing, metadata, event handling, and data filtering. |
| **Queue** | Delegated work may outlive the current model step. | Tracking pending handoffs and preventing a workflow from completing before required tasks finish. |
| **Events** | The application needs observable progress. | Reporting task state, messages, artifacts, handoffs, failures, and completion. |

Tools should expose constrained protocol operations rather than raw HTTP,
MQTT, WebRTC, or other transport clients. Plugins and host code can enforce
security and resource policy before anything leaves the local agent boundary.

### ReActAgent Example

Any object satisfying `ProtocolBinding` can be supplied to ReActAgent. The A2A
factory creates such an object:

```ts
import { A2A } from "@ravenlens/raven-adk";
import { ReActAgent } from "@ravenlens/raven-adk/agents";

const protocol = A2A.createBinding({
	endpoint: "https://remote-agent.example.com/rpc",
	participant: {
		id: "local-agent",
		name: "Local ReAct Agent",
		capabilities: ["delegate_task", "consult_agents"]
	}
});

const agent = new ReActAgent({
	model,
	systemPrompt: "Use delegated research when it improves the answer.",
	messages: [],
	tools: [],
	communicationProtocols: [protocol]
});

await agent.invoke("Ask a specialist to review this question.");
```

During construction, ReActAgent subscribes to the protocol client's canonical
events and registers delegation and consultation tools. A delegation tool calls
`client.delegate()`, then awaits the returned `TaskHandle.wait()` before
returning its tool output. This keeps remote work inside the normal ReAct
Reason/Act/Observe loop and prevents the invocation from completing before the
remote task reaches a terminal state.

The A2A binding currently covers outbound work. ReActAgent's `serve()` method
requires a binding with an inbound `queue`; an A2A binding must be paired with a
server-side transport and adapter before it can receive remote tasks.

## Core Communication Flows

### Discovery and exploration

An agent or orchestrator discovers candidate agents and inspects the metadata
needed to choose between them: specialization, capabilities, connected tools,
skills, current availability, limits, and supported protocol bindings.

### Delegation and handoff

- **Delegation** asks another agent to perform a task while the current agent
  remains responsible for the overall workflow.
- **Handoff** transfers responsibility for a task or a part of a task.
- Multiple independent tasks may be delegated in parallel when the workflow
  and resource budget allow it.

The request should carry enough context for the receiving agent to work
without exposing internal implementation objects. A result should identify the
task, report its status, and return the relevant messages, structured result,
artifacts, errors, and resource usage.

### Consultation and critique

An agent can ask one or more agents for advice or a review while retaining
responsibility for the final result. This is useful for `AgentsDebate`, code
review, fact checking, and other workflows where the consulted agent should
not silently take ownership of the task.

### Events and cancellation

Events are part of the shared, protocol-neutral contract. Every A2A, ACP,
G4A/GACP, or custom communication-protocol implementation receives the same
event contract; an implementation must not replace it with a protocol-specific
set of lifecycle events. Event names and payloads are documented as typed
entries in the canonical schema, and each protocol binding maps its native
events to those entries.

| Event name | Emitted when |
| --- | --- |
| `activity_started` | A protocol activity begins processing. |
| `task_submitted` | A task is accepted by the remote protocol. |
| `task_progress` | A participant reports progress before the task reaches a terminal state. |
| `task_completed` | A task finishes successfully and produces a result. |
| `task_failed` | A task cannot complete because execution returned an error. |
| `task_cancelled` | A task is cancelled by a caller or participant. |
| `agent_discovered` | An agent card matches a discovery request. |
| `message_published` | A protocol message is published independently of task completion. |
| `authentication_required` | The protocol requires credentials or another authentication step. |
| `error` | The protocol encounters a transport-level or binding-level error. |

The event contract is exposed through `onEvent` on `ProtocolClient`. Protocol
bindings emit normalized events internally; consumers do not need to know which
transport produced them.

| Method | Used by | Responsibility |
| --- | --- | --- |
| `onEvent` | The application or protocol consumer | Register a typed listener for events and react to progress, results, errors, or cancellation. |

Cancellation should be explicit and propagate through the same task identity
used for invocation, so local queues and remote bindings can stop or reconcile
work consistently.



## Design Boundaries

The architecture has four distinct layers:

1. **Canonical model** defines protocol-neutral identities, tasks, messages,
	results, events, artifacts, budgets, errors, and cancellation.
2. **Agent adapters** expose an agent as a participant without serializing its
	model client, memory, tools, internal state, or runtime objects.
3. **Protocol bindings** translate the canonical model to and from A2A, ACP,
	GACP, or another wire protocol.
4. **Transports** carry the bound messages over HTTP, SSE, MQTT, WebRTC,
	in-process channels, or another supported mechanism.

Keeping these boundaries separate makes it possible to add a protocol without
rewriting agent reasoning, and to move an agent between local and remote
execution without changing its task semantics.

## Recommended Workflow

1. Discover agents and compare their capabilities with the task.
2. Choose a deterministic client call or expose a constrained tool.
3. Create a task with context, delegation mode, budget, and cancellation data.
4. Apply authorization and data-sharing policy before transmission.
5. Track events and pending work through the queue when execution is
	asynchronous or parallel.
6. Validate the returned status, result, artifacts, and resource usage.
7. Preserve the task and event identifiers for retries, tracing, and follow-up
	communication.

## Documentation Map

- [A2A overview](./a2a/README.md)
<!-- - [ACP overview](./acp/README.md)
- [G4A overview](./g4a/README.md) -->
- [Communication architecture notes](../../src/agent/communication-protocols/Vision.md)

The A2A and ACP pages are intentionally linked from this overview while their
protocol-specific guides are still being developed. The architecture notes
describe the canonical model and integration direction in more detail.
