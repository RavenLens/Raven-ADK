import { ProtocolTaskQueueSchema } from "../queues/queueSchema";

/**
 * Operations that can be exposed by a protocol binding or adapted into an
 * agent tool. Protocols may add operations through `custom_${string}`.
 */
export type StandardizedActivityName =
    | "discover_agents"
    | "delegate_task"
    | "ask_agent"
    | "consult_agents"
    | "critique_result"
    | "seek_skill"
    | "seek_knowledge"
    | "get_agent_status"
    | "publish_message"
    | "publish_state";

/** @deprecated Use `StandardizedActivityName`. */
export type StandarizedActivityNames = StandardizedActivityName;

export type PossibleActivityName = StandardizedActivityName | `custom_${string}`;

export type AgentId = string;
export type TaskId = string;
export type MessageId = string;
export type ArtifactId = string;

/** Describes an agent that can be discovered or addressed through a protocol. */
export interface AgentDescriptor {
    /** Stable identifier used to address the agent in protocol requests. */
    id: AgentId;
    /** Human-readable name presented to other agents and clients. */
    name: string;
    /** Human-readable explanation of the agent's purpose. */
    description?: string;
    /** Protocol activities that the agent can perform. */
    capabilities?: PossibleActivityName[];
    /** Skills or domains that can be used to match discovery requests. */
    skills?: string[];
    /** Optional endpoint where the agent can be reached directly. */
    endpoint?: string;
    /** Protocol-specific metadata that does not belong to the common contract. */
    metadata?: Record<string, unknown>;
}

export type MessageRole = "user" | "agent" | "system" | "tool";

/** A protocol-neutral message exchanged between agents, users, or tools. */
export interface Message {
    /** Stable identifier used to correlate the message across transports. */
    id: MessageId;
    /** Participant type that created the message. */
    role: MessageRole;
    /** Textual message body carried by the protocol. */
    content: string;
    /** Agent that produced the message, when applicable. */
    sender?: AgentId;
    /** Intended receiving agent, when applicable. */
    recipient?: AgentId;
    /** Task that this message belongs to, when it is task-related. */
    taskId?: TaskId;
    /** Creation time represented as an ISO 8601 timestamp. */
    timestamp?: string;
    /** Protocol-specific metadata associated with the message. */
    metadata?: Record<string, unknown>;
}

/** A file, binary payload, or other durable output produced by a task. */
export interface Artifact {
    /** Stable identifier used to reference the artifact in task results. */
    id: ArtifactId;
    /** Optional human-readable artifact name. */
    name?: string;
    /** MIME type describing the artifact content. */
    mimeType?: string;
    /** Inline artifact content when it is returned directly by the protocol. */
    content: string | Uint8Array;
    /** Optional external location when the artifact is stored out of band. */
    uri?: string;
    /** Protocol-specific metadata associated with the artifact. */
    metadata?: Record<string, unknown>;
}

export type TaskStatus = "submitted" | "working" | "completed" | "failed" | "cancelled";

/** Requests an agent to perform an activity for another participant. */
export interface TaskRequest {
    /** Existing task identifier used when sending a follow-up request. */
    taskId?: TaskId;
    /** Identifier of the participant submitting the request. */
    from: AgentId;
    /** Identifier of the participant expected to process the request. */
    to: AgentId;
    /** Initial task instruction represented as text or a structured message. */
    message: Message | string;
    /** Standardized or protocol-specific operation requested by the caller. */
    activity?: PossibleActivityName;
    /** Time by which the task should finish, represented as an ISO 8601 timestamp. */
    deadline?: string;
    /** Optional limits that the receiving agent should enforce while processing. */
    budget?: Budget;
    /** Protocol-specific request metadata. */
    metadata?: Record<string, unknown>;
}

/** Current observable state of a submitted task, including its accumulated output. */
export interface TaskSnapshot {
    /** Stable identifier assigned to the task by the protocol. */
    id: TaskId;
    /** Current lifecycle state of the task. */
    status: TaskStatus;
    /** Original request that created the task. */
    request: TaskRequest;
    /** Messages emitted during task processing. */
    messages: Message[];
    /** Artifacts produced during task processing. */
    artifacts?: Artifact[];
    /** Final result when the task has reached a terminal state. */
    result?: TaskResult;
    /** Time when the task was created, represented as an ISO 8601 timestamp. */
    createdAt: string;
    /** Time when the task snapshot was last changed, represented as an ISO 8601 timestamp. */
    updatedAt: string;
}

/** Terminal outcome returned after an agent completes, fails, or cancels a task. */
export interface TaskResult {
    /** Identifier of the task that produced this result. */
    taskId: TaskId;
    /** Terminal lifecycle state reached by the task. */
    status: "completed" | "failed" | "cancelled";
    /** Final textual response from the processing agent. */
    message?: Message;
    /** Files or other outputs produced by the task. */
    artifacts?: Artifact[];
    /** Structured failure information when the task did not complete successfully. */
    error?: ProtocolError;
    /** Resource usage reported by the processing agent. */
    usage?: Usage;
}

/** Handle returned for an outbound task that is still being processed. */
export interface TaskHandle {
    /** Identifier used to inspect or cancel the remote task. */
    taskId: TaskId;
    /** Best-known status at the time the handle was returned. */
    status: TaskStatus;
    /** Waits until the remote task reaches a terminal state and returns its outcome. */
    wait(): Promise<TaskResult>;
}

/** Inbound task together with queue metadata supplied to a serving agent. */
export interface QueuedTask {
    /** Identifier assigned to the queued task. */
    taskId: TaskId;
    /** Request that the serving agent must execute. */
    request: TaskRequest;
    /** Time when the request entered the queue, represented as an ISO 8601 timestamp. */
    enqueuedAt: string;
}

/** Task request that coordinates a response from multiple participants. */
export interface ConsultationRequest extends TaskRequest {
    /** Agents that should participate in the consultation. */
    participants: AgentId[];
}

/** Criteria used to find agents capable of handling a requested activity. */
export interface DiscoveryRequest {
    /** Agent requesting the discovery operation, when known. */
    requester?: AgentId;
    /** Capability that a discovered agent must provide. */
    capability?: PossibleActivityName;
    /** Skill or domain that a discovered agent should support. */
    skill?: string;
    /** Free-form query used by the protocol's discovery mechanism. */
    query?: string;
    /** Protocol-specific discovery metadata. */
    metadata?: Record<string, unknown>;
}

/** Agents returned by a protocol discovery operation. */
export interface DiscoveryResult {
    /** Agents matching the discovery request. */
    agents: AgentDescriptor[];
}

/** Optional resource and time limits applied to task execution. */
export interface Budget {
    /** Maximum number of model or processing tokens allowed. */
    maxTokens?: number;
    /** Maximum monetary cost allowed for the task. */
    maxCost?: number;
    /** Time by which the task should finish, represented as an ISO 8601 timestamp. */
    deadline?: string;
    /** Maximum execution duration in milliseconds. */
    maxDurationMs?: number;
}

/** Resource usage reported for a completed protocol task. */
export interface Usage {
    /** Number of input tokens consumed while processing the task. */
    inputTokens?: number;
    /** Number of output tokens generated while processing the task. */
    outputTokens?: number;
    /** Monetary cost incurred while processing the task. */
    cost?: number;
    /** Total processing time in milliseconds. */
    durationMs?: number;
}

/** Transport-independent error information exchanged by protocol implementations. */
export interface ProtocolError {
    /** Stable machine-readable error code. */
    code: string;
    /** Human-readable explanation of the failure. */
    message: string;
    /** Indicates whether retrying the operation may succeed. */
    retryable?: boolean;
    /** Protocol-specific diagnostic details. */
    details?: Record<string, unknown>;
}

/** Records a request to stop a queued or in-progress task. */
export interface Cancellation {
    /** Identifier of the task being cancelled. */
    taskId: TaskId;
    /** Optional explanation for the cancellation. */
    reason?: string;
    /** Time when cancellation was requested, represented as an ISO 8601 timestamp. */
    requestedAt: string;
}

/** Typed lifecycle events emitted by protocol clients and bindings. */
export interface CommunicationEventMap {
    /** Emitted when a protocol activity begins processing. */
    activity_started: (activity: PossibleActivityName, request: TaskRequest) => void | Promise<void>;
    /** Emitted when a task is accepted by the remote protocol. */
    task_submitted: (task: TaskSnapshot) => void | Promise<void>;
    /** Emitted when a task publishes an intermediate state or message. */
    task_progress: (task: TaskSnapshot, message?: Message) => void | Promise<void>;
    /** Emitted when a task reaches the completed state. */
    task_completed: (result: TaskResult) => void | Promise<void>;
    /** Emitted when a task reaches the failed state. */
    task_failed: (taskId: TaskId, error: ProtocolError) => void | Promise<void>;
    /** Emitted when a task reaches the cancelled state. */
    task_cancelled: (cancellation: Cancellation) => void | Promise<void>;
    /** Emitted when discovery returns an agent descriptor. */
    agent_discovered: (agent: AgentDescriptor) => void | Promise<void>;
    /** Emitted when a message is published independently of task completion. */
    message_published: (message: Message) => void | Promise<void>;
    /** Emitted when the protocol requires credentials or another authentication step. */
    authentication_required: (details?: Record<string, unknown>) => void | Promise<void>;
    /** Emitted when the protocol encounters an error not specific to task failure. */
    error: (error: ProtocolError, taskId?: TaskId) => void | Promise<void>;
}

export type CommunicateEvents = keyof CommunicationEventMap;

/**
 * Protocol-neutral runtime API. A2A, ACP, GACP, and local protocols implement
 * this contract and translate it to their own transport and wire format.
*/
export interface ProtocolClient {
    /** Finds external agents that match the requested capability, skill, or query. */
    discover(request: DiscoveryRequest): Promise<DiscoveryResult>;
    /** Submits work to a specific external agent and returns a handle for tracking its task. */
    delegate(request: TaskRequest): Promise<TaskHandle>;
    /** Sends a task to one or more participants and waits for the consultation result. */
    consult(request: ConsultationRequest): Promise<TaskResult>;
    /** Retrieves the current state, messages, artifacts, and result of a remote task. */
    getTask(taskId: TaskId): Promise<TaskSnapshot>;
    /** Requests cancellation of a remote task that is queued or still progressing. */
    cancel(taskId: TaskId, reason?: string): Promise<void>;
    /** Subscribes to a protocol event and returns a function that removes the subscription. */
    onEvent<K extends keyof CommunicationEventMap>(
        event: K,
        listener: CommunicationEventMap[K]
    ): () => void;
}

export interface AgentAdapter {
    /** Returns the external identity and capabilities that this agent exposes through the protocol. */
    describe(): AgentDescriptor;
    /** Executes an inbound protocol task when the binding delivers work to this agent. */
    execute(request: TaskRequest): Promise<TaskResult>;
}

export interface ProtocolBinding {
    /** Protocol name */
    name: string;
    /** Protocol Version */
    version: string;
    /** outbound communication with other agents */
    client: ProtocolClient;
    /** inbound work queue */
    queue?: ProtocolTaskQueueSchema;
    /** Identifies the local participant when this binding sends outbound work. */
    participant?: AgentDescriptor;
    /** optional inbound execution adapter */
    adapter?: AgentAdapter;
}

/** A configured protocol exposed to an agent or orchestrator. */
export interface Schema extends ProtocolBinding {}
