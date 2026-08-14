# Self-Consistency

## Reason to ship as a separate class

1. **Cleaner client code:** Clients should be able to configure a reliability
    policy once and reuse it without rebuilding candidate extraction,
    normalization, voting, abstention, verification, and audit logic in every
    product module.
2. **A policy boundary:** `MultipleAnswers` should remain responsible for
    running independent runners. `SelfConsistency` should decide what the
    returned candidates mean, when they agree, and whether the library should
    return an answer at all.
3. **A stable result contract:** The class can return a typed decision with
    candidate records, agreement metrics, verification status, and an explicit
    abstention reason instead of making each client interpret `[runId, result]`
    tuples and untyped messages.

## Purposes

A `SelfConsistency` class is justified when it provides reliability behavior
that cannot be expressed cleanly by calling `MultipleAnswers.invoke()` and
writing another local loop. The following are potential purposes, ordered from
the core value of the abstraction to advanced execution features.

### Core purposes

1. **Provide one complete decision workflow.** Coordinate candidate generation,
    extraction, normalization, comparison, optional evaluation, verification,
    and final decision-making behind one reusable operation. The client should
    not have to manually connect the output of `invoke()` to `evaluate()`, then
    sort, filter, verify, and construct an abstention response.
2. **Define a typed candidate record.** Preserve the run ID, raw runner result,
    extracted answer, normalized value, status, model metadata, evaluation, and
    verification evidence in one record. This solves the current problem that
    each application must repeatedly interpret `any` results and message shapes.
3. **Make answer extraction and normalization first-class hooks.** Support
    typed structured output, message content, JSON fields, labels, numbers, and
    domain-specific canonicalization through injected functions such as
    `extract()` and `normalize()`. The class should compare answers, not arbitrary
    formatting differences.
4. **Support interchangeable consensus strategies.** Provide policy strategies
    such as majority vote, weighted vote, rank aggregation, exact equality,
    domain equivalence, and semantic clustering. `MultipleAnswers` currently
    returns all results but has no concept of a cluster, winner, tie, or
    equivalent answer.
5. **Calculate agreement and confidence from the candidate set.** Report
    support size, agreement ratio, winning margin, disagreement, cluster count,
    and other deterministic metrics. A model's self-reported confidence should
    remain metadata, not become the consensus decision by itself.
6. **Make abstention an explicit outcome.** Apply configurable rules for
    insufficient support, ties, low evaluator scores, contradictory claims,
    failed verification, invalid output, or budget exhaustion. Return a typed
    abstention reason and the evidence behind it instead of forcing the client
    to treat the first or highest-scoring answer as correct.
7. **Compose quality and evidence gates.** Allow AEval, `FactChecker`, schema
    validation, custom validators, or human review to participate in a common
    pipeline. The class should correlate each score and evidence result with
    the candidate that produced it, while delegating the actual evaluation or
    fact checking to those existing abstractions.
8. **Explain disagreement and preserve minority evidence.** Return clusters,
    outliers, conflicting values, and the candidates that support each value.
    This makes the result diagnosable and prevents a majority vote from hiding
    a meaningful minority or a systematic failure.

### Capabilities difficult or impossible to provide with the current application-level composition

9. **Adaptive sampling and early stopping.** Continue sampling while the
    decision is uncertain, or stop when a configured consensus threshold is
    mathematically satisfied. The current `MultipleAnswers.invoke()` starts
    every runner and waits for `Promise.all()`, so a client-side loop cannot
    reclaim the unfinished work or make scheduling part of the policy.
10. **Partial-failure handling.** Represent successful, failed, timed-out,
     cancelled, and invalid candidates separately, with configurable retry and
     quorum rules. Today one rejected runner can reject the whole `Promise.all()`
     operation, leaving the application to recreate execution bookkeeping.
11. **Diversity and independence enforcement.** Describe candidate sources and
     detect accidental duplicates in model, prompt, sampling, retrieval, or
     tool configuration. The class can require meaningful diversity or report
     that apparent agreement came from correlated runs.
12. **Budget-aware scheduling.** Enforce maximum parallelism, latency, token,
     and cost budgets while selecting which candidates to run next. This needs a
     scheduler with candidate metadata, not only a static array of runners.
13. **Coordinated cancellation.** Cancel remaining generation, evaluation, and
     verification work as soon as the decision is final or the caller aborts.
     The current abort signal is forwarded to runners, but `MultipleAnswers`
     does not own a decision-aware controller or cancellation lifecycle.
14. **A decision-level event and trace model.** Emit events for candidate
     accepted/rejected, normalization, cluster formation, quorum reached,
     abstention, verification, and final decision, with one correlation ID for
     the whole operation. Run-level events alone do not expose this policy
     lifecycle.
15. **Reproducible audit and replay.** Store the policy version, candidate
     configuration, normalization version, thresholds, evaluator output,
     evidence, timing, cost, and final decision so a result can be inspected or
     replayed later. Keeping the raw result and run ID is necessary but not
     sufficient for a decision audit.

## Recommended boundary

`SelfConsistency` should own the decision policy and orchestration around that
policy. It should delegate candidate execution to `MultipleAnswers`, quality
judgment to `AgenticEvaluator`, evidence checks to `FactChecker`, and difficult
search to `TreeOfThoughts`. It should expose hooks for extraction,
normalization, equivalence, consensus, validation, verification, and
abstention rather than hard-coding one domain's definition of truth.

It should not become a second `MultipleAnswers`, promise truth merely because
answers agree, require hidden chain-of-thought, or duplicate AEval, FactChecker,
ToT, model providers, or human-in-the-loop implementations. The separate
class earns its place by making the reliability decision observable, typed,
configurable, and resource-aware.
