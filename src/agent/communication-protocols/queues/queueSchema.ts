import { Cancellation, ProtocolError, QueuedTask, TaskId, TaskRequest, TaskResult } from "../agentProtocols/agentProtocolSchema";

/** Typed lifecycle events emitted by a protocol task queue. */
export interface ProtocolQueueEventMap {
    /** Emitted after a task has been accepted by the queue. */
    task_enqueued: (task: QueuedTask) => void | Promise<void>;
    /** Emitted when a worker receives a task from the queue. */
    task_dequeued: (task: QueuedTask) => void | Promise<void>;
    /** Emitted after a task result has been stored as completed. */
    task_completed: (result: TaskResult) => void | Promise<void>;
    /** Emitted after a task failure has been stored. */
    task_failed: (taskId: TaskId, error: ProtocolError) => void | Promise<void>;
    /** Emitted after a task cancellation has been stored. */
    task_cancelled: (cancellation: Cancellation) => void | Promise<void>;
    /** Emitted when the queue cannot process an operation. */
    error: (error: ProtocolError, taskId?: TaskId) => void | Promise<void>;
}

export type ProtocolQueueEvent = keyof ProtocolQueueEventMap;

/**
 * Inbound work queue owned by a protocol binding. A participant uses it to
 * keep serving while another task is still working or waiting for a result.
 */
export interface ProtocolTaskQueueSchema {
    /** Registered queue event listeners. */
    readonly listeners: Map<ProtocolQueueEvent, Set<(...args: any[]) => void | Promise<void>>>;
    /** Subscribes to a queue event and returns a function that removes the subscription. */
    onEvent<K extends ProtocolQueueEvent>(event: K, listener: ProtocolQueueEventMap[K]): () => void;
    /** Emits a typed queue event to all current listeners. */
    emitEvent<K extends ProtocolQueueEvent>(event: K, ...eventArgs: Parameters<ProtocolQueueEventMap[K]>): boolean;
    /** Adds an inbound protocol request to the queue when an agent must process it. */
    enqueue(request: TaskRequest): Promise<TaskId>;
    /** Waits for and removes the next queued request; an empty queue waits until work arrives by Pending Promise, while a closed or aborted queue returns undefined. */
    dequeue(signal?: AbortSignal): Promise<QueuedTask | undefined>;
    /** Publishes a successful or cancelled result after the agent finishes processing a queued task. */
    complete(taskId: TaskId, result: TaskResult): Promise<void>;
    /** Publishes a failure after processing a queued task ends with an error. */
    fail(taskId: TaskId, error: ProtocolError): Promise<void>;
    /** Marks a queued or in-progress task as cancelled when cancellation is requested. */
    cancel(taskId: TaskId, reason?: string): Promise<void>;
    /** Returns the number of tasks currently waiting to be processed. */
    size(): number;
}