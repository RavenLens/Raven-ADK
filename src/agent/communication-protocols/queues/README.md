# Queues

## What Is a Queue?

A queue is the protocol-neutral boundary between an incoming communication request and the agent that processes it. A protocol wrapper adds a `TaskRequest` with `enqueue`, while an agent worker retrieves the next `QueuedTask` with `dequeue`.

After processing, the worker publishes a result with `complete`, `fail`, or `cancel`. Queues are owned by a protocol binding, allowing the transport and agent protocol to remain independent from the work-delivery mechanism.

## Available Queues

### InMemory

[InMemory.ts](./queue-types/InMemory.ts) provides `InMemoryProtocolTaskQueueSchema`. It stores pending tasks and completed results in process memory, delivers tasks in FIFO order, and resolves a waiting `dequeue` call as soon as a task is enqueued. A dequeue can also be cancelled with an `AbortSignal`.

This queue is suitable for local agents, tests, and lightweight protocol adapters. It is not durable: pending tasks and stored results are lost when the process stops, and it does not coordinate work between processes or machines.

## Queue Events

Every queue exposes typed lifecycle events through `onEvent` and `emitEvent`.
The event names are `task_enqueued`, `task_dequeued`, `task_completed`,
`task_failed`, `task_cancelled`, and `error`. Register a listener when a worker,
dashboard, tracer, or transport needs to observe queue activity:

```ts
const unsubscribe = queue.onEvent("task_completed", result => {
	console.log(`Task ${result.taskId} finished with ${result.status}`);
});

await queue.complete(taskId, { taskId, status: "completed" });
unsubscribe();
```

Listeners may return a promise. Queue implementations should dispatch listeners
without blocking the queue operation, and `emitEvent` returns `true` when the
event had at least one listener. Event payloads use the canonical protocol
types: `QueuedTask` for enqueue/dequeue, `TaskResult` for completion,
`ProtocolError` for failure, and `Cancellation` for cancellation.

## Independence

The queue schema is independent of both the agent protocol and the storage technology. You can implement the same [`ProtocolTaskQueueSchema`](./queueSchema.ts) contract with PostgreSQL, Redis, MongoDB, Amazon S3, or another suitable backend.

This makes it possible to choose the right queue behavior for the application: an in-memory queue for local work, a database-backed queue for durability, or a distributed store for multiple workers and processes. The protocol wrapper and agent worker continue to use the same `enqueue`, `dequeue`, result, and cancellation operations regardless of the underlying implementation.

## Implementing a Custom Queue

Implement `ProtocolTaskQueueSchema` when the queue needs durable storage,
multiple workers, retries, or a transport-specific delivery mechanism. The
schema does not prescribe how tasks are stored or locked. It does require the
event contract so observers can behave consistently across queue backends:

```ts
class CustomTaskQueue implements ProtocolTaskQueueSchema {
	readonly listeners = new Map<ProtocolQueueEvent, Set<(...args: any[]) => void | Promise<void>>>();

	onEvent<K extends ProtocolQueueEvent>(event: K, listener: ProtocolQueueEventMap[K]): () => void {
		const listeners = this.listeners.get(event) ?? new Set();
		const callback = listener as (...args: any[]) => void | Promise<void>;
		listeners.add(callback);
		this.listeners.set(event, listeners);
		return () => listeners.delete(callback);
	}

	emitEvent<K extends ProtocolQueueEvent>(event: K, ...args: Parameters<ProtocolQueueEventMap[K]>): boolean {
		const listeners = this.listeners.get(event);
		if (!listeners) return false;
		for (const listener of listeners) void listener(...args);
		return listeners.size > 0;
	}

	async enqueue(request: TaskRequest): Promise<TaskId> { /* persist and emit task_enqueued */ throw new Error("not implemented"); }
	async dequeue(signal?: AbortSignal): Promise<QueuedTask | undefined> { /* claim and emit task_dequeued */ throw new Error("not implemented"); }
	async complete(taskId: TaskId, result: TaskResult): Promise<void> { /* persist and emit task_completed */ }
	async fail(taskId: TaskId, error: ProtocolError): Promise<void> { /* persist and emit task_failed */ }
	async cancel(taskId: TaskId, reason?: string): Promise<void> { /* persist and emit task_cancelled */ }
	size(): number { return 0; }
}
```

Emit an event only after the corresponding storage operation succeeds. Emit
`error` for unexpected queue or storage errors, and preserve task IDs across
retries so event consumers can correlate the complete lifecycle.
