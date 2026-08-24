import { Cancellation, ProtocolError, QueuedTask, TaskId, TaskRequest, TaskResult } from "../../agentProtocols/agentProtocolSchema";
import { ProtocolQueueEvent, ProtocolQueueEventMap, ProtocolTaskQueueSchema } from "../queueSchema";

/** Minimal in-memory queue shared by transport wrappers that need local work delivery. */
export class InMemoryProtocolTaskQueueSchema implements ProtocolTaskQueueSchema {
    private readonly pending: QueuedTask[] = [];
    private readonly results = new Map<TaskId, TaskResult>();
    private readonly waiters: Array<(task: QueuedTask | undefined) => void> = [];
    readonly listeners = new Map<ProtocolQueueEvent, Set<(...args: any[]) => void | Promise<void>>>();
    private sequence = 0;

    onEvent<K extends ProtocolQueueEvent>(event: K, listener: ProtocolQueueEventMap[K]): () => void {
        const listeners = this.listeners.get(event) ?? new Set();
        const callback = listener as (...args: any[]) => void | Promise<void>;
        listeners.add(callback);
        this.listeners.set(event, listeners);
        return () => listeners.delete(callback);
    }

    emitEvent<K extends ProtocolQueueEvent>(event: K, ...eventArgs: Parameters<ProtocolQueueEventMap[K]>): boolean {
        const listeners = this.listeners.get(event);
        if (!listeners) return false;
        for (const listener of listeners) void listener(...eventArgs);
        return listeners.size > 0;
    }

    async enqueue(request: TaskRequest): Promise<TaskId> {
        const taskId = request.taskId ?? `protocol-task-${++this.sequence}`;
        const task = { taskId, request: { ...request, taskId }, enqueuedAt: new Date().toISOString() };
        const waiter = this.waiters.shift();
        if (waiter) waiter(task);
        else this.pending.push(task);
        this.emitEvent("task_enqueued", task);
        return taskId;
    }

    async dequeue(signal?: AbortSignal): Promise<QueuedTask | undefined> {
        const task = this.pending.shift();
        if (task) {
            this.emitEvent("task_dequeued", task);
            return task;
        }
        if (signal?.aborted) return undefined;
        return new Promise(resolve => {
            const waiter = (queuedTask: QueuedTask | undefined) => {
                signal?.removeEventListener("abort", onAbort);
                if (queuedTask) this.emitEvent("task_dequeued", queuedTask);
                resolve(queuedTask);
            };
            const onAbort = () => {
                const index = this.waiters.indexOf(waiter);
                if (index >= 0) this.waiters.splice(index, 1);
                resolve(undefined);
            };
            this.waiters.push(waiter);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }

    async complete(taskId: TaskId, result: TaskResult): Promise<void> {
        this.results.set(taskId, result);
        this.emitEvent("task_completed", result);
    }
    async fail(taskId: TaskId, error: ProtocolError): Promise<void> {
        this.results.set(taskId, { taskId, status: "failed", error });
        this.emitEvent("task_failed", taskId, error);
    }
    async cancel(taskId: TaskId, reason?: string): Promise<void> {
        const error = reason ? { code: "cancelled", message: reason } : undefined;
        this.results.set(taskId, { taskId, status: "cancelled", error });
        const cancellation: Cancellation = { taskId, reason, requestedAt: new Date().toISOString() };
        this.emitEvent("task_cancelled", cancellation);
    }
    size(): number { return this.pending.length; }
    getResult(taskId: TaskId): TaskResult | undefined { return this.results.get(taskId); }
}
