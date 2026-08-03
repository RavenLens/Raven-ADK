# Memory Systems

RavenADK agents can remember information across interactions. The SDK ships with several memory systems, each tuned for a different kind of recall:

| System | Memory type | Paper | Best for |
|---|---|---|---|
| [MemP](./memp/README.md) | Procedural | [Memp: Exploring Agent Procedural Memory](https://arxiv.org/pdf/2508.06433) | Reusing approved workflows, tool sequences, and "how we did it last time" |
| [MemRL](./memrl/README.md) | Episodic (RL-driven) | [MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory](https://arxiv.org/pdf/2601.03192) | Learning from outcomes and ranking strategies by feedback |
| [Mem0](./mem0/README.md) | Factual | [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/pdf/2504.19413) | Keeping user facts, preferences, and identity up to date |
| [Custom](./custom/README.md) | Any | - | Your own storage, retrieval, or pre/post-processing logic |


You can use them individually, or mix several of them together in a single agent.

## Memory Types
<!-- TODO: Mention custom memory can run as tools or by use deterministic pin-points - denote the 2 separate systems and implement -->
┌─────────────────────────────────────────────────────────────┐
│  Memory pattern schemas (Mem0, MemP, MemRL, custom)         │
│  ── produce a MemoryDefault + capability contract           │
├─────────────────────────────────────────────────────────────┤
│  MemoryDefault (base schema)                                │
│  ── name, purpose, pattern, hasToRemember, capabilities     │
├─────────────────────────────────────────────────────────────┤
│  DeterministicMemorySchema  │  ToolBasedMemorySchema        │
│  ── lifecycle hooks         │  ── explicit ToolSpec(s)      │
├─────────────────────────────────────────────────────────────┤
│  MemoryInterface (agent wrapper)                            │
│  ── reads capabilities and generates tools / system prompt  │
├─────────────────────────────────────────────────────────────┤
│  SchemaMemoryStore (raw DB)                                 │
│  ── fetchMemory, saveMemory, conclusion file, config        │
└─────────────────────────────────────────────────────────────┘

- Deterministic/Combined
  - Can use the memory functions to explicitly fill the agent memory or update the memory
  - Can specify the tools to allow agent to instruct what to save and what to update with usage of tools
  - With combined workflow user can 
- Tool based

<!-- TODO: Denote in documentation that databases are removed because user has to decide what to use and how to parse the data will be return for agent still as string and differences in databases are too large to put harness on user shoulder -->

<!-- 
TODO:
2. Implement the memory systesm with deterministic memory for ReActAgenr
  - MemP
  - MemRL
  - Mem0

  - Each leverages the deterministic memory
3. Check how to implement the memory in the ReAct agent
  - Deterministic
    - Has to be able to use multiple
      - In case of specified tool create tool with the name and description specified for eahc object with identifier matches to the object
    - Has to make agent able to use the tools to specify what wants for each step
    - Has to produce events from usage of deterministic function - events are registered for memory object
  - 
4. README.md update doc
  - Show how to use tool based memory in this README.md
  - Show how to use the deterministic memory here in README.md
 -->

## Quick start

### Singular memory

Use a single memory store when all durable information can live in one place:

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemoryChromaDBStore } from "@ravenlens/raven-adk/memory";

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You are a helpful assistant.",
  messages: [{ type: "user", content: "Hello" }],
  tools: [],
  memory: new MemoryChromaDBStore({
    hasToRemember: [
      "* User name",
      "* User preferences and interests"
    ].join("\n"),
    session: "user-123",
    conclusion: { maxCharacters: 2048 }
  })
});
```

### Plural memory (combining systems)

Use plural memory when you want different kinds of knowledge stored in separate, named systems. The agent receives a dedicated `fetch_memory`/`save_memory` tool pair for each system.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemoryChromaDBStore, MemoryDiskStore } from "@ravenlens/raven-adk/memory";

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You are a helpful assistant.",
  messages: [{ type: "user", content: "Plan my trip" }],
  tools: [],
  memory: [
    {
      memory: new MemoryChromaDBStore({
        hasToRemember: "* User preferences, dietary restrictions, budget",
        session: "user-123"
      }),
      name: "User Facts",
      purpose: "Keep durable facts about the user up to date."
    },
    {
      memory: new MemoryDiskStore({
        hasToRemember: "* Approved travel planning workflows\n* Successful itineraries and tool sequences",
        session: "user-123"
      }),
      name: "Travel Procedures",
      purpose: "Store reusable task playbooks built from past trips."
    }
  ]
});
```

> **Tip:** Add `parallelTools: true` to the ReAct agent if many memory systems are used and latency matters.

## MemP — Procedural Memory

### Description
MemP distills past agent trajectories into step-by-step instructions and higher-level, script-like abstractions. It is designed for *procedural* recall: "how something was done back then and how new approaches should look".

### Requirements
- A `SchemaMemoryStore` with search support (semantic or BM25), e.g. `MemoryChromaDBStore`, `MemoryMongoDBStore`, or `MemoryDiskStore`.
- A `hasToRemember` prompt that focuses on durable workflows, tool sequences, and approved patterns.
- (Recommended) `createMemoryConclusionPlugin` to keep a compact "playbook" conclusion.

### Usecases
- Reusing a validated deployment or data-pipeline sequence.
- Remembering how a recurring report is built.
- Avoiding deprecated approaches by marking them in memory.

### Code Example

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemoryChromaDBStore, createMemoryConclusionPlugin } from "@ravenlens/raven-adk/memory";
import { OpenAI } from "@ravenlens/raven-adk/models";

const proceduralMemory = new MemoryChromaDBStore({
  hasToRemember: [
    "* Step-by-step workflows the user has approved",
    "* Tool sequences that produced correct results",
    "* Deprecated approaches to avoid in the future"
  ].join("\n"),
  session: "team-procedures",
  conclusion: { maxCharacters: 2048 }
});

const agent = new ReActAgent({
  model: new OpenAI({ model: "gpt-5.5-nano" }),
  systemPrompt: "You are an SRE assistant.",
  messages: [{ type: "user", content: "Roll back the canary" }],
  tools: [],
  memory: proceduralMemory,
  plugins: [
    createMemoryConclusionPlugin({
      model: new OpenAI({ model: "gpt-5.5-nano" }),
      systemPrompt: "Summarize durable procedural lessons."
    })
  ]
});
```

MemP can be combined with Mem0 so the agent knows both *who* the user is and *how* to do the task.

## MemRL — Episodic Memory with Runtime Reinforcement Learning

### Description
MemRL frames memory retrieval as a learnable decision problem. Instead of only matching by semantic similarity, it ranks memories (and tools/skills) by a learned Q-score that is updated from environmental or user feedback. This makes it ideal for learning from *how something went*.

### Requirements
- A VectorDB and an embedding model for the first retrieval phase.
- A Q-score store for utility values.
- A feedback source (user rating, automated evaluator, or self-evaluation).
- (Recommended) `e_MemRL` configuration in `ReActAgent` when available.

### Usecases
- Selecting the best strategy for a coding task based on past success.
- Ranking skills/tools by usefulness for a specific intent.
- Reducing semantic noise in retrieval by preferring high-utility traces.

### Code Example

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemoryChromaDBStore } from "@ravenlens/raven-adk/memory";

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You learn from every deployment.",
  messages: [{ type: "user", content: "Deploy the service" }],
  tools: [],
  memory: [
    {
      memory: new MemoryChromaDBStore({
        hasToRemember: [
          "* Outcome of each deployment strategy",
          "* Feedback score and root cause"
        ].join("\n"),
        session: "deployments"
      }),
      name: "Deployment Episodes",
      purpose: "Remember which deployment strategies worked and which failed."
    }
  ]
  // e_MemRL configuration for Q-score tracking is described in the MemRL extended spec
});
```

See the [extended MemRL specification](./memrl/Extanded-MemRL.md) for the full `QScoreTrace`, feedback methods, and formulas.

## Mem0 — Factual Memory

### Description
Mem0 keeps concise facts about the user, task, and world current. It extracts candidate facts from recent conversation context, retrieves similar stored facts, then reconciles them with `add`, `update`, `delete`, or `noop`.

### Requirements
- A `Mem0` instance with a `name` and `purpose`.
- Either `model`, a separate `agent`, or both `factExtractor` and `updatePlanner`.
- A `Mem0MemoryStore` for facts that must survive process restarts.
- A semantic, BM25, or hybrid `retriever` when the lexical fallback is insufficient.

### Usecases
- Personal assistants that remember names, birthdays, interests.
- Agents that track evolving project constraints.
- Long-running conversations where consistency matters.

### Code Example

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { Mem0 } from "@ravenlens/raven-adk/memory";
import { OpenAI } from "@ravenlens/raven-adk/models";

const factualMemory = new Mem0({
  name: "User facts",
  purpose: "Keep durable user preferences current.",
  scope: "user-123",
  hasToRemember: [
    "* User name",
    "* User job title and team",
    "* Explicitly stated preferences (tone, format, channels)"
  ].join("\n"),
  model: new OpenAI({ model: "gpt-5.5-nano" })
});

const agent = new ReActAgent({
  model: new OpenAI({ model: "gpt-5.5-nano" }),
  systemPrompt: "You are a personal assistant.",
  messages: [{ type: "user", content: "Remind me about my standup" }],
  tools: [],
  memory: factualMemory
});
```

`ReActAgent` automatically runs Mem0 retrieval before the main or a delegated agent starts and reconciliation after it completes. See the [Mem0 guide](./mem0/README.md) for custom stores, LLM update JSON, and a dedicated updater agent.

## Custom Memory

### Description
Custom memory lets you provide your own implementation of `SchemaMemoryStore`. You can use any backend (PostgreSQL + pgvector, Pinecone, Redis, RavenAgentsHubDB, etc.), apply custom retrieval logic, and even run another agent before/after recall.

### Requirements
- Implement the `SchemaMemoryStore` interface.
- Provide `fetchMemory`, `saveMemory`, `fetchMemoryConclusionFile`, and `writeMemoryConclusionFile`.
- Decide your own duplicate detection, ranking, or preprocessing rules.

### Usecases
- Connecting to an existing corporate knowledge base.
- Applying domain-specific ranking (e.g., BM25 over legal documents).
- Running a summarization or anonymization agent before storing memory.

### Code Example

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import {
  SchemaMemoryStore,
  SchemaMemoryConfig,
  MemoryRecord,
  MemoryFetchResult,
  FetchBySemantic,
  MemoryFetch
} from "@ravenlens/raven-adk/memory/store";

export class MyCustomMemoryStore implements SchemaMemoryStore {
  config: SchemaMemoryConfig;

  constructor(config: SchemaMemoryConfig) {
    this.config = config;
  }

  async fetchMemoryConclusionFile(): Promise<string> {
    return "";
  }

  async writeMemoryConclusionFile(fileContent: string): Promise<boolean> {
    const maxCharacters = this.config.conclusion?.maxCharacters;
    if (maxCharacters !== undefined && fileContent.length > maxCharacters) {
      return false;
    }
    return true;
  }

  async fetchMemory(fetchBy: FetchBySemantic | MemoryFetch.Explore): Promise<MemoryFetchResult> {
    if (typeof fetchBy !== "number" && fetchBy.by === MemoryFetch.Sematic) {
      // Your semantic / keyword retrieval logic
    } else {
      // Your graph exploration logic
    }
    return undefined;
  }

  async saveMemory(record: MemoryRecord): Promise<boolean> {
    // Your persistence logic
    return true;
  }
}

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You use a custom knowledge base.",
  messages: [{ type: "user", content: "Find the policy" }],
  tools: [],
  memory: new MyCustomMemoryStore({
    hasToRemember: "Company policies and procedures",
    session: "org-123"
  })
});
```

## Combining memory systems

There is no restriction on using only one memory system. A common pattern is:

```typescript
memory: [
  { memory: factualStore, name: "User Facts", purpose: "..." },   // Mem0-style
  { memory: proceduralStore, name: "Procedures", purpose: "..." }, // MemP-style
  { memory: episodicStore, name: "Episodes", purpose: "..." }      // MemRL-style
]
```

The agent will see each system as a separate tool pair and conclusion, letting it choose the right memory for the right data.

## Further Reading

- [Main Memory documentation](../Memory.md) — how memory works in `ReActAgent`, the conclusion system, and built-in stores.
- [MemRL description](./memrl/MemRL-Description.md) — deep dive into MemRL concepts.
- [Extended MemRL specification](./memrl/Extanded-MemRL.md) — `QScoreTrace`, feedback API, and formulas. 
