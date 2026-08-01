# MemRL — Episodic Memory with Runtime Reinforcement Learning

**Paper:** [MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory](https://arxiv.org/pdf/2601.03192)

## Type
Episodic memory — the agent remembers *how something went* and learns to rank strategies by their outcomes.

## Description
MemRL treats memory retrieval as a learnable decision problem. Instead of relying only on semantic similarity, it assigns a learned Q-score to each memory, tool, or skill trace and re-ranks candidates by expected utility. Feedback from the user or an evaluator closes the reinforcement-learning loop, while the underlying LLM stays frozen.

Key concepts:
- **Intent-Experience-Utility triplet** — task embedding, action trace, and Q-value.
- **Two-phase retrieval** — first semantic similarity, then utility-aware selection.
- **Runtime feedback** — Q-scores are updated from environmental or user signals.

## Requirements
- A VectorDB (e.g., ChromaDB or Pinecone) and an embedding model for the first retrieval phase.
- A Q-score store for utility values.
- A feedback source: explicit user rating, automated evaluator, or self-evaluation agent.
- (Recommended) `e_MemRL` configuration in `ReActAgent` when available.

## Usecases
- Choosing the best strategy for a coding or reasoning task based on past success.
- Ranking tools and skills by usefulness for a specific user intent.
- Reducing semantic noise in retrieval by preferring high-utility traces.
- Continuous runtime improvement without fine-tuning the LLM.

## Code Example

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
  // e_MemRL configuration for Q-score tracking is described in the extended spec
});
```

For the full Q-score trace API, feedback methods, and update formulas, see the [extended MemRL specification](./Extanded-MemRL.md).

## Combining with other systems

MemRL can sit alongside factual and procedural memories:

```typescript
memory: [
  {
    memory: new MemoryChromaDBStore({ /* ... */ }),
    name: "Episodes",
    purpose: "Outcome-ranked traces for reinforcement learning."
  },
  {
    memory: new MemoryChromaDBStore({ /* ... */ }),
    name: "User Facts",
    purpose: "Factual memory about the user."
  }
]
```

## Further Reading
- [MemRL description](./MemRL-Description.md)
- [Extended MemRL specification](./Extanded-MemRL.md)
- [Memory systems overview](../README.md)
- [Main Memory documentation](../../Memory.md)
