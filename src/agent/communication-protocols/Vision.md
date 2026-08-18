# Communication Protocols

## Purpose

Communication protocols provide a common agent-to-agent communication model for
local and remote agents. The model must be usable by:

- ReActAgent
- CodeAgents
- AgentsDebate

The common model is then mapped to external protocols and transports such as:

- A2A
- ACP
- GACP
- MCP
- custom protocols
- HTTP, SSE, MQTT, WebRTC, and in-process transports

The canonical protocol schema describes data and semantics. It must not contain
transport code or live agent implementations.

## Architecture

```text
ReActAgent / CodeAgent / AgentsDebate
				|
				v
		AgentProtocolParticipant
				|
				v
		  AgentProtocolClient
				|
				v
	   Canonical communication schema
				|
		+-------+--------+--------+
		|                |        |
	   A2A              ACP      GACP
	  binding           binding  binding
		|                |        |
	  HTTP/SSE          HTTP     MQTT/WebRTC/MCP
```

The layers have separate responsibilities:

1. **Canonical schema** defines agents, tasks, messages, results, events,
   artifacts, discovery, budgets, errors, and cancellation.
2. **Protocol client** provides a protocol-neutral runtime API to an agent or
   orchestrator.
3. **Protocol binding** translates the canonical model to and from A2A, ACP,
   GACP, or another wire protocol.
4. **Tools** expose selected protocol operations to the model, allowing the
   model to decide when communication is useful.
5. **Plugins** perform automatic lifecycle, policy, authorization, tracing,
   budget, and event handling.

## How Agents Use Protocols

Use all three integration surfaces, but for different purposes.

### Direct client calls

Use `AgentProtocolClient` when the host application or orchestrator decides
that communication must happen. This is the preferred mechanism for:

- AgentsDebate participant selection and invocation
- mandatory code review or testing stages
- deterministic handoff and retry logic
- system-controlled routing and fallback
- security and policy operations

```ts
export interface AgentProtocolClient {
	discoverAgents(
		request: AgentDiscoveryRequest
	): Promise<AgentDiscoveryResult>;

	invoke(request: TaskRequest): Promise<TaskResult>;

	send(message: AgentMessage): Promise<void>;

	cancel(taskId: string, reason?: string): Promise<void>;

	subscribe(
		listener: (event: AgentEvent) => void | Promise<void>
	): () => void;
}
```

### Tools

Use tools when the model should decide whether another agent or network
resource is needed. Tools wrap the protocol client and expose narrow actions:

- `discover_agents`
- `delegate_task`
- `ask_agent`
- `consult_agents`
- `critique_result`
- `seek_skill`
- `seek_knowledge`
- `get_agent_status`

The model should never receive a raw MQTT client, HTTP client, WebRTC channel,
or protocol binding. It receives a constrained tool whose implementation uses
the protocol client.

```ts
export interface DelegateTaskToolArguments {
	task: string;
	agentId?: string;
	selectionInstruction?: string;
	mode?: "execute" | "handoff" | "consultation" | "critique";
	expectedOutputSchemaId?: string;
}
```

For `ReActAgent`, protocol tools are added through `ReActAgentConfig.tools`.
The agent can then request delegation while retaining its existing reasoning,
tool, memory, abort, and event behavior.

### Plugins

Use plugins for behavior that must happen automatically around agent execution:

- attach task and conversation metadata
- authorize or reject delegation
- enforce token, time, action, and artifact budgets
- subscribe to remote lifecycle events
- publish local lifecycle events
- record distributed traces
- trigger automatic handoff after failure
- filter secrets and workspace data before transmission

The current ReAct plugin lifecycle supports `before_agent_run`,
`after_agent_run`, `before_model_call`, and `after_model_call`. Protocol
authorization immediately before every remote call may eventually require
`before_tool_execution` and `after_tool_execution` hooks as well.

> Events of agent can be used too or extend the agent plugin execution places e.g: for the subagent

## Protocol Participant

Local adapters expose agents through a common participant interface. A
participant contains an identity, not a serialized agent instance.

```ts
export interface AgentProtocolParticipant {
	identity: AgentIdentity;

	invoke(request: TaskRequest): Promise<TaskResult>;

	subscribe?(
		listener: (event: AgentEvent) => void | Promise<void>
	): () => void;

	cancel?(taskId: string, reason?: string): Promise<void>;
}
```

`ReActAgent`, coding agents, and `AgentsDebate` should each have adapters that
implement this interface. Internal objects such as `AgentMessagesGraphState`,
`MessagesVariations`, `Tool`, model clients, functions, and Zod instances must
remain inside those adapters.

## Core Concepts

The future `schema.ts` should contain these canonical concepts:

### Agent identity and capabilities

- stable agent id and display name
- agent kind: ReAct, coding, debate, graph, or custom
- description and specialization
- capabilities such as tool use, code execution, handoff, critique, and
  discovery
- advertised limits and supported protocol bindings

### Task requests and results

A task request should include:

- task id
- objective
- sender and optional recipient
- conversation reference
- context and previous messages
- participants
- delegation mode
- requested structured output format
- resource budget
- cancellation id

A task result should include:

- task id and conversation reference
- status: queued, accepted, running, completed, partial, failed, aborted, or
  rejected
- summary and optional structured result
- messages and artifacts
- resource usage
- structured protocol error
- optional next action

### Delegation modes

The canonical model should support:

- `execute`: ask one agent to perform a task
- `handoff`: transfer responsibility to another agent
- `consultation`: ask agents for advice while another agent remains responsible
- `critique`: ask agents to review an execution or result
- `parallel`: execute independent requests concurrently

```ts
export interface DelegationRequest {
	mode: "execute" | "handoff" | "consultation" | "critique" | "parallel";
	recipientAgentIds?: string[];
	selectionInstruction?: string;
	conclusionAgentId?: string;
	loops?: number;
	parallel?: boolean;
}
```

### Messages and content parts

Messages should be transport-neutral and support:

- text and instructions
- structured JSON
- tool calls and tool results
- code
- artifacts
- approval requests

Every message should have an id, sender, creation time, recipients, and causal
references such as `replyTo` and `causationId`. This is required for debate
rounds, handoffs, retries, and distributed tracing.

### Events

> Protocol has to produce events

Events are observable lifecycle records and may be streamed or persisted. They
should cover:

- task queued, accepted, started, completed, failed, and aborted
- task progress
- messages and tool execution
- artifact creation
- handoff, consultation, and critique
- skill and knowledge discovery
- approval requests

Reasoning events may be exposed for local observability, but reasoning traces
must not be required for interoperability. Agents should make decisions from
messages, tool results, artifacts, and task results.

### Artifacts

Artifacts are essential for CodeAgents. The schema should support references to:

- files and directories
- patches and diffs
- test reports
- command output
- conversation transcripts
- knowledge resources

Small artifacts may contain inline content. Large artifacts should use a URI,
path, checksum, or external storage reference.

### Budgets, usage, cancellation, and errors

Budgets should support tokens, time, rounds, actions, and artifact count. Usage
should report input tokens, output tokens, total tokens, duration, rounds, and
actions when available.

Errors must be serializable rather than native `Error` objects. Useful codes
include:

- `invalid-request`
- `unsupported-capability`
- `not-found`
- `unauthorized`
- `payment-required`
- `queue-full`
- `budget-exceeded`
- `timeout`
- `aborted`
- `tool-failure`
- `execution-failure`
- `validation-failure`
- `transport-failure`

## GACP Extensions & Extensibility

> Agent has to be extensible

GACP includes network features that are not required by every agent protocol:

- agent discovery and relation graphs
- occupation, queue, and throughput status
- skill and knowledge discovery
- marketplace and payment
- knowledge access and replication
- broker events

These should be implemented as GACP bindings and extensions, rather than
mandatory fields in the core schema.

```ts
export interface GACPTaskExtension {
	relationGraphId?: string;

	payment?: {
		required: boolean;
		currency?: string;
		amount?: number;
	};

	knowledgeAccess?: {
		scope: string;
		replicationAllowed?: boolean;
	};
}
```

GACP mappings include:

```text
delegateTaskToAgent() -> TaskRequest with delegation.mode = "execute"
seekSkill()           -> SkillDiscoveryRequest
seekKnowledge()       -> KnowledgeDiscoveryRequest
exploreAgents()       -> AgentDiscoveryRequest
exploreTasks()        -> AgentStatus or task-query request
task_queued           -> AgentEvent("task-queued")
delegate_task         -> AgentEvent("handoff-started")
failure               -> TaskResult with ProtocolError
```

## Adapter and Binding Layout

```text
src/agent/communication-protocols/
	schema.ts
	participant.ts
	adapters/
		react-agent.ts
		agents-debate.ts
		coding-agent.ts
	bindings/
		a2a.ts
		acp.ts
		gacp.ts
		custom.ts
	tools/
		delegate-task.ts
		discover-agents.ts
		seek-skill.ts
		seek-knowledge.ts
	plugins/
		protocol-policy.ts
		protocol-events.ts
		protocol-tracing.ts
```

Bindings implement encoding, decoding, transport, authentication, and
subscription. Adapters translate local agent APIs to the canonical model.
Tools and plugins depend on the protocol client, not directly on A2A, ACP, or
GACP.

## Integration Rules

```text
Does the host application decide the communication?
	-> Call AgentProtocolClient directly.

Should the model decide whether communication is needed?
	-> Expose a protocol operation as a Tool.

Should behavior happen automatically around execution?
	-> Use a Plugin.

Does the action require a remote transport?
	-> Implement it in a protocol Binding.
```

AgentsDebate should use the client directly for participant selection, rounds,
parallelization, boundaries, handoff, and conclusion selection. A debate agent
may still receive protocol tools for optional discovery or consultation.

CodeAgents should use direct client calls for mandatory review, test, and
approval stages, tools for model-selected specialists, and plugins for patch
auditing, workspace policy, artifact tracking, and authorization.

ReActAgent should use protocol tools through its existing tool configuration,
protocol plugins for lifecycle and policy behavior, and a ReAct adapter for
message, event, usage, structured output, and abort conversion.

## RavenHUB support
It's to be support by RavenHUB - each protocol can go throught some kind of central hub
