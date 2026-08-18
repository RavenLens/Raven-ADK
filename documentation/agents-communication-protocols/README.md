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
| [A2A (Agent-to-Agent)](./a2a/README.md) | Interoperable communication between local or remote agents. | The RavenADK protocol namespace exists; the guide is being expanded. |
| [ACP (Agent Communication Protocol)](./acp/README.md) | Communication for edge and local agentic systems. | The RavenADK protocol namespace exists; the guide is being expanded. |
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
| `task_queued` | A task is accepted into a local or remote work queue. |
| `task_accepted` | A participant accepts responsibility for the task. |
| `task_started` | Task execution begins. |
| `task_progress` | A participant reports progress before the task reaches a terminal state. |
| `task_completed` | A task finishes successfully and produces a result. |
| `task_failed` | A task cannot complete because execution returned an error. |
| `task_rejected` | A participant or policy refuses the task before execution. |
| `task_cancellation_requested` | A caller requests that task execution stop. |
| `task_aborted` | Task execution stops before producing a normal completion. |
| `handoff_start` | Responsibility for a task or task fragment is being transferred. |
| `handoff_end` | A handoff workflow finishes and returns its result. |
| `handoff_error` | A handoff workflow fails. |
| `consultation_start` | An agent requests advice while retaining task responsibility. |
| `consultation_end` | A consultation workflow returns its result. |
| `consultation_error` | A consultation workflow fails. |
| `critique_start` | An agent requests a review of work or a result. |
| `critique_end` | A critique workflow returns its result. |
| `critique_error` | A critique workflow fails. |
| `discovery_start` | Agent, skill, tool, or knowledge discovery begins. |
| `discovery_end` | Discovery returns available capabilities or resources. |
| `discovery_error` | Discovery fails. |
| `message_sent` | A protocol message is sent to another participant. |
| `message_received` | A protocol message is received from another participant. |
| `tool_invoked` | A communication-related tool is requested. |
| `tool_executed` | A communication-related tool returns an output. |
| `artifact_created` | A task creates an artifact. |
| `artifact_attached` | An artifact is attached to a message or task result. |
| `approval_requested` | A task requires human or policy approval. |
| `approval_resolved` | An approval request is accepted, rejected, or otherwise resolved. |

The event contract is exposed through two complementary methods:

| Method | Used by | Responsibility |
| --- | --- | --- |
| `onEvent` | The application or protocol consumer | Register a typed listener for events and react to progress, results, errors, or cancellation. |
| `emitEvent` | Internal protocol and agent logic | Emit a typed event to the registered listeners after local or bound protocol work changes state. |

Users listen to events through `onEvent`; they do not need to know whether the
event came from an in-process agent, a remote binding, or a particular
transport. `emitEvent` is an internal implementation mechanism used to publish
the canonical event, including events normalized from a protocol binding.

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
- [ACP overview](./acp/README.md)
- [G4A overview](./g4a/README.md)
- [Communication architecture notes](../../src/agent/communication-protocols/Vision.md)

The A2A and ACP pages are intentionally linked from this overview while their
protocol-specific guides are still being developed. The architecture notes
describe the canonical model and integration direction in more detail.
