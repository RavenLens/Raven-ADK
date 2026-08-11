# MemP - Procedural Memory

**Paper:** [Memp: Exploring Agent Procedural Memory](https://arxiv.org/pdf/2508.06433) (ACL 2026 Findings)

MemP remembers how an agent completed a task. Each procedure retains both a concrete, step-by-step trajectory and a higher-level script so close tasks can replay proven details while related tasks can reuse the general approach.

The implementation follows the paper's Build, Retrieve, and Update loop:

- Build: add a procedure with a retrieval key, detailed steps, and an abstract script.
- Retrieve: return the best active procedures for a task. A lexical fallback is included; inject a vector, BM25, or hybrid retriever for production search.
- Update: add, revise, deprecate, or remove procedures as new experience arrives.

## ReAct Agent and Automatic Evolution

Pass a `MemP` instance as `memory` to `ReActAgent` to run the lifecycle automatically:

1. Before an orchestrator or subagent run, ReAct retrieves matching active procedures and attaches their scripts and steps to agent awareness.
2. After the run, ReAct passes the complete transcript to `updateBuilder`.
3. `updateBuilder` returns zero or more `MemPUpdate` operations, which MemP applies to the repository.

> MemP applies updates automatically, but does not invent them on its own. Your application must review the trajectory with a deterministic validator, a model with structured output, or both, then return a trusted update decision.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { MemP, type MemPUpdate } from "@ravenlens/raven-adk/memory";
import { OpenAI } from "@ravenlens/raven-adk/models";

const procedures = new MemP({
  name: "Production playbooks",
  purpose: "Learn verified SRE procedures from completed ReAct runs.",
  scope: "production",
  updatePolicy: "validation",
  outcomeEvaluator: async instruction => instruction.contextAgentState.isAborted !== true,
  updateBuilder: async instruction => {
    const review = await reviewTrajectory(instruction.contextAgentState.messages);
    return toMemPUpdate(review);
  }
});

const agent = new ReActAgent({
  model: new OpenAI({ model: "gpt-5.5-nano" }),
  systemPrompt: "You are an SRE assistant.",
  messages: [{ type: "user", content: "Recover the failing queue consumer." }],
  tools: [],
  memory: procedures
});

const result = await agent.invoke();
```

`reviewTrajectory` is application code. It should inspect the messages and external outcome signals, then return a validated decision; do not let unvalidated model text directly mutate a production procedure store.

## Turning a Trajectory into a Procedure Update

The trajectory reviewer decides what happened. The mapper below turns that decision into the operation MemP applies after `agent.invoke()`:

```typescript
type ProcedureDecision =
  | {
      kind: "create";
      key: string;
      steps: string[];
      script: string;
      tags: string[];
    }
  | {
      kind: "update";
      procedureId: string;
      steps: string[];
      script: string;
    }
  | {
      kind: "deprecate";
      procedureId: string;
      reason: string;
    }
  | {
      kind: "remove";
      procedureId: string;
    }
  | { kind: "ignore" };

function toMemPUpdate(decision: ProcedureDecision): MemPUpdate | null {
  switch (decision.kind) {
    case "create":
      return {
        type: "add",
        procedure: {
          key: decision.key,
          steps: decision.steps,
          script: decision.script,
          tags: decision.tags
        }
      };
    case "update":
      return {
        type: "update",
        procedureId: decision.procedureId,
        patch: {
          steps: decision.steps,
          script: decision.script
        }
      };
    case "deprecate":
      return {
        type: "deprecate",
        procedureId: decision.procedureId,
        reason: decision.reason
      };
    case "remove":
      return {
        type: "remove",
        procedureId: decision.procedureId
      };
    case "ignore":
      return null;
  }
}
```

Use the following decision rules:

| Trajectory outcome | MemP operation | Effect |
|---|---|---|
| A validated, novel successful workflow | `add` | Creates a procedure with concrete steps and an abstract script. |
| A known procedure worked but needs a correction or better steps | `update` | Revises the active procedure and increments its revision. |
| A procedure is obsolete or unsafe, but its history matters | `deprecate` | Retains an audit record and excludes it from retrieval. |
| An accidental, invalid, or legally removable entry must disappear | `remove` | Permanently deletes the procedure. |
| The trajectory is failed, noisy, or has no durable lesson | `null` | Leaves the repository unchanged. |

`validation` only applies a proposed update when `outcomeEvaluator` returns `true`. Use `adjustment` when the reviewer can identify a procedure that caused a failed run and return an `update` or `deprecate` operation for it. `vanilla` accepts the reviewer's operations without an outcome gate.

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

## Manual Repository Operations

Use `addProcedure()` or `applyUpdate()` when managing the repository outside a ReAct lifecycle:

```typescript
await procedures.applyUpdate({
  type: "add",
  procedure: {
    key: "Roll back a failed canary deployment",
    steps: ["Pause traffic shifting.", "Route traffic to the stable deployment."],
    script: "Stop exposure first, then restore the known-good version."
  }
});

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

await procedures.applyUpdate({
  type: "remove",
  procedureId: "accidentally-imported-playbook"
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

`MemP` implements `DeterministicMemorySchema`. `ReActAgent` invokes the following hooks for configured deterministic memories:

- `beforeOrchestratorAgentRun` and `beforeSubagentRun` retrieve procedures and attach their scripts and numbered steps to agent awareness.
- `afterOrchestratorAgentRun` and `afterSubagentRun` invoke `updateBuilder` and apply its returned operations.

`afterConversationEnd` is available for applications that have a separate conversation-completion event; call it explicitly from that event handler. `updateBuilder` is deliberately application-provided because converting a raw trajectory into a reliable script is domain and model dependent. It returns one or more `MemPUpdate` operations. Choose an `updatePolicy` matching the paper:

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

Use a durable `MemPProcedureStore` in production. `InMemoryMemPProcedureStore` evolves only for the lifetime of its Node.js process.

## Further Reading

- [Memory systems overview](../README.md)
- [Main Memory documentation](../../Memory.md)
