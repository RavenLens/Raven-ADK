# Coding Agents Specification

Status: design contract for the CodeAct and SupervisedCodeAct patterns.

This document is normative. `MUST` means required for conformance, `SHOULD`
means the default recommendation that may be changed for a documented reason,
and `MAY` means optional. The product intent and configuration examples are in
[Vision.md](./Vision.md). The implementation order is in
[ROADMAP.md](./ROADMAP.md).

## 1. Scope

The coding-agent package provides two patterns for changing and validating a
software workspace:

- **CodeAct:** one coding agent reasons, acts, validates, and repairs without
  delegating to workers.
- **SupervisedCodeAct:** a supervisor plans and accepts the complete task while
  workers execute bounded tasks inside optional groups.

Both patterns build on the existing RavenADK abstractions:

- [ReActAgent](../ReAct.agent.ts) for model invocation, tools, plugins, memory,
  skills, and abort handling.
- [Graph](../../graph/index.ts) for lifecycle orchestration and state changes.
- [Tool](../tools/tools.ts) for tool registration and invocation.
- [CodeExecutionSandboxSchema](../tools/CodeExecutionSandboxes/mutual.ts) for
  code and command execution.
- [HITLTransportSchema](../tools/hitl/hitlToolSchema.ts) for approval and user
  interaction.
- Existing deterministic and tool-based memory schemas under
  `src/agent/memory/schema/`.

The coding layer adds workspace ownership, change sets, validation evidence,
worker groups, coding events, and coding-specific memory records.

## 2. Non-goals for the First Release

The first release does not require:

- MCTS-based worker selection.
- MemRL-based worker scoring or automatic model routing.
- Persistent worker or coordinator quality measurements, learned routing, or
  automatic model routing. Group Q-Score persistence is specified in section
  8.3 and is required for configured groups.
- Dynamic group eviction and recomposition.
- Automatic replication of every task.
- Arbitrary worker-to-worker spawning.
- A built-in AST or LSP provider for every language.
- Git commits, pushes, or deployment as implicit behavior.

These capabilities MAY be added behind explicit interfaces after the base
lifecycle is stable. They MUST NOT be required to execute a basic CodeAct run.

## 3. Core Invariants

Every conforming implementation MUST enforce these invariants:

1. A run has a stable `runId`, a pattern, a workspace, an actor, and a terminal
   status.
2. The agent MUST inspect the relevant workspace before the first mutation.
3. The agent MUST create a plan with tasks and acceptance criteria before the
   first mutation unless the caller explicitly opts into a read-only query.
4. Every mutation MUST be represented by a change set.
5. Every change set MUST identify its base workspace revision or snapshot.
6. Proposal mode MUST NOT mutate the target workspace.
7. Only one applier MAY mutate a target workspace at a time.
8. Parallel workers MUST use isolated snapshots, isolated worktrees, or return
   read-only analysis. They MUST NOT concurrently write the same target files.
9. A validation command MUST produce structured evidence, including success,
   exit code, output, and timeout state.
10. A run MUST NOT report `completed` when required validation failed or when an
    unresolved conflict remains.
11. An abort MUST stop new actions and report changes already applied before the
    abort.
12. Events MUST identify their producer and MUST be emitted for every public
    state transition.
13. Approval policy MUST be evaluated before an action that requires approval.
14. A worker, group coordinator, or autopilot policy MUST NOT bypass the global
    workspace and security policy.

## 4. Terminology

- **Run:** one invocation of a coding pattern for one user objective.
- **Workspace:** the bounded filesystem and revision on which a run operates.
- **Plan:** ordered or dependency-linked tasks created before mutation.
- **Task:** a bounded unit of work with instructions, paths, capabilities,
  dependencies, and acceptance criteria.
- **Change set:** a reviewable collection of file operations produced by an
  actor for a task.
- **Validation:** a configured test, build, lint, typecheck, or other command
  that produces evidence about a change.
- **Actor:** the CodeAct agent, supervisor, worker, group coordinator, or system
  component that produced an event or artifact.
- **Worker:** a configured delegated agent that performs a bounded task.
- **Group:** a runtime collection of workers assigned to related tasks.
- **Group coordinator:** an optional group-local supervisor that aggregates,
  reviews, and optionally participates in group work.
- **Supervisor:** the global owner of planning, delegation, review, and final
  acceptance in SupervisedCodeAct.
- **Applier:** the serialized component that applies an accepted change set to
  a target workspace.

## 5. Public Data Contracts

The following types define the minimum conceptual contract. The concrete
implementation MAY use generics or adapters, but it MUST preserve the fields'
meaning.

```ts
export type CodingPattern = "codeact" | "supervised-codeact";

export type CodingRunStatus =
    | "running"
    | "waiting-for-approval"
    | "completed"
    | "blocked"
    | "failed"
    | "aborted";

export type WorkspaceWriteMode =
    | "proposal"
    | "apply"
    | "approval-required";

export interface CodingWorkspaceConfig {
    root: string;
    writeMode?: WorkspaceWriteMode;
    allowedPaths?: string[];
    deniedPaths?: string[];
    workerIsolation?: "none" | "snapshot" | "worktree";
    applyMode?: "serialized";
}

export interface CodingTask {
    id: string;
    title: string;
    instructions: string;
    dependencies: string[];
    acceptanceCriteria: string[];
    allowedPaths?: string[];
    requiredCapabilities?: string[];
    validationCommandNames?: string[];
}

export interface CodingPlan {
    id: string;
    objective: string;
    tasks: CodingTask[];
    createdBy: string;
    rationale?: string;
}

export type FileOperation = "create" | "update" | "delete" | "rename";

export interface ChangedFile {
    path: string;
    operation: FileOperation;
    previousHash?: string;
    nextHash?: string;
    diff?: string;
    content?: string;
}

export interface ChangeSet {
    id: string;
    taskId: string;
    actorId: string;
    baseRevision: string;
    files: ChangedFile[];
    status: "proposed" | "approved" | "applied" | "rejected" | "conflicted";
    rationale?: string;
}

export interface ValidationCommand {
    name: string;
    command: string;
    args: string[];
    workingDirectory?: string;
    timeoutMs?: number;
    required?: boolean;
}

export interface ValidationResult {
    name: string;
    command: string;
    args: string[];
    cwd: string;
    success: boolean;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
    error?: string;
}

export interface CodingRunResult {
    runId: string;
    pattern: CodingPattern;
    status: Exclude<CodingRunStatus, "running" | "waiting-for-approval">;
    summary: string;
    plan?: CodingPlan;
    changes: ChangeSet[];
    validations: ValidationResult[];
    unresolved: string[];
}

  export interface GroupQScore {
    groupId: string;
    scope: string;
    qScore: number;
    updates: number;
    updatedAt?: number;
  }

  export interface GroupQScoreStore {
    get(scope: string, groupId: string): Promise<GroupQScore | undefined>;
    set(score: GroupQScore): Promise<void>;
  }
```

A result MAY contain a full file content block, a unified diff, or both. The
configured IDE integration decides which representation it accepts. A change
set MUST always contain enough information to identify every changed path and
its application status.

## 6. Base Configuration

Both patterns share the following configuration concepts:

```ts
export interface CodingAgentBaseConfig {
    pattern: CodingPattern;
    model: unknown;
    systemPrompt: string;
    workspace: CodingWorkspaceConfig;
    tools: unknown[];
    mcp?: unknown[];
    skills?: unknown;
    memory?: unknown;
    sandboxes?: {
        default: unknown;
        byLanguage?: Record<string, unknown>;
    };
    validation: {
        commands: ValidationCommand[];
        maxRepairAttempts?: number;
    };
    plan?: {
        required?: boolean;
        maxSteps?: number;
    };
    hitl?: {
        mode: "human" | "autopilot" | "hybrid";
        approvals?: Record<string, "human" | "autopilot" | "allow" | "deny">;
    };
    abort?: AbortSignal;
}
```

Required defaults are:

- `plan.required`: `true`.
- `workspace.writeMode`: `proposal`.
- `workspace.workerIsolation`: `snapshot` for supervised workers.
- `workspace.applyMode`: `serialized`.
- `validation.maxRepairAttempts`: `2` for CodeAct and `3` for
  SupervisedCodeAct unless configured otherwise.
- `hitl.mode`: no approval transport is required for read-only work; a mutating
  action without a configured approval transport follows the workspace write
  mode and MUST NOT silently escalate privileges.

The implementation MUST preserve the existing ReActAgent tool, skill, memory,
plugin, and abort contracts when adapting them to this configuration.

## 7. CodeAct Contract

### 7.1 Identity and Authority

CodeAct MUST:

- Create exactly one primary coding actor for a run.
- Reject or ignore worker handoff directives.
- Avoid creating worker groups.
- Own the plan, change proposals, validation, repair, and final result.
- Use the configured sandbox and workspace policy for every command or write.

CodeAct MAY execute multiple independent read-only tools in parallel. It MAY
execute multiple side-effect-safe tools in parallel when the tool declarations
permit it. It MUST execute overlapping writes and dependent commands in order.

### 7.2 Lifecycle

The graph-backed lifecycle is:

1. `inspect`: discover the workspace, relevant files, project documentation,
   available scripts, language information, and diagnostics.
2. `plan`: create tasks, dependencies, acceptance criteria, and validation
   commands.
3. `propose`: produce a change set for one task.
4. `approval`: evaluate human, autopilot, or hybrid policy when required.
5. `apply`: apply the approved change set or expose it to the IDE in proposal
   mode.
6. `validate`: run required validation commands and collect evidence.
7. `repair`: reason from failed evidence and create a new proposal, subject to
   the repair budget.
8. `review`: compare the result against the objective and acceptance criteria.
9. `conclude`: return a `CodingRunResult` and emit the terminal event.

A failed validation MUST route to `repair` or `blocked`; it MUST NOT route
straight to `completed`.

### 7.3 CodeAct State

The graph state MUST be able to represent at least:

```ts
interface CodeActState {
    runId: string;
    phase:
        | "inspect"
        | "plan"
        | "propose"
        | "approval"
        | "apply"
        | "validate"
        | "repair"
        | "review"
        | "conclude";
    plan?: CodingPlan;
    activeTaskId?: string;
    changes: ChangeSet[];
    validations: ValidationResult[];
    repairAttempts: number;
    unresolved: string[];
    isAborted?: boolean;
}
```

## 8. SupervisedCodeAct Contract

### 8.1 Identity and Authority

SupervisedCodeAct MUST create one supervisor for the run. The supervisor owns:

- The global objective and plan.
- Task decomposition and dependency tracking.
- Worker selection from the configured worker registry.
- Group creation when allowed.
- Review of worker change sets and evidence.
- Reassignment, repair, and re-planning.
- Final acceptance or blocking decision.

The supervisor MAY participate in implementation only if explicitly configured
as a worker-like actor. Even then, its changes MUST use the same change-set and
review protocol as worker changes.

Workers MUST NOT:

- Modify the target workspace concurrently with another writer.
- Bypass allowed paths, tool capabilities, sandbox policy, or HITL policy.
- Declare the global run complete.
- Spawn arbitrary workers unless a future delegation capability explicitly
  grants that authority.

### 8.2 Worker Configuration

Each worker MUST have:

```ts
export type WorkerSubrole = "worker" | "coordinator-of-group";

export interface CodingWorkerConfig {
    id: string;
    subrole: WorkerSubrole;
    model: unknown;
    systemPrompt?: string;
    roleDescription: string;
    responsibilities: string[];
    tools: unknown[];
    allowedPaths?: string[];
    readOnly?: boolean;
}
```

A worker receives a task, the relevant project context, its capabilities, and
its path restrictions. A worker result MUST include either a change set,
read-only findings, or a blocker with evidence.

### 8.3 Group Configuration

The group model MUST support the following configuration:

```ts
export type GroupPrivacy =
    | "all"
    | "private"
    | "private-with-coordinator"
    | "private-with-coordinator-and-supervisor";

  export interface GroupQScoreConfiguration {
    initialQScore: number;
    scoreStore: GroupQScoreStore;
    scope: string;
  }

export interface GroupConfiguration {
    allowCreation: boolean;
    maxParallel: number;
    qScore: GroupQScoreConfiguration;
    communication: {
        enabled: boolean;
        privacy: GroupPrivacy;
    };
    replication: {
        enabled: boolean;
        maxReplicas: number;
    };
    coordinator: {
        enabled: boolean;
        participates: boolean;
        maxDelegationCycles: number;
    };
    definitions?: GroupDefinition[];
}

export interface GroupDefinition {
    id: string;
    workerIds: string[];
    taskIds?: string[];
    coordinatorId?: string;
}
```

The semantics are:

- `allowCreation` controls whether the supervisor can create runtime groups
  beyond configured definitions.
- `maxParallel` limits active groups. A group waiting for approval or a
  serialized apply stage does not bypass this limit.
- `qScore.initialQScore` MUST be a number in the inclusive range `[0, 1]` and
  is used when a group has no stored score.
- `qScore.scoreStore` is the persistence boundary for group usefulness. It
  MUST be backed by a database or another durable structured store, keyed by
  both `scope` and `groupId`, and MUST survive process restarts. An
  implementation MUST NOT silently replace it with a process-local store.
- `qScore.scope` identifies the learning boundary, such as a workspace or
  project. The same scope and group ID MUST be used to retrieve a score for a
  later run.
- When a group is created or selected, the supervisor MUST load its stored
  score before using Q-Score for routing or group comparison. If no score
  exists, it MUST use `initialQScore` and persist the first score after a
  validated outcome.
- A validated group outcome MAY update the Q-Score. The resulting score MUST
  remain in `[0, 1]` and MUST be persisted before it is used by a later run.
  Q-Score is an advisory routing and comparison signal; it MUST NOT replace
  supervisor review or final acceptance.
- A score-store read or write failure MUST be observable and MUST block the
  score-dependent routing or comparison operation rather than silently using
  stale or transient data.
- `communication.enabled: false` disables peer communication except for
  required system routing and final result delivery.
- `all` makes group communication visible to all group participants, the
  coordinator, and the supervisor.
- `private` makes a message visible only to its sender and explicit recipient.
- `private-with-coordinator` additionally exposes it to the group coordinator.
- `private-with-coordinator-and-supervisor` additionally exposes it to the
  global supervisor.
- A group MAY run without a coordinator.
- A coordinator with `participates: false` only measures, aggregates, and
  routes group work.
- A coordinator with `participates: true` may implement tasks but its changes
  remain worker changes and require supervisor review.
- `maxDelegationCycles` counts coordinator-driven reassignment or repair loops.
  At the limit, the group MUST return `blocked` or escalate to the supervisor.
- Replication runs the same task in separate isolated snapshots. The
  supervisor compares the results and accepts at most one change set for the
  target workspace unless an explicit merge policy exists.

### 8.4 Supervised Lifecycle

The graph-backed lifecycle is:

1. `supervisor.inspect`: inspect the workspace and project documentation.
2. `supervisor.plan`: create the global plan and task dependency graph.
3. `supervisor.delegate`: assign ready tasks to workers and groups.
4. `group.execute`: workers inspect, propose, and validate within their
   isolated context.
5. `group.coordinate`: optionally aggregate worker results and group-local
   communication.
6. `supervisor.review`: evaluate change sets against task criteria and evidence.
7. `supervisor.apply`: serialize accepted changes into the target workspace.
8. `integrate.validate`: run final project-level validation after application.
9. `supervisor.repair`: reassign or repair failed tasks, bounded by budgets.
10. `supervisor.conclude`: accept the result or return blocked/failed evidence.

Independent tasks MAY be delegated in parallel. A task with unmet dependencies
MUST remain pending. The final integrated validation MUST run after all accepted
changes are applied; worker-local validation is not sufficient by itself.

## 9. Change Protocol

### 9.1 Proposal and Application

A worker or CodeAct agent creates a `ChangeSet` from a known base revision. The
applier MUST:

1. Confirm that the target revision still matches the change set base or report
   a conflict.
2. Re-check allowed and denied paths.
3. Re-check approval policy.
4. Apply the file operations atomically where the backend supports it.
5. Calculate the resulting revision or file hashes.
6. Emit an application result.

A conflict MUST produce `status: "conflicted"`. It MUST NOT silently overwrite
newer content.

In proposal mode, the applier does not modify the workspace. It emits the
change artifact so the IDE or caller can accept, reject, or apply it.

### 9.2 IDE Change Communication

The streaming protocol MUST support a change artifact while it is produced and
again in the final result. A change artifact contains:

- Run, actor, task, and group identifiers.
- The changed file paths and operations.
- A unified diff, file content blocks, or a reference to a chunked artifact.
- The base revision.
- The current change status.
- Acceptance criteria and validation evidence when available.

Large changes MAY be chunked into ordered events. The final result MUST contain
the complete file inventory even when the stream used chunks. File contents and
diffs MUST follow the configured privacy and redaction policy.

## 10. Tools, MCP, AST, and LSP

### 10.1 Tool Capabilities

Coding tools SHOULD declare these properties:

```ts
export type ToolSideEffect = "none" | "workspace" | "external";

export interface CodingToolPolicy {
    toolName: string;
    sideEffect: ToolSideEffect;
    parallelSafe: boolean;
    requiresApproval: boolean;
    allowedRoles?: string[];
}
```

The runtime MUST reject a parallel execution request when any tool is not
`parallelSafe`, when two tools overlap in a mutable path, or when their side
effects have an ordering dependency. Multiple tools MAY be executed in one
model turn when this policy permits it.

### 10.2 MCP

Multiple MCP servers MAY be registered. Their tools MUST:

- Have stable names or namespaces to avoid collisions.
- Pass through the same role, path, approval, sandbox, and event policies as
  local tools.
- Identify the originating MCP server in invocation and failure events.
- Be independently enabled or disabled by configuration.

### 10.3 AST and LSP

AST and LSP are capability contracts, not assumptions that every language has a
provider. An adapter MAY provide:

- Syntax parsing and structural queries.
- Symbol definitions and references.
- Diagnostics.
- Safe structural transforms.
- Formatting and code actions.

Read-only AST/LSP operations MAY run in parallel. Structural mutations MUST
produce a normal change set and follow the same review and application rules as
textual patches.

## 11. Sandboxes and Workspace Safety

The sandbox layer MUST enforce:

- A canonical workspace root.
- Path traversal and symlink escape protection.
- Command, argument, and working-directory validation.
- Time, output, CPU, memory, and process limits where supported.
- Explicit network access policy.
- Explicit environment-variable and secret policy.
- Abort propagation to running commands.
- Cleanup of temporary snapshots and worktrees.

A configuration MAY define several sandboxes:

```ts
interface CodingSandboxConfiguration {
    default: unknown;
    byLanguage?: Record<string, unknown>;
    allLanguagesOverride?: unknown;
}
```

`allLanguagesOverride` has highest precedence, then the language-specific
sandbox, then `default`. A sandbox failure is validation or action evidence; it
MUST NOT be reported as a successful command.

The existing command execution result already exposes exit code, timeout,
stdout, stderr, and truncation. Coding orchestration MUST preserve that
structured information rather than reducing all command failures to a single
string.

## 12. HITL and Autopilot

The coding layer uses the existing HITL transport for communication and adds
policy meaning to approvals. Approval targets SHOULD include:

- Applying a proposed change.
- Writing outside the task's allowed paths.
- Deleting or renaming files.
- Installing packages or changing dependency manifests.
- Network access or external MCP calls.
- Reading or writing secrets.
- Git commit, push, deployment, or other external side effects.

The three modes are:

- `human`: a user response is required.
- `autopilot`: a deterministic rule evaluates the action.
- `hybrid`: low-risk actions use deterministic rules and configured risky
  actions require a human.

An autopilot rule MUST return an auditable decision containing action, actor,
reason, affected paths, risk classification, and correlation ID. An autopilot
MUST NOT use an unconstrained language-model answer as its only approval rule.

A denied action returns a tool or change failure to the owning agent, allowing
it to revise the plan or report `blocked`. It MUST NOT be retried indefinitely.

## 13. Events and Streaming

Every coding event MUST use an envelope equivalent to:

```ts
export interface CodingEvent {
    event: string;
    runId: string;
    sequence: number;
    actor: {
        id: string;
        role: "codeact" | "supervisor" | "worker" | "coordinator" | "system";
    };
    taskId?: string;
    groupId?: string;
    payload: unknown;
}
```

`sequence` MUST be monotonic within a run. Events from parallel actors MAY
arrive in completion order, but each event keeps its producer identity and
sequence. Consumers MUST NOT infer task ownership from arrival order alone.

At minimum, implementations MUST emit events for:

- `run_started`, `run_completed`, `run_blocked`, `run_failed`, `run_aborted`.
- `plan_created`, `plan_updated`.
- `task_created`, `task_assigned`, `task_started`, `task_completed`.
- `worker_started`, `worker_finished`.
- `group_created`, `group_started`, `group_completed`.
- `group_q_score_loaded`, `group_q_score_updated`,
  `group_q_score_persistence_failed`.
- `tool_invoked`, `tool_completed`, `tool_failed`.
- `change_proposed`, `change_chunk`, `change_approved`, `change_applied`,
  `change_rejected`, `change_conflicted`.
- `validation_started`, `validation_passed`, `validation_failed`.
- `approval_requested`, `approval_resolved`.
- `repair_started`, `replan_started`.

Events MUST expose observable reasoning summaries, decisions, and evidence. A
stream MUST NOT expose hidden chain-of-thought as a required API field.

The event system SHOULD adapt the existing ReActAgent stream model while
adding actor, task, group, and change correlation. A stream consumer SHOULD be
able to render CodeAct, supervisor, worker, and coordinator activity without
parsing free-form model messages.

## 14. Skills, Plugins, and Memory

### 14.1 Skills

Both patterns MAY discover and use skills through the existing skills system.
A skill invocation MUST follow the worker's capability and workspace policy.
An agent MAY produce a reusable skill only when the skill store and approval
policy permit writes to the skill location. A generated skill is a change set,
not an invisible side effect.

### 14.2 Plugins

Plugins SHOULD support the existing ReActAgent lifecycle and MAY add coding
stages for:

- Before and after workspace inspection.
- Before and after planning.
- Before and after worker or group execution.
- Before change proposal and application.
- Before and after validation.
- Before final conclusion.

A plugin MUST identify whether it changed configuration or graph state. Plugin
failures MUST be observable and MUST follow the configured fail-open or
fail-closed policy.

### 14.3 Coding Memory

Coding memory MUST distinguish at least these scopes:

- **Run memory:** temporary facts and decisions for one invocation.
- **Group memory:** communication and findings for one group.
- **Project memory:** persistent concepts and relations for a project.

The minimum record categories are:

- Code concepts, symbols, modules, and project relations.
- Project conventions and preferred commands.
- User constraints and accepted architectural decisions.
- Validation failures and successful repair procedures.
- Worker or coordinator outcomes when telemetry is enabled.
- Group Q-Scores and their validated outcome updates.

A persistent record SHOULD include project identity, revision, scope, source,
timestamp, and confidence. Memory retrieval MAY combine deterministic files,
structured databases, and RAG stores. Memory failure MUST produce a memory
error event and MUST NOT fabricate evidence or silently alter a change set.

## 15. Errors, Retry, and Cancellation

The runtime MUST distinguish:

- `blocked`: a required input, approval, capability, or dependency is missing.
- `failed`: execution completed but the agent could not satisfy the task.
- `aborted`: the caller cancelled the run.
- `conflicted`: a proposed change could not apply to its base revision.
- `validation-failed`: required evidence did not pass.
- `sandbox-failed`: the execution environment could not safely run an action.

Retries MUST be bounded separately for:

- Model or tool transient failures.
- Worker repair cycles.
- Group coordinator delegation cycles.
- Full-plan replanning.

A retry MUST preserve the failure evidence that motivated it. A repair attempt
MUST not erase previous change sets or validation results from the final
result.

When an abort signal is raised, the runtime MUST:

1. Stop scheduling new model, tool, worker, or group actions.
2. Propagate cancellation to supported sandbox commands.
3. Stop or mark pending approvals as cancelled.
4. Preserve already emitted events and applied changes.
5. Return `status: "aborted"` with the partial result.

## 16. Security and Privacy

The implementation MUST treat generated code and model-provided commands as
untrusted input. It MUST not execute a command only because the model placed it
in a text response. Commands MUST pass through a registered tool or sandbox.

The implementation MUST provide configuration for:

- Allowed and denied filesystem paths.
- Allowed commands and arguments.
- Network access.
- Environment variables and secrets.
- File-content and event redaction.
- Worker and group visibility.
- External side effects.

Private group messages MUST not be forwarded to actors excluded by the selected
privacy level. Logs and telemetry MUST redact credentials, tokens, and other
configured sensitive values.

## 17. Acceptance Criteria

### CodeAct

A conforming CodeAct implementation MUST pass deterministic tests proving that:

1. It inspects and plans before the first write.
2. It returns a proposed change with changed paths and a diff or content block.
3. Proposal mode does not mutate the target workspace.
4. Apply mode applies an approved change and reports the resulting status.
5. Required validation runs after application.
6. A failed validation triggers bounded repair or returns `blocked`/`failed`.
7. An approval denial prevents the protected action.
8. An abort stops new work and reports partial changes.
9. Events contain actor, task, run, sequence, and change correlation.
10. A missing or failed tool never becomes fabricated success evidence.

### SupervisedCodeAct

A conforming SupervisedCodeAct implementation MUST pass deterministic tests
proving that:

1. The supervisor creates a plan and task dependencies.
2. Workers receive only their configured responsibilities and capabilities.
3. Independent tasks can run in parallel within `maxParallel`.
4. Workers do not concurrently write the target workspace.
5. Groups work with and without a coordinator.
6. Coordinator participation is configurable and attributable.
7. Communication privacy levels route messages correctly.
8. Worker change sets are reviewed before application.
9. Base-revision conflicts are reported instead of overwritten.
10. Failed workers can be repaired or reassigned within the cycle budget.
11. Final integrated validation runs after accepted changes are applied.
12. The supervisor blocks completion when required evidence is missing or fails.
13. Replication accepts at most one result unless an explicit merge policy is
    configured.
14. Group Q-Scores load from and persist to the configured durable score store
  using the configured scope and group ID.
15. A group without a stored score starts at `initialQScore`, and a validated
  outcome persists the updated score for a later run.
16. Score-store failures are observable and do not silently fall back to
  process-local scores.

## 18. Implementation Boundary

The first vertical slice SHOULD implement:

- Static CodeAct configuration and the full single-agent lifecycle.
- Static SupervisedCodeAct workers and serialized change application.
- Read-only parallel work and isolated worker snapshots.
- Structured changes, validation results, approvals, abort, and events.
- Database-backed group Q-Score persistence, loading, and validated updates.
- Interfaces for memory, AST, LSP, telemetry, worker selection, and worker
  evaluation.

The following SHOULD follow after that slice:

- Persistent coding memory adapters.
- Additional AST and LSP providers.
- Autopilot policy libraries.
- Telemetry exporters and quality dashboards.
- Replicated groups.
- MemRL worker evaluation and MCTS worker selection.
- Dynamic group creation, eviction, and recomposition.
- Extraction of optional coding integrations into
  `@ravenlens/raven-adk/codepack`.
