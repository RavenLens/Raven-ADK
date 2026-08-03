# Memory Systems

RavenADK memory gives an agent durable context across runs. Choose a built-in
memory system for factual, procedural, or feedback-driven recall, or implement
custom memory with one of two explicit execution models:

| System | Memory type | Best for | Original paper |
|---|---|---|---|
| [Mem0](./mem0/README.md) | Factual, deterministic | User facts, preferences, constraints, and changing state | [Mem0](https://arxiv.org/pdf/2504.19413) |
| [MemP](./memp/README.md) | Procedural, deterministic | Validated playbooks, tool sequences, and reusable workflows | [MemP](https://arxiv.org/pdf/2508.06433) |
| [MemRL](./memrl/README.md) | Episodic, deterministic | Ranking experiences, tools, or skills by outcome feedback | [MemRL](https://arxiv.org/pdf/2601.03192) |
| Custom tool-based memory | Agent-directed | Knowledge the model should fetch or update only when needed | - |
| Custom deterministic memory | Lifecycle-directed | Recall or reconciliation that must happen at fixed points in every run | - |

## Execution Models

Custom memory uses one of two schemas. Both can be supplied in the same
`ReActAgent` configuration.

## Built-In Memory Systems

All built-in memory systems use deterministic lifecycle hooks, so passing an
instance to `memory` activates its supported ReAct lifecycle behavior.

### Mem0: Factual Memory

Mem0 extracts and reconciles durable facts with `add`, `update`, `delete`, and
`noop`. It is useful for user profiles, current project constraints, and other
facts that may change over time.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { Mem0 } from "@ravenlens/raven-adk/memory";
import { OpenAI } from "@ravenlens/raven-adk/models";

const facts = new Mem0({
  name: "User facts",
  purpose: "Keep durable preferences and project constraints current.",
  scope: "user-123",
  model: new OpenAI({ model: "gpt-5.5-nano" })
});

const agent = new ReActAgent({
  model: new OpenAI({ model: "gpt-5.5-nano" }),
  systemPrompt: "You are a personal assistant.",
  messages: [{ type: "user", content: "I now prefer concise weekly updates." }],
  tools: [],
  memory: facts
});

await agent.invoke();
```

See the [Mem0 guide](./mem0/README.md) and the
[original paper](https://arxiv.org/pdf/2504.19413).

### MemP: Procedural Memory

MemP stores validated trajectories as reusable procedures with concrete steps
and a higher-level script. Configure `updateBuilder` when completed runs should
produce reviewed procedure updates.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemP } from "@ravenlens/raven-adk/memory";

const procedures = new MemP({
  name: "Production playbooks",
  purpose: "Reuse approved SRE recovery procedures.",
  scope: "production",
  updatePolicy: "validation",
  outcomeEvaluator: async instruction => instruction.contextAgentState.isAborted !== true,
  updateBuilder: async instruction => reviewCompletedRun(instruction.contextAgentState.messages)
});

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You are an SRE assistant.",
  messages: [{ type: "user", content: "Recover the failing queue consumer." }],
  tools: [],
  memory: procedures
});
```

`reviewCompletedRun` should return a validated `MemPUpdate`, an array of
updates, or `null`; do not allow unreviewed model output to mutate a production
playbook. See the [MemP guide](./memp/README.md) and the
[original paper](https://arxiv.org/pdf/2508.06433).

### MemRL: Episodic Memory

MemRL combines semantic relevance with a learned Q-score, then accepts outcome
feedback after the application knows whether the selected experience helped.
Provide a `candidateProvider` that queries your vector, BM25, or hybrid store
within the appropriate identity boundary.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemRL } from "@ravenlens/raven-adk/memory";

const episodes = new MemRL({
  name: "Deployment episodes",
  purpose: "Prefer deployment strategies that worked for this team.",
  episodeId: "team-platform",
  candidateProvider: async instruction => {
    const query = instruction.contextAgentState.messages.at(-1)?.content ?? "";
    return await searchDeploymentEpisodes(query);
  }
});

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You are a deployment assistant.",
  messages: [{ type: "user", content: "Deploy the API without downtime." }],
  tools: [],
  memory: episodes
});

await agent.invoke();
// Call episodes.applyFeedback(...) after an application or user outcome is known.
```

See the [MemRL guide](./memrl/README.md), the
[extended specification](./memrl/Extanded-MemRL.md), and the
[original paper](https://arxiv.org/pdf/2601.03192).

## Combining Memory Systems

Mix systems when each owns a distinct responsibility. A common configuration
uses Mem0 for user facts, MemP for proven workflows, a tool-based store for
on-demand project notes, and deterministic custom memory for required policy
or reconciliation work.

```typescript
const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You are a delivery assistant.",
  messages: [{ type: "user", content: "Prepare this week's rollout plan." }],
  tools: [],
  memory: [
    facts,            // Mem0: user facts and constraints
    procedures,       // MemP: validated rollout playbooks
    projectMemory,    // Tool-based: model fetches/saves project notes when useful
    userPreferences   // Deterministic: required preference recall and reconciliation
  ],
  parallelTools: true
});
```

The benefit is separation of concerns: factual updates do not overwrite
procedures, procedural learning does not pollute user preferences, and the
model only calls on-demand memory tools when it needs them. Enable
`parallelTools` only when the underlying tool operations are independent and
safe to run concurrently.

## Create a Custom Memory System

You do not need to extend a RavenADK base class. Implement either
`ToolBasedMemorySchema` or `DeterministicMemorySchema` with a plain object,
factory function, or class. A reusable factory is useful when the memory needs
a database, vector store, or other storage dependency.

1. Choose tool-based memory when the agent should decide when to access it.
2. Choose deterministic memory when retrieval or reconciliation must happen at
  a lifecycle point.
3. Define Zod schemas for every model-callable operation.
4. Keep persistence behind your own storage boundary, then pass the resulting
  memory object through `ReActAgent`'s `memory` option.

### Tool-Based Memory: Create an On-Demand System

Use `ToolBasedMemorySchema` when the agent should decide whether and when to
read or write the memory. Define a `fetch` tool, an `update` tool, or both in
`memoryTools`. `ReActAgent` registers them as ordinary tools, so they follow
normal tool events, HITL rules, and `parallelTools` behavior.

The optional `conclusionPlugin` is registered with the agent automatically.
Use it for work that belongs after the run, such as persisting a compact
summary or updating an external index.

```typescript
import { z } from "zod";
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { ToolBasedMemorySchema } from "@ravenlens/raven-adk/memory";

type ProjectNotesStore = {
  search(query: string): Promise<string[]>;
  save(content: string): Promise<void>;
};

const searchArgs = z.object({ query: z.string().min(1) });
const saveArgs = z.object({ content: z.string().min(1) });

export function createProjectNotesMemory(
  store: ProjectNotesStore
): ToolBasedMemorySchema<typeof searchArgs, typeof saveArgs> {
  return {
    typeMemory: "toolBased",
    name: "Project notes",
    purpose: "Find and preserve durable project decisions.",
    memoryTools: {
      fetch: {
        toolName: "search_project_notes",
        instruction: "Search project notes when a prior decision may answer the request.",
        toolArguments: searchArgs,
        fn: async ({ query }) => {
          const matches = await store.search(query);
          return matches.length ? matches.join("\n") : "No matching project notes.";
        }
      },
      update: {
        toolName: "save_project_note",
        instruction: "Save only durable, confirmed project decisions.",
        toolArguments: saveArgs,
        fn: async ({ content }, agentState) => {
          await store.save(content);
          return `Saved project note from a ${agentState?.messages.length ?? 0}-message run.`;
        }
      }
    }
  };
}

const notes = new Map<string, string>();
const projectMemory = createProjectNotesMemory({
  search: async query => [...notes.values()]
    .filter(note => note.toLowerCase().includes(query.toLowerCase())),
  save: async content => {
    notes.set(`note-${notes.size + 1}`, content);
  }
});

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You help with project work.",
  messages: [{ type: "user", content: "What did we decide about retries?" }],
  tools: [],
  memory: [projectMemory]
});
```

Use stable, descriptive tool names. `ReActAgent` does not add implicit
fetch/save operations for this schema: the tools you declare are exactly the
memory capabilities the model receives.

#### The tool `fn` callback

`memoryTools.fetch.fn` and `memoryTools.update.fn` are the implementations the
agent executes when it calls the tool. Each `fn` receives:

1. `argsObj` — the parsed arguments described by `toolArguments`.
2. `agentState` — a snapshot of the current graph state plus the full
   `messages` array.

The string returned by `fn` is sent back to the model as the tool result. Keep
it concise and actionable: return fetched facts, a confirmation, or guidance
such as "No matching notes found." This is where the memory talks to its
storage backend.

```typescript
fetch: {
  toolName: "search_project_notes",
  instruction: "Search project notes when a prior decision may answer the request.",
  toolArguments: searchArgs,
  fn: async ({ query }, agentState) => {
    const matches = await store.search(query);
    return matches.length ? matches.join("\n") : "No matching project notes.";
  }
}
```

### Deterministic Memory: Create a Lifecycle System

Use `DeterministicMemorySchema` when memory must run at fixed lifecycle
points. `ReActAgent` calls these hooks automatically:

| Hook | When it runs |
|---|---|
| `beforeOrchestratorAgentRun` | Before the main agent prompt is built |
| `afterOrchestratorAgentRun` | After the main agent run completes |
| `beforeSubagentRun` | Before each delegated agent starts |
| `afterSubagentRun` | After each delegated agent completes |

`afterConversationEnd` remains available for a conversation host to call when
it owns a broader conversation lifecycle.

Deterministic memory can also expose `fetch` and `update` request tools under
`config.tools` for the ReAct-managed hooks. RavenADK generates a tool named
`<memory_name>_<hook>_<fetch|update>`. When the model calls one, its arguments
are serialized into `instruction.agentWants` for that memory's matching hook;
an optional `fn` can also perform immediate work and return the tool result.

The object below is a complete custom deterministic system. Put the same
implementation in a factory or class when it needs a configured storage client.

```typescript
import { z } from "zod";
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import {
  DeterministicMemorySchema
} from "@ravenlens/raven-adk/memory";

const preferences = new Map<string, string>();

const userPreferences: DeterministicMemorySchema = {
  typeMemory: "deterministic",
  config: {
    name: "User preferences",
    purpose: "Attach known preferences before a run and reconcile new ones afterward.",
    tools: {
      afterOrchestratorAgentRun: {
        update: {
          instruction: "Record a durable preference explicitly confirmed by the user.",
          args: z.object({ preference: z.string().min(1) }),
          fn: async ({ preference }) => `Preference queued: ${preference}`
        }
      }
    }
  },
  beforeOrchestratorAgentRun: async () => {
    const preference = preferences.get("user-123");
    return preference
      ? [{
          memoryInformations: [`Known user preference: ${preference}`],
          attchToAgentAwareness: true
        }]
      : null;
  },
  afterOrchestratorAgentRun: async instruction => {
    const requests = instruction.agentWants ?? [];
    const updates = requests
      .filter(request => request.type === "update")
      .map(request => JSON.parse(request.wants) as { preference: string });

    for (const { preference } of updates) {
      preferences.set("user-123", preference);
    }

    return updates.length
      ? [{ updatedInformations: updates.map(({ preference }) => preference) }]
      : null;
  }
};

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You manage user preferences carefully.",
  messages: [{ type: "user", content: "I prefer concise weekly updates." }],
  tools: [],
  memory: [userPreferences]
});
```

Use deterministic memory for guaranteed pre-run recall, post-run
reconciliation, or policy enforcement. Use its optional tools when the model
also needs to describe a specific fetch/update request to the memory logic.

#### The optional tool with `fn` callback

`config.tools[hook].fetch.fn` and `config.tools[hook].update.fn` are optional.
When the agent calls a generated deterministic memory tool:

1. The call is recorded as a **want** for that hook. The serialized arguments
   appear in `instruction.agentWants` when the lifecycle hook runs.
2. If `fn` is provided, it runs immediately and its return value is shown to
   the model as the tool result.
3. The matching lifecycle hook eventually runs and can reconcile all recorded
   wants with durable storage, side effects, or awareness injection.

Omit `fn` when the tool is only a request mechanism; the tool still records the
want and returns a default acknowledgment. Provide `fn` when the call should
also produce an immediate result, such as a lightweight cache lookup or
validation, while keeping durable writes inside the lifecycle hook.

## Further Reading

- [Main memory documentation](../Memory.md)
- [Mem0 guide](./mem0/README.md)
- [MemP guide](./memp/README.md)
- [MemRL guide](./memrl/README.md)