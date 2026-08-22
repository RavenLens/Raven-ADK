import { ProtocolError, QueuedTask, TaskId, TaskRequest, TaskResult } from "../agentProtocols/agentProtocolSchema";

/**
 * Inbound work queue owned by a protocol binding. A participant uses it to
 * keep serving while another task is still working or waiting for a result.
 */
export interface ProtocolTaskQueueSchema {
    /** Adds an inbound protocol request to the queue when an agent must process it. */
    enqueue(request: TaskRequest): Promise<TaskId>;
    /** Waits for and removes the next queued request, or returns undefined when the queue is closed or aborted. */
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