# Mem0 - Factual Memory

**Paper:** [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/pdf/2504.19413)

## Type

Mem0 is factual long-term memory. It stores concise, durable facts such as preferences, identities, constraints, and state that changes over time. It is not an episodic replay store; use MemRL when the primary goal is learning from outcome feedback.

## How It Works

The implementation follows the base Mem0 pipeline from the paper:

1. Extract salient facts from recent conversation context.
2. Retrieve up to `topK` similar facts from the configured scope.
3. Reconcile each candidate using `add`, `update`, `delete`, or `noop`.
4. Attach relevant facts to the next agent run as transient system context.

The default store is process-local and the default retriever is lexical. Production applications normally provide a `Mem0MemoryStore` and a semantic, BM25, or hybrid `retriever`.

## ReActAgent Setup

Pass `Mem0` directly to `ReActAgent`. The agent invokes `beforeOrchestratorAgentRun` before its prompt is built and `afterOrchestratorAgentRun` after it finishes. Delegated agents use the corresponding subagent hooks.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { Mem0 } from "@ravenlens/raven-adk/memory";
import { OpenAI } from "@ravenlens/raven-adk/models";

const factualMemory = new Mem0({
  name: "User facts",
  purpose: "Keep durable user preferences and constraints current.",
  scope: "user-123",
  hasToRemember: [
    "* User name and job role",
    "* Dietary, communication, and format preferences",
    "* Current project constraints explicitly stated by the user"
  ].join("\n"),
  model: new OpenAI({ model: "gpt-5.5-nano" })
});

const agent = new ReActAgent({
  model: new OpenAI({ model: "gpt-5.5-nano" }),
  systemPrompt: "You are a personal assistant.",
  messages: [{ type: "user", content: "I now prefer concise weekly updates." }],
  tools: [],
  memory: factualMemory
});

await agent.invoke();
```

`model` drives both fact extraction and reconciliation. It receives JSON-only prompts and must return either `{"facts":[...]}` during extraction or an operation such as `{"operation":"update","memoryId":"...","content":"..."}` during reconciliation.

## Separate Update Agent

Use `agent` when a dedicated `ReActAgent` should manage memory updates instead of a bare LLM. Keep this updater separate from the agent that owns the memory and do not configure it with the same `Mem0` instance, otherwise it would trigger recursive updates.

```typescript
const memoryUpdater = new ReActAgent({
  model: new OpenAI({ model: "gpt-5.5-nano" }),
  systemPrompt: [
    "You manage factual memory.",
    "Follow the system message supplied with each request.",
    "Return only the required JSON object."
  ].join("\n"),
  messages: [],
  tools: [],
  withConclusion: false
});

const factualMemory = new Mem0({
  name: "User facts",
  purpose: "Keep the user profile current.",
  scope: "user-123",
  agent: memoryUpdater
});
```

## Custom Extraction and Reconciliation

For deterministic application logic, configure `factExtractor` and `updatePlanner` instead of `model` or `agent`. The planner receives the candidate fact, its retrieved similar memories, scope, and lifecycle phase. It can return one or more `Mem0Update` operations.

```typescript
const factualMemory = new Mem0({
  name: "Account facts",
  purpose: "Maintain verified account preferences.",
  factExtractor: async () => ["The user prefers invoices in EUR."],
  updatePlanner: async ({ fact, similarMemories }) => {
    const existing = similarMemories[0];
    return existing
      ? { type: "update", memoryId: existing.memory.id, memory: fact }
      : { type: "add", memory: fact };
  }
});
```

## Storage and Retrieval

- `InMemoryMem0MemoryStore` is useful for tests and short-lived processes.
- Implement `Mem0MemoryStore` with `list`, `get`, `set`, and `delete` for durable storage.
- Set `retriever` to connect vector, BM25, or hybrid search. It must return normalized similarities in the range `[0, 1]`.
- Use `scope` to isolate users, tenants, or sessions.
- `topK` defaults to `10`, matching the paper's update retrieval setting.

## Manual Operations

`addMemory`, `updateMemory`, `deleteMemory`, `retrieve`, `getMemory`, and `listMemories` are available when the application needs explicit control. `applyUpdate` accepts the same `add`, `update`, `delete`, and `noop` operations used by the automatic pipeline.

## Combining Memory Systems

Mem0 and MemP can be configured together. Mem0 supplies facts about who or what is involved, while MemP supplies reusable procedures. MemRL remains the choice for episodic, feedback-driven ranking.

```typescript
memory: [factualMemory, proceduralMemory]
```

## Further Reading

- [Memory systems overview](../README.md)
- [Mem0 paper](https://arxiv.org/html/2504.19413v1)
