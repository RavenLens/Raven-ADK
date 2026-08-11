# Memory

RavenADK memory gives an agent durable context across runs. Memory is saved in a backing store, such as a local file, database, vector store, or another storage system, and can be recalled or updated as part of the agent workflow.

The available memory systems are:

* **Mem0**: factual memory
* **MemP**: procedural memory
* **MemRL**: episodic memory
* **Custom tool-based memory**: agent-directed memory
* **Custom deterministic memory**: lifecycle-directed memory

Memory can therefore hold facts, procedures, episodes, or other application-specific knowledge. The main execution models are agent-directed access through tools and lifecycle-directed access through deterministic hooks. For the complete overview and examples, see [Memory Systems](./memories/README.md).

## Configuring memory for ReAct Agent

Pass one memory schema or an array of memory schemas to the `memory` option. A configured entry can be the schema itself or a descriptor containing `memory`, `name`, and `purpose`.

```typescript
const agent = new ReActAgent({
    model,
    systemPrompt: "You help with project work.",
    messages: [{ type: "user", content: "What did we decide about retries?" }],
    tools: [],
    memory: [projectMemory, userPreferences]
});
```

### Persisted memory schema

`MemoryDefault` has two groups of fields:

* **Instructions for the agent:** `name`, `purpose`, `systemPrompt`, and `hasToRemember`.
* **Description of stored data:** the `StoredMemory` generic and `memorySchema`.

Use `MemoryDefault<StoredMemory>` when your memory implementation stores
structured data extracted from a conversation. The generic describes the
TypeScript shape, while `memorySchema` describes and validates the same shape
at runtime. The schema can describe either one object or an array of objects.

These two parts have different jobs:

* `StoredMemory` provides compile-time type checking through `MemoryDefault<StoredMemory>`.
* `memorySchema` validates the actual value at runtime with Zod.

For a custom memory implementation, validate the value at both storage
boundaries:

1. Parse the value before writing it to a database, file, vector store, or other backing store.
2. Parse the value again after reading it back.
3. Pass only the validated value to the rest of the memory implementation.

Example:

```typescript
import { z } from "zod";
import { MemoryDefault } from "@ravenlens/raven-adk/memory";

const preferenceSchema = z.object({
    userId: z.string(),
    preferences: z.array(z.string())
});

type PreferenceMemory = z.infer<typeof preferenceSchema>;

const preferenceMemory: MemoryDefault<PreferenceMemory> = {
    name: "User preferences",
    purpose: "Remember confirmed communication preferences.",
    memorySchema: preferenceSchema
};

const record = preferenceSchema.parse({
    userId: "user-123",
    preferences: ["concise updates"]
});
await database.collection("preferences").replaceOne(
    { userId: record.userId },
    record,
    { upsert: true }
);
```

`ReActAgent` does not automatically extract, persist, or migrate records from
these fields. The configured memory system or custom store owns that work.

For MongoDB and similar document stores:

* The parsed object or array can be serialized directly.
* Database-specific IDs, indexes, and query operators belong in the adapter.
* Include those database fields in the Zod schema only when they are part of the memory entity itself.

Do not confuse this schema with a tool schema. A tool schema validates values
sent by the model to a memory tool; `memorySchema` validates the memory record
that the implementation persists.

## How memory works

When memory is configured on `ReActAgent`, it participates in the agent run according to its execution model. Built-in systems use deterministic lifecycle hooks; custom tool-based memory exposes model-callable tools; and custom deterministic memory runs at configured lifecycle points. Multiple memory systems can be combined when each one owns a different kind of knowledge.

Memory is persisted by the store owned by the configured implementation. The built-in Mem0, MemP, and MemRL systems use in-memory stores by default and accept store or retrieval adapters through their configuration; custom memory can connect to any application-specific persistence layer.

Memory can be disabled by omitting the `memory` option. For detailed system behavior and custom schemas, see [Memory Systems](./memories/README.md) and [Creating custom memory store](#creating-custom-memory-store).

## Deterministic memory lifecycle

`DeterministicMemorySchema` can implement these hooks:

* `beforeOrchestratorAgentRun`
* `afterOrchestratorAgentRun`
* `beforeSubagentRun`
* `afterSubagentRun`

Before orchestrator and subagent runs, returned `memoryInformations` are added to agent awareness and included in the wrapped system prompt. After those runs, returned updates are not automatically persisted by `ReActAgent`; the memory implementation owns its storage and side effects. `afterConversationEnd` is part of the schema for a conversation host to call, but `ReActAgent` does not invoke it in its run loop.

Deterministic memory tools are optional. When configured, their calls are recorded as `agentWants` for the matching lifecycle hook, and an optional tool function can return an immediate result.

## Tool-based memory

`ToolBasedMemorySchema` exposes only the `fetch` and/or `update` tools declared in `memoryTools`. `ReActAgent` registers those tools and calls their functions with parsed arguments and the current agent state. It does not create implicit memory tools. A tool-based schema may also provide a normal `conclusionPlugin`; the plugin is registered as supplied, but RavenADK does not provide a built-in `MemoryConclusionPlugin` or `createMemoryConclusionPlugin` export.

## Built-in systems

`Mem0`, `MemP`, and `MemRL` are deterministic memory implementations exported from `@ravenlens/raven-adk/memory`:

* `Mem0` stores and reconciles factual memories through add, update, delete, and noop operations. It retrieves facts through an injected retriever or its built-in lexical fallback.
* `MemP` stores procedures containing concrete steps and a higher-level script. It retrieves active procedures through an injected retriever or its built-in lexical fallback.
* `MemRL` ranks caller-supplied candidates using semantic similarity and learned utility scores, then applies explicit outcome feedback. It does not perform candidate search by itself.

All three use in-memory stores by default. Their configuration types provide the extension points for persistence and retrieval; inspect the source implementations before assuming a particular database, vector service, or graph store is included.

Each built-in system exports a Zod schema for its persisted entities. Reuse the
matching schema in a custom store instead of defining a second document shape:

```typescript
import {
    mem0MemorySchema,
    memPProcedureSchema,
    memRLScoreSchema,
    memRLTraceSchema
} from "@ravenlens/raven-adk/memory";

const fact = mem0MemorySchema.parse(await factsCollection.findOne({ id: "fact-1" }));
const procedure = memPProcedureSchema.parse(await proceduresCollection.findOne({ id: "procedure-1" }));
const score = memRLScoreSchema.parse(await scoresCollection.findOne({ resourceId: "tool-1" }));
const trace = memRLTraceSchema.parse(await tracesCollection.findOne({ traceId: "trace-1" }));
```

The schemas work with Mem0, MemP, and MemRL stores, including MongoDB-backed
implementations:

* `mem0MemorySchema` validates Mem0 factual records.
* `memPProcedureSchema` validates MemP procedures.
* `memRLScoreSchema` validates MemRL learned scores.
* `memRLTraceSchema` validates MemRL trace history.

They do not replace the store interfaces, retrieval adapters, or model-callable
tool schemas. A custom store should validate before `set()` persists a
document and after `get()` or `list()` returns one. If the database document
has a different shape, map the fields explicitly in the adapter.

## Creating custom memory store

Implement either `ToolBasedMemorySchema` or `DeterministicMemorySchema`. Both schemas define the lifecycle or tools that RavenADK can invoke, while the implementation owns persistence in whatever store it requires. Define Zod schemas for model-callable arguments and use `MemoryDefault.memorySchema` for the records extracted from conversation and written to storage. These are separate concerns: tool schemas validate model calls, while `memorySchema` validates persisted memory entities.

For the full interfaces and examples, see [Memory Systems](./memories/README.md), especially [tool-based memory](./memories/README.md#tool-based-memory-create-an-on-demand-system) and [deterministic memory](./memories/README.md#deterministic-memory-create-a-lifecycle-system).
