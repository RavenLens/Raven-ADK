# Mem0 — Factual Memory

**Paper:** [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/pdf/2504.19413)

## Type
Factual memory — the agent remembers stable facts and keeps them updated with user state.

## Description
Mem0 extracts, consolidates, and retrieves salient facts from ongoing conversations. It is optimized for long-term factual coherence: names, preferences, constraints, and explicit statements that evolve over time. A graph-based variant can capture relational structures between facts.

## Requirements
- A `SchemaMemoryStore` such as `MemoryChromaDBStore`, `MemoryMongoDBStore`, or `MemoryDiskStore`.
- A `hasToRemember` list of concrete, stable facts to track.
- (Recommended) `createMemoryConclusionPlugin` to keep a consolidated conclusion.
- Optional graph representation for complex relations.

## Usecases
- Personal assistants that remember names, birthdays, interests, and communication style.
- Agents that track evolving project constraints or business rules.
- Long-running multi-session conversations where consistency matters.
- Reducing token cost by recalling facts instead of replaying full history.

## Code Example

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemoryMongoDBStore, createMemoryConclusionPlugin } from "@ravenlens/raven-adk/memory";
import { OpenAI } from "@ravenlens/raven-adk/models";

const factualMemory = new MemoryMongoDBStore({
  collection: /* your MongoDB collection */,
  hasToRemember: [
    "* User name",
    "* User job title and team",
    "* Explicitly stated preferences (tone, format, channels)"
  ].join("\n"),
  session: "user-123",
  conclusion: { maxCharacters: 2048 }
});

const agent = new ReActAgent({
  model: new OpenAI({ model: "gpt-5.5-nano" }),
  systemPrompt: "You are a personal assistant.",
  messages: [{ type: "user", content: "Remind me about my standup" }],
  tools: [],
  memory: factualMemory,
  plugins: [
    createMemoryConclusionPlugin({
      model: new OpenAI({ model: "gpt-5.5-nano" }),
      systemPrompt: "Keep the user fact summary accurate and concise."
    })
  ]
});
```

## Combining with other systems

Mem0 is often paired with MemP so the agent knows both *who* the user is and *how* to perform tasks:

```typescript
memory: [
  {
    memory: factualMemory,
    name: "User Facts",
    purpose: "Durable facts about the user."
  },
  {
    memory: new MemoryDiskStore({
      hasToRemember: "* Approved workflows and tool sequences",
      session: "user-123"
    }),
    name: "Procedures",
    purpose: "Reusable task playbooks."
  }
]
```

## Further Reading
- [Memory systems overview](../README.md)
- [Main Memory documentation](../../Memory.md)
