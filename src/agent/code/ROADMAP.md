# Coding Agents Roadmap

This roadmap is the human execution checklist for the coding-agent work. It
turns [Vision.md](./Vision.md) into the contracts in
[Specification.md](./Specification.md), then ships the work in small,
verifiable npm releases.

The current package version is `0.0.11`. Runtime CodeAct and
SupervisedCodeAct code is not shipped yet.

## Working Rules

### Documentation

- Keep [Vision.md](./Vision.md) focused on purpose, user experience, roles,
    tradeoffs, and future direction.
- Keep [Specification.md](./Specification.md) focused on normative behavior,
    configuration contracts, state transitions, events, errors, security, and
    acceptance tests.
- Keep this file focused on human tasks, ordering, release gates, and shipping.
- Use `MUST`, `SHOULD`, and `MAY` in the specification so implementation and
    review decisions are unambiguous.
- Every public configuration option needs a TypeScript example and a default.
- Every public event needs its producer, payload, ordering, and visibility
    documented.
- Code examples must either be executable in tests or be explicitly labelled
    as a proposed API example.
- Do not document behavior that is not implemented without marking it as
    planned, proposed, or future work.
- Update documentation, tests, and package exports in the same change as a
    public API addition.
- Do not include secrets, private prompts, hidden reasoning, or unredacted
    tool output in examples or telemetry documentation.

### Engineering

- Plan the public types before implementing orchestration.
- Reuse [ReActAgent](../ReAct.agent.ts), its plugin and memory hooks, and the
    existing tool and sandbox contracts where their semantics fit.
- Keep one writer per workspace. Parallel workers use isolated snapshots or
    return proposals for serialized application.
- A run is not complete without a change inventory and validation evidence.
- Add deterministic tests using fake models, sandboxes, HITL transports, and
    event collectors. Live provider tests are supplementary, not the acceptance
    gate.
- Treat worker routing, MCTS, MemRL scoring, replication, and dynamic group
    management as extensions until the basic lifecycle is stable.

## Status Legend

- `[ ]` planned
- `[>]` in progress
- `[x]` completed and reviewed
- `[!]` blocked or requiring a product decision

## Milestone 0: Align the Design Documents

Goal: create one shared vocabulary before writing runtime code.

- `[ ]` Review [Vision.md](./Vision.md) with the maintainers and confirm the
    difference between CodeAct and SupervisedCodeAct.
- `[ ]` Review [Specification.md](./Specification.md) and resolve every open
    decision marked as a product or implementation question.
- `[ ]` Confirm the public names for `CodeAct`, `SupervisedCodeAct`, worker,
    group, and group coordinator.
- `[ ]` Confirm the initial patch representation: unified diff, file changes,
    or both.
- `[ ]` Confirm the initial workspace policy: proposal mode, apply mode, and
    worker snapshot isolation.
- `[ ]` Confirm the initial validation policy and repair-attempt defaults.
- `[ ]` Record accepted decisions in the specification and remove stale
    alternatives.

Exit criteria: a reviewer can implement the first vertical slice without
guessing who owns a write, what a worker returns, or when a run is complete.

## Milestone 1: Build the Deterministic Test Harness

Goal: test orchestration without network calls or real model behavior.

- `[ ]` Add a fake model that returns scripted plans, tool calls, repairs, and
    final answers.
- `[ ]` Add an in-memory or temporary fixture workspace.
- `[ ]` Add a fake sandbox with deterministic command output, exit codes,
    timeouts, and cancellation.
- `[ ]` Add a fake HITL adapter supporting allow, deny, timeout, and acceptance.
- `[ ]` Add an event collector that records sequence, actor, task, group, and
    payload.
- `[ ]` Add fixtures for successful, failed, aborted, blocked, and conflicting
    runs.
- `[ ]` Make the harness reusable by both coding-agent patterns.

Exit criteria: the lifecycle tests are deterministic and do not require model
credentials, network access, or a developer-specific workspace.

## Milestone 2: Implement CodeAct

Goal: ship the smallest complete singular-agent coding workflow.

- `[ ]` Create the CodeAct module under `src/agent/code/codeact/`.
- `[ ]` Implement shared coding types for runs, plans, tasks, change sets,
    validation results, actors, and events.
- `[ ]` Implement the graph lifecycle: inspect, plan, propose, approval, apply,
    validate, repair, and conclude.
- `[ ]` Support `proposal`, `apply`, and `approval-required` write modes.
- `[ ]` Enforce workspace root, allowed paths, path traversal protection, and
    one-writer semantics.
- `[ ]` Integrate configured tools, multiple MCP tools, skills, plugins,
    memory hooks, AST/LSP adapters, and the selected sandbox.
- `[ ]` Emit coding events with run and actor attribution.
- `[ ]` Return changed files, diff or patch data, validation evidence, status,
    and unresolved risks.
- `[ ]` Add unit tests for successful changes, denied changes, failed
    validation, repair, repair exhaustion, abort, and event ordering.
- `[ ]` Export the public API from `src/agent/index.ts` and add the package
    export in `package.json`.
- `[ ]` Add [CodeAct documentation](../../../documentation/CodeAct.md) with
    an executable or tested configuration example.
- `[ ]` Update the documentation index and package README where the public API
    is introduced.

Exit criteria: a fake-model test can apply a small change, run validation, and
return a complete evidence-based result without any worker delegation.

## Milestone 3: Ship the First CodeAct Release

Goal: release CodeAct as an explicitly experimental but usable API.

- `[ ]` Decide whether the release is `0.1.0-alpha.1` or another pre-release
    version based on API stability.
- `[ ]` Run `npm run build`.
- `[ ]` Run `npm test -- --run`.
- `[ ]` Run focused CodeAct tests and inspect the generated declaration files.
- `[ ]` Run `npm pack --dry-run` and verify that the CodeAct files and types are
    included.
- `[ ]` Review security behavior for commands, paths, network access, and
    secrets.
- `[ ]` Update release notes with API changes, limitations, and test evidence.
- `[ ]` Merge the focused pull request into `main` only after the checks pass.
- `[ ]` Create the release tag from the merged `main` commit.
- `[ ]` Publish the package using the instructions in
    [PUBLISHING.md](../../../PUBLISHING.md).
- `[ ]` Verify the published package can be installed and imported from a clean
    temporary project.

## Milestone 4: Implement SupervisedCodeAct

Goal: add supervised delegation while preserving the CodeAct contracts.

- `[ ]` Create the SupervisedCodeAct module under
    `src/agent/code/supervised-codeact/`.
- `[ ]` Implement supervisor planning and task dependency tracking.
- `[ ]` Implement static worker registration with `worker` and
    `coordinator-of-group` subroles.
- `[ ]` Implement worker responsibilities, allowed paths, tool capabilities,
    and per-worker system prompts.
- `[ ]` Implement group creation policy and bounded maximum delegation cycles.
- `[ ]` Implement groups without a coordinator.
- `[ ]` Implement groups with a coordinator that only aggregates results.
- `[ ]` Implement the optional participating coordinator as a separate,
    reviewable actor.
- `[ ]` Implement communication enablement and privacy levels:
    `all`, `private`, `private-with-coordinator`, and
    `private-with-coordinator-and-supervisor`.
- `[ ]` Implement parallel group limits using isolated worker snapshots.
- `[ ]` Implement serialized proposal review and change application.
- `[ ]` Reject or repair conflicting changes rather than silently overwriting
    files.
- `[ ]` Add worker, coordinator, supervisor, group, change, and validation
    events.
- `[ ]` Add deterministic tests for serial delegation, independent parallel
    groups, coordinator participation, privacy routing, failed workers,
    reassignment, repair cycles, conflict handling, and abort.
- `[ ]` Add [SupervisedCodeAct documentation](../../../documentation/SupervisedCodeAct.md)
    with group configuration examples.

Exit criteria: two independent read or implementation tasks can be delegated,
reviewed, and combined without concurrent writes to the target workspace.

## Milestone 5: Ship SupervisedCodeAct Incrementally

Goal: release supervised execution without hiding experimental behavior.

- `[ ]` Publish an alpha version such as `0.2.0-alpha.1` after the first
    supervised vertical slice.
- `[ ]` Run build, focused tests, full tests, package dry-run, and clean-project
    import verification.
- `[ ]` Document known limitations: static workers, snapshot requirements,
    unsupported dynamic groups, and conflict behavior.
- `[ ]` Merge the release pull request into `main` with the evidence attached.
- `[ ]` Tag and publish only from the merged `main` commit.
- `[ ]` Promote to a stable minor release only after the acceptance suite has
    passed across supported Node.js versions.

## Milestone 6: Add Coding Memory

Goal: make coding memory useful without coupling the agent to one storage
provider.

- `[ ]` Define records for code concepts, symbols, project relations,
    conventions, accepted decisions, validation failures, and repair outcomes.
- `[ ]` Include project identity, revision, scope, source, timestamp, and
    confidence in every persistent record.
- `[ ]` Separate per-run working memory, group memory, and persistent project
    memory.
- `[ ]` Define deterministic fetch and update hooks based on the existing
    ReActAgent memory schemas.
- `[ ]` Support mixed memory from files, deterministic stores, databases, and
    retrieval stores.
- `[ ]` Add memory failure events that do not hide the coding result.
- `[ ]` Add tests for retrieval, update, stale records, isolation, and provider
    failure.
- `[ ]` Document the feature in [Memory.md](../../../documentation/Memory.md),
    the memory overview, and a dedicated coding-memory guide when that folder is
    created.

Exit criteria: memory improves context but a memory outage does not corrupt a
workspace change or make the final result unverifiable.

## Milestone 7: Complete Capability Integrations

- `[ ]` Define the AST adapter contract and ship one tested provider.
- `[ ]` Define the LSP adapter contract and ship diagnostics plus symbol lookup
    for one language.
- `[ ]` Add command allowlists, timeout, output, environment, and network
    policies to the sandbox configuration.
- `[ ]` Add abort propagation to long-running command execution.
- `[ ]` Define default sandbox precedence and language-specific overrides.
- `[ ]` Add autopilot HITL rules and make their decisions auditable.
- `[ ]` Add plugin stages for change proposal, application, validation, worker,
    and group lifecycle events.
- `[ ]` Verify parallel tool execution is only enabled for declared
    side-effect-safe tools.

## Milestone 8: Add Telemetry and Quality Measurement

- `[ ]` Emit stable event names and a monotonic sequence per run.
- `[ ]` Add duration, token, validation, retry, and worker outcome metrics.
- `[ ]` Redact secrets, private messages, file contents, and hidden reasoning.
- `[ ]` Add correlation IDs for runs, tasks, groups, approvals, tools, and
    changes.
- `[ ]` Define a telemetry adapter so the core package does not require one
    vendor.
- `[ ]` Measure worker and coordinator outcomes before enabling learned routing.
- `[ ]` Add a `WorkerEvaluator` interface for future MemRL-style scores.
- `[ ]` Add a `WorkerSelector` interface for future MCTS-based exploration and
    exploitation.

## Milestone 9: Extract `@ravenlens/raven-adk/codepack`

Goal: keep core RavenADK orchestration independent from coding-specific tools
and providers.

- `[ ]` Decide which coding contracts stay in the core package and which move
    to `@ravenlens/raven-adk/codepack`.
- `[ ]` Create the package with its own `package.json`, build, test, and export
    map.
- `[ ]` Move optional AST, LSP, repository, patch, and provider integrations
    into the package.
- `[ ]` Keep the core CodeAct and SupervisedCodeAct orchestration usable with
    user-provided tools and sandboxes.
- `[ ]` Add installation and compatibility documentation.
- `[ ]` Test the package against the supported core package version.
- `[ ]` Publish the codepack only after the core public contracts are stable.

## Release and Versioning Checklist

Run this checklist for every granular release. Do not publish from an
unreviewed working tree.

- `[ ]` Classify the change:
    - Patch: documentation, tests, and backward-compatible bug fixes.
    - Minor: a new backward-compatible public capability.
    - Major: a breaking public contract after the package reaches `1.0.0`.
    - Pre-release: incomplete or experimental API such as
        `0.1.0-alpha.1`.
- `[ ]` Update package version with an explicit version, for example:
    `npm version 0.1.0-alpha.1 --no-git-tag-version`.
- `[ ]` Review the package version diff and update release notes.
- `[ ]` Run `npm run build`.
- `[ ]` Run `npm test -- --run`.
- `[ ]` Run focused tests for the changed pattern.
- `[ ]` Run `npm pack --dry-run` and inspect the tarball contents.
- `[ ]` Install the tarball in a clean temporary project and import every new
    public entry point.
- `[ ]` Open and merge the pull request into `main`.
- `[ ]` Pull the merged `main` branch and verify the release commit.
- `[ ]` Create the version tag from that commit.
- `[ ]` Publish to npm with the registry and access settings in
    [PUBLISHING.md](../../../PUBLISHING.md).
- `[ ]` Verify the published version with `npm view @ravenlens/raven-adk
    version` and a clean install.
- `[ ]` Record the published version, commit, tag, test commands, and known
    limitations in the release notes.

## Definition of Done

A coding-agent milestone is complete only when:

- The implementation matches [Specification.md](./Specification.md). and [Vision](./Vision.md)
- Public types, exports, examples, and documentation agree.
- Deterministic tests cover success, failure, retry, abort, approval, and
    workspace safety for the changed behavior.
- `npm run build`, `npm test -- --run`, and focused tests pass.
- The package dry-run contains the intended files and declaration output.
- The change has been reviewed and merged into `main`.
- The version and release notes identify the shipped behavior and limitations.
