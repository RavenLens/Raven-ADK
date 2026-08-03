# MemP - Procedural Memory

**Paper:** [Memp: Exploring Agent Procedural Memory](https://arxiv.org/pdf/2508.06433) (ACL 2026 Findings)

MemP remembers how an agent completed a task. Each procedure retains both a concrete, step-by-step trajectory and a higher-level script so close tasks can replay proven details while related tasks can reuse the general approach.

The implementation follows the paper's Build, Retrieve, and Update loop:

- Build: add a procedure with a retrieval key, detailed steps, and an abstract script.
- Retrieve: return the best active procedures for a task. A lexical fallback is included; inject a vector, BM25, or hybrid retriever for production search.
- Update: add, revise, deprecate, or remove procedures as new experience arrives.

## Quick Start

```typescript
import { MemP } from "@ravenlens/raven-adk/memory";

const procedures = new MemP({
  name: "Production playbooks",
  purpose: "Reuse validated SRE workflows.",
  scope: "production",
  topK: 3
});

await procedures.addProcedure({
  id: "rollback-canary",
  key: "Roll back a failed canary deployment",
  steps: [
    "Pause traffic shifting.",
    "Route traffic to the stable deployment.",
    "Verify error rates before closing the incident."
  ],
  script: "Stop exposure first, restore the known-good version, then verify health.",
  tags: ["deployment", "rollback"]
});

const result = await procedures.retrieve("Roll back the failed canary");
const playbook = result.procedures[0]?.procedure;
```

`retrieve()` only returns active procedures. `deprecateProcedure()` keeps the historical record for audit while excluding it from later retrieval.

## Updating Procedures

Use `applyUpdate()` to make the repository's changes explicit and auditable:

```typescript
await procedures.applyUpdate({
  type: "update",
  procedureId: "rollback-canary",
  patch: {
    steps: [
      "Pause traffic shifting.",
      "Route traffic to the stable deployment.",
      "Verify error rate, latency, and saturation before closing the incident."
    ]
  }
});

await procedures.applyUpdate({
  type: "deprecate",
  procedureId: "legacy-rollback",
  reason: "The legacy deployment path was removed."
});
```

The supported operations map directly to the paper's update mechanism: `add`, `update`, `deprecate`, and `remove`.

## Durable Storage and Retrieval

`InMemoryMemPProcedureStore` is the default and is useful for a single process. For durable memory, implement `MemPProcedureStore` and pass it as `store`; its four methods are `list`, `get`, `set`, and `delete`.

Pass `retriever` when the store is backed by semantic or lexical infrastructure. It receives the task query plus the scope, `topK`, and similarity threshold, then returns `MemPProcedureCandidate` values with normalized scores from $0$ to $1$.

```typescript
const procedures = new MemP({
  name: "Team procedures",
  purpose: "Retrieve reusable workflows across deployments.",
  scope: "team-a",
  store: durableProcedureStore,
  retriever: async (query, { scope, topK }) => {
    return await searchProceduresByEmbedding(query, scope, topK);
  }
});
```

## Lifecycle Hooks

`MemP` implements `DeterministicMemorySchema`. When deterministic-memory lifecycle execution is enabled in `ReActAgent`, it will:

- retrieve procedures in `beforeOrchestratorAgentRun` and `beforeSubagentRun`;
- invoke `updateBuilder` after a conversation, orchestrator run, or subagent run;
- attach retrieved scripts and numbered steps to agent awareness.

`updateBuilder` is deliberately application-provided because converting a raw trajectory into a reliable script is domain and model dependent. It returns one or more `MemPUpdate` operations. Choose an `updatePolicy` matching the paper:

- `vanilla`: accept the builder's operations.
- `validation`: only build updates when `outcomeEvaluator` reports success.
- `adjustment`: allow the builder to revise or deprecate a retrieved procedure after failure.

```typescript
const procedures = new MemP({
  name: "Validated procedures",
  purpose: "Turn successful agent work into reusable playbooks.",
  updatePolicy: "validation",
  outcomeEvaluator: async instruction => instruction.contextAgentState.isAborted !== true,
  updateBuilder: async () => ({
    type: "add",
    procedure: {
      key: "Recover a failing queue consumer",
      steps: ["Pause new messages.", "Resolve the consumer failure.", "Resume and observe lag."],
      script: "Stabilize intake, repair the consumer, then verify backlog recovery."
    }
  })
});
```

Until ReAct invokes deterministic lifecycle hooks directly, call `retrieve`, `addProcedure`, and `applyUpdate` from the application's agent orchestration code.

## Further Reading

- [Memory systems overview](../README.md)
- [Main Memory documentation](../../Memory.md)
