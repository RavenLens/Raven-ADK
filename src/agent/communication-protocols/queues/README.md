# Queues

## What Is a Queue?

A queue is the protocol-neutral boundary between an incoming communication request and the agent that processes it. A protocol wrapper adds a `TaskRequest` with `enqueue`, while an agent worker retrieves the next `QueuedTask` with `dequeue`.

After processing, the worker publishes a result with `complete`, `fail`, or `cancel`. Queues are owned by a protocol binding, allowing the transport and agent protocol to remain independent from the work-delivery mechanism.

## Available Queues

### InMemory

[InMemory.ts](./queue-types/InMemory.ts) provides `InMemoryProtocolTaskQueueSchema`. It stores pending tasks and completed results in process memory, delivers tasks in FIFO order, and resolves a waiting `dequeue` call as soon as a task is enqueued. A dequeue can also be cancelled with an `AbortSignal`.

This queue is suitable for local agents, tests, and lightweight protocol adapters. It is not durable: pending tasks and stored results are lost when the process stops, and it does not coordinate work between processes or machines.

## Independence

The queue schema is independent of both the agent protocol and the storage technology. You can implement the same [`ProtocolTaskQueueSchema`](./queueSchema.ts) contract with PostgreSQL, Redis, MongoDB, Amazon S3, or another suitable backend.

This makes it possible to choose the right queue behavior for the application: an in-memory queue for local work, a database-backed queue for durability, or a distributed store for multiple workers and processes. The protocol wrapper and agent worker continue to use the same `enqueue`, `dequeue`, result, and cancellation operations regardless of the underlying implementation.
