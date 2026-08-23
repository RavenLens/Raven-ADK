import { ProtocolError, QueuedTask, TaskId, TaskRequest, TaskResult } from "../../agentProtocols/agentProtocolSchema";
import { ProtocolTaskQueueSchema } from "../queueSchema";

/** Minimal in-memory queue shared by transport wrappers that need local work delivery. */
export class InMemoryProtocolTaskQueueSchema implements ProtocolTaskQueueSchema {
    private readonly pending: QueuedTask[] = [];
    private readonly results = new Map<TaskId, TaskResult>();
    private readonly waiters: Array<(task: QueuedTask | undefined) => void> = [];
    private sequence = 0;

    async enqueue(request: TaskRequest): Promise<TaskId> {
        const taskId = request.taskId ?? `protocol-task-${++this.sequence}`;
        const task = { taskId, request: { ...request, taskId }, enqueuedAt: new Date().toISOString() };
        const waiter = this.waiters.shift();
        if (waiter) waiter(task);
        else this.pending.push(task);
        return taskId;
    }

    async dequeue(signal?: AbortSignal): Promise<QueuedTask | undefined> {
        const task = this.pending.shift();
        if (task) return task;
        if (signal?.aborted) return undefined;
        return new Promise(resolve => {
            const waiter = (queuedTask: QueuedTask | undefined) => {
                signal?.removeEventListener("abort", onAbort);
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

    async complete(taskId: TaskId, result: TaskResult): Promise<void> { this.results.set(taskId, result); }
    async fail(taskId: TaskId, error: ProtocolError): Promise<void> {
        this.results.set(taskId, { taskId, status: "failed", error });
    }
    async cancel(taskId: TaskId, reason?: string): Promise<void> {
        this.results.set(taskId, { taskId, status: "cancelled", error: reason ? { code: "cancelled", message: reason } : undefined });
    }
    size(): number { return this.pending.length; }
    getResult(taskId: TaskId): TaskResult | undefined { return this.results.get(taskId); }
}
