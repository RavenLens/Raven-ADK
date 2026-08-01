# MemP — Procedural Memory

**Paper:** [Memp: Exploring Agent Procedural Memory](https://arxiv.org/pdf/2508.06433) (ACL 2026 Findings)

## Type
Procedural memory — the agent remembers *how something was done* and can reuse approved workflows and new approaches.

## Description
MemP distills past agent trajectories into fine-grained, step-by-step instructions and higher-level, script-like abstractions. A dynamic update regimen continuously corrects and deprecates old entries, so the repository evolves as new experience is gathered.

## Requirements
- A `SchemaMemoryStore` with search support, such as `MemoryChromaDBStore`, `MemoryMongoDBStore`, or `MemoryDiskStore`.
- A `hasToRemember` prompt that focuses on durable workflows, tool sequences, and patterns to keep or avoid.
- (Recommended) `createMemoryConclusionPlugin` to maintain a compact, up-to-date playbook conclusion.
- Retrieval can be semantic or BM25-style depending on the store implementation.

## Usecases
- Reusing a validated deployment, migration, or data-pipeline sequence.
- Remembering how a recurring report, dashboard, or document is built.
- Avoiding deprecated approaches by explicitly marking them in memory.
- Onboarding new team members by replaying the most successful procedures.

## Code Example

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

## Combining with other systems

MemP works best when paired with a factual memory system such as Mem0:

```typescript
memory: [
  {
    memory: proceduralMemory,
    name: "Procedures",
    purpose: "Reusable task playbooks and approved workflows."
  },
  {
    memory: new MemoryChromaDBStore({
      hasToRemember: "* User name, role, preferences",
      session: "user-123"
    }),
    name: "User Facts",
    purpose: "Durable facts about the user."
  }
]
```

## Further Reading
- [Memory systems overview](../README.md)
- [Main Memory documentation](../../Memory.md)
