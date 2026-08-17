# Self-Consistency

Self-consistency is a reliability pattern: generate several independent answers
to the same request, compare them, and return an answer only when the evidence
for doing so is strong enough. It is not a guarantee of truth. If every run
shares the same prompt, model, retrieval mistake, or misleading source, the
answers can agree and still be wrong.

RavenADK ships a `SelfConsistency` class as a reusable policy layer around
`MultipleAnswers`. It can also compose the existing `AgenticEvaluator`
(`AEval`), `FactChecker`, and `TreeOfThoughts` (`ToT`) APIs. The class keeps
normalization, clustering, agreement measurement, and abstention consistent
across product modules without duplicating that decision logic in every
caller.

## Implement Self-Consistency with `SelfConsistency`

`SelfConsistency` class is a decision
layer around `MultipleAnswers`: `MultipleAnswers` runs the candidates, while
`SelfConsistency` extracts their answers, normalizes them, groups equivalent
answers into clusters, measures agreement, and decides whether to accept or
abstain.

The class does not claim that agreement proves truth. It answers a narrower
question: **do enough independent candidates support the same normalized
answer to satisfy this application's policy?** Use `FactChecker`, AEval, or
human review when the decision also needs evidence or quality verification.

### Constructor and options

Create one instance with a `MultipleAnswers` runner and the policy for turning
raw runner results into comparable answers:

```typescript
import {
  MultipleAnswers,
  OpenAI,
  SelfConsistency,
  type MessagesVariations
} from "@ravenlens/raven-adk";

const consistency = new SelfConsistency<string>({
  candidates: new MultipleAnswers([
    new OpenAI({ model: "gpt-5-mini" }),
    new OpenAI({ model: "gpt-5-mini" }),
    new OpenAI({ model: "gpt-5-mini" })
  ]),
  minAgreement: 2 / 3,
  minCandidates: 2
});
```

The class accepts two generic parameters:

```typescript
new SelfConsistency<Answer, Result>(options)
```

`Answer` is the value returned by `extract`, stored in each candidate's
`answer`, and returned as `result.answer` when a cluster is accepted. `Result`
is the raw value returned by each candidate runner. It is passed to `extract`
and stored in `candidate.result` and `invalidCandidates[].result`.

The generic parameters are ordered as `Answer, Result`:

```typescript
type CandidateResult = {
  messages: MessagesVariations[];
};

const consistency = new SelfConsistency<string, CandidateResult>({
  candidates: typedCandidates, // MultipleAnswers<CandidateResult>
  extract: result => result.messages.at(-1)?.content ?? ""
});
```

`Answer` and `Result` both default to `any` for compatibility with untyped
runners. If `candidates` is a typed `MultipleAnswers<Result>`, TypeScript can
usually infer `Result`; an explicitly typed `extract` function can also make
the answer type clear. Specify both parameters when you want the extractor,
candidate records, events, and returned result to be checked against concrete
types. If only `Answer` is supplied, the second parameter still defaults to
`any`, for example `new SelfConsistency<string>(options)`.

The constructor options are:

| Option | What it does | Default | When to customize it |
| --- | --- | --- | --- |
| `candidates` | Supplies the models, agents, or custom function runners that generate answers. | Required | Always. Use independent models, prompts, retrieval paths, or sampling settings when independence matters. |
| `extract(result)` | Converts one raw runner result into the answer to compare. The default reads the last `messages` or `answer` item, then uses `structuredOutput` or `content`. | Built-in extraction | Use it for structured output, nested API results, claims, labels, or domain-specific fields. |
| `normalize(answer)` | Converts an answer into the string used as its cluster key. | Trim/lowercase/compress whitespace for strings; stable JSON for objects | Use it for aliases, number formats, dates, units, case-insensitive labels, or canonical JSON. |
| `weight(candidate)` | Gives a valid candidate more or less influence in its cluster. | `1` | Use calibrated model reliability or source quality. Do not use it to hide disagreement without documenting the policy. |
| `minAgreement` | Minimum winning-cluster weight divided by total valid-candidate weight required for acceptance. | `2 / 3` | Raise it for high-risk decisions; lower it only when abstention is more costly and the risk is understood. |
| `minCandidates` | Minimum number of valid candidates required before a decision can be accepted. | `2` | Increase it when one or two answers are not enough evidence. |

`minAgreement` must be between `0` and `1`. `minCandidates` must be a positive
integer. A candidate is counted only after extraction, normalization, and
weight validation succeed.

### `invoke(options)`

`invoke` is the main execution method. It:

1. Calls `MultipleAnswers.invoke(options)` with the supplied `messages` and
   optional `abort` signal.
2. Extracts and normalizes every returned answer.
3. Calculates each candidate's weight.
4. Groups candidates with the same normalized value into clusters.
5. Sorts clusters by descending total weight.
6. Returns an accepted answer or an abstention result.

Use `invoke` when you want to treat self-consistency as an executable runner or
when the method name fits an existing invocation pipeline:

```typescript
const result = await consistency.invoke({
  messages: [
    { type: "user", content: "Which support queue should handle this ticket?" }
  ]
});

if (result.status === "accepted") {
  console.log("Route to:", result.answer);
  console.log("Agreement:", result.agreement);
} else {
  console.log("Send to human review:", result.reason);
}
```

`invoke` does not call `evaluate`, AEval, or `FactChecker` automatically. Run
those as an additional policy step when normalized agreement alone is not
enough.

### `check(options)`

`check` is a readable alias for `invoke`. It performs exactly the same work and
returns the same `SelfConsistencyResult` type. Prefer it in business code when
the operation reads as a reliability check:

```typescript
const decision = await consistency.check({
  messages: [
    { type: "user", content: "Which support queue should handle this ticket?" }
  ]
});

if (decision.status === "abstained") {
  // Do not route, publish, or automate the answer without another review step.
  console.log(decision.reason);
}
```

Use either method, not both for the same request. Calling both runs all
candidates twice.

### `onEvent(event, listener)`

`onEvent` registers listeners for the class-level lifecycle. It is useful for
audit logs, metrics, tracing, and human-review queues:

| Event | Listener argument | Meaning |
| --- | --- | --- |
| `start` | `InvokeOptions` | A consistency check is beginning. |
| `candidate` | Valid candidate record | One result was extracted, normalized, and weighted successfully. |
| `invalid_candidate` | Invalid candidate record | Extraction, normalization, or weight calculation failed for one result. |
| `end` | Final `SelfConsistencyResult` | The class accepted a winner or abstained. |

```typescript
consistency.onEvent("candidate", candidate => {
  console.log(candidate.id, candidate.normalizedAnswer, candidate.weight);
});

consistency.onEvent("invalid_candidate", candidate => {
  console.warn("Candidate excluded", candidate.id, candidate.error.message);
});

consistency.onEvent("end", result => {
  console.log(result.status, result.agreement, result.winner?.normalizedAnswer);
});
```

The class events describe the decision layer. Use `MultipleAnswers.onEvent`
when you also need runner-level `start_run` and `end_run` events.

### Results and clusters

Every result contains:

- `status`: either `"accepted"` or `"abstained"`;
- `answer`: the original answer from the first candidate in the winning
  cluster, or `undefined` when abstaining;
- `candidates`: all valid extracted candidates;
- `invalidCandidates`: results that could not be compared;
- `clusters`: all normalized-answer groups, sorted by descending weight;
- `winner`: the first cluster, even when it does not meet the threshold;
- `agreement`: the winning cluster's weighted share of all valid candidates;
- `reason`: the abstention reason when `status` is `"abstained"`.

A cluster is not a new model run. It is a group of candidate records whose
`normalizedAnswer` strings are equal. For example, with answers `"Paris"`,
`" paris "`, and `"London"`, the default normalizer produces two clusters:

```text
normalizedAnswer: "paris"   candidates: 2   weight: 2   agreement: 0.667
normalizedAnswer: "london"  candidates: 1   weight: 1   agreement: 0.333
```

With the default `minAgreement` of `2 / 3`, the result is accepted and returns
the original answer from the first `"paris"` candidate. With three different
answers, the winning cluster has agreement `1 / 3`, so the result abstains.
Weighted clusters use the same calculation with total weight instead of only
the candidate count.

The possible abstention reasons are:

- `NO_VALID_CANDIDATES`: every result failed extraction, normalization, or
  weight validation;
- `NOT_ENOUGH_CANDIDATES`: fewer valid candidates than `minCandidates` remain;
- `INSUFFICIENT_AGREEMENT`: a winning cluster exists, but its agreement is
  below `minAgreement`.

If a runner itself rejects while `MultipleAnswers.invoke()` is executing, that
rejection still propagates. `invalidCandidates` currently covers failures
after a runner has returned a result, not runner-level retries or partial
failure recovery.

### Custom extraction and normalization

Use custom functions when the answer is structured or equivalent values have
different textual representations:

```typescript
type TicketDecision = {
  queue: "billing" | "technical" | "account";
  urgency: "low" | "high";
};

type TicketResult = {
  decision: TicketDecision;
};

const consistency = new SelfConsistency<TicketDecision, TicketResult>({
  candidates,
  extract: result => result.decision,
  normalize: decision => `${decision.queue}:${decision.urgency}`,
  minAgreement: 0.75
});
```

For free-form prose, exact normalized equality is usually too strict. Either
extract a stable label or use AEval to rank the prose after candidate
generation. `SelfConsistency` deliberately does not pretend that two
different paragraphs are equivalent without a domain-specific comparison
function.

### When this class is beneficial

Use `SelfConsistency` when an automated action should happen only after several
independent candidate runs support the same decision:

| Business scenario | Why clusters help | Typical response to abstention |
| --- | --- | --- |
| Support ticket routing | Groups equivalent queue labels such as `billing` or `technical`; prevents one unusual answer from silently misrouting a ticket. | Send to a general queue or human triage. |
| Invoice and document extraction | Groups normalized values for totals, dates, currencies, or vendor IDs despite formatting differences. | Flag the document for verification before posting it to accounting. |
| Compliance and policy classification | Requires agreement before assigning a policy label or triggering a workflow. | Hold the case for compliance review. |
| Incident severity triage | Compares `low`, `medium`, and `high` severity decisions from independent responders or models. | Page an operator when the severity is disputed. |
| Eligibility and application pre-screening | Makes disagreement visible before a recommendation affects a customer. | Request missing information or require human approval. |
| Configuration and deployment planning | Clusters stable recommendations such as `rollout`, `rollback`, or `needs-review` while retaining every supporting run. | Stop automation and open an engineering review. |

The class is most valuable when the output is a canonical label, structured
decision, or otherwise normalizable value and when abstention has a defined
business path. It is less useful for one authoritative calculation, highly
creative writing, or candidates that all depend on the same unverified source.


----

## Implement Self-Consistency by combining existing constructs
\
Section contains instructions how to implement Self-Consistency concept in RavenADK without leveraging `SelfConsistency` class

1. Generate independent candidates with `MultipleAnswers`.
2. Pass the conversation as `invoke({ messages })`. The optional `abort` signal
   is forwarded to every model, agent, or custom function runner.
3. Keep the returned `[runId, result]` tuples so every decision is auditable.
4. Normalize candidates before comparing them. Exact matching is appropriate
   for labels and canonical values; prose usually needs a domain normalizer or
   an evaluator.
5. Measure agreement and define an abstention threshold.
6. Use `evaluate(sharedContext, evaluatorConfig)` when every candidate needs a
   score, verdict, reasoning, and metrics. Use `getBest` when only the highest
   AEval score is needed.
7. Use `FactChecker` for externally verifiable claims and `ToT` for difficult
   multi-step reasoning. ToT can be adapted as a custom function runner because
   it is not a `ParallelRun` accepted directly by `MultipleAnswers`.

`SelfConsistency` owns the consensus decision, while `MultipleAnswers` remains
the candidate runner. `MultipleAnswers` does not decide what consensus means.
Its constructor accepts
`AgentModel`, `ReActAgent`, or function runners. `invoke` returns results as
`[runId, result][]`; `evaluate` processes those results sequentially and
returns `{ id, evaluation, result }` records without sorting them; `getBest`
invokes, evaluates, sorts by descending score, and returns the first record.
The class adds typed candidate records, normalization, weighted clustering,
agreement thresholds, invalid-candidate tracking, and abstention around those
primitives. The examples below also show how to compose AEval, FactChecker, and
ToT when the decision needs quality or evidence checks.

### Use case 1: Consensus for canonical answers

**Usecases:** "factual question answering", "intent classification", "policy
routing", "multiple-choice decisions".

When the answer can be represented by a stable label or canonical value, use
`MultipleAnswers` for parallel generation and count normalized values. Preserve
the run ID and original result with every vote so the decision can be reviewed.

```typescript
import { Anthropic, MultipleAnswers, OpenAI } from "@ravenlens/raven-adk";

const messages = [
  { type: "user", content: "What is the capital of France? Return only the city name." }
];

const candidates = new MultipleAnswers([
  new OpenAI({ model: "gpt-5-mini" }),
  new Anthropic({ model: "claude-4-8-sonnet-latest" }),
  new OpenAI({ model: "gpt-5-mini" })
]);

candidates.onEvent("start_run", id => console.log("started", id));
candidates.onEvent("end_run", (id, output) => console.log("finished", id));

const results = await candidates.invoke({ messages });

const answerFromResult = (result: any): string => String(
  result?.messages?.at(-1)?.content
    ?? result?.answer?.at(-1)?.content
    ?? ""
).trim().toLowerCase();

type Candidate = {
  id: string;
  result: any;
  answer: string;
};

const normalized: Candidate[] = results.map(([id, result]) => ({
  id,
  result,
  answer: answerFromResult(result)
}));

const votes = new Map<string, Candidate[]>();
for (const candidate of normalized) {
  const supporters = votes.get(candidate.answer) ?? [];
  supporters.push(candidate);
  votes.set(candidate.answer, supporters);
}

const topVote = [...votes.entries()]
  .sort((left, right) => right[1].length - left[1].length)[0];
const agreement = topVote ? topVote[1].length / normalized.length : 0;

const decision = topVote && agreement >= 2 / 3
  ? {
    answer: topVote[0],
    agreement,
    runIds: topVote[1].map(candidate => candidate.id)
  }
  : {
    answer: null,
    agreement,
    reason: "Abstain because the candidates do not agree strongly enough."
  };

console.log(decision);
```

Repeating an identical deterministic call contributes little independent
evidence. For stronger consistency, vary models, prompts, retrieval order, or
sampling settings while keeping the task and acceptance criteria equivalent.

### Use case 2: Rank open-ended answers with AEval

**Usecases:** "technical explanations", "document summaries", "code review
suggestions", "customer support drafts".

> **`AEval`** is used under the hood of the `evaluate` method

For prose, exact string voting is too strict. Run all candidates first, then
call `evaluate` with a dedicated evaluator configuration. The evaluator receives
the shared context plus each candidate's final AI message. It returns one
evaluation per result in runner order, so the application can apply its own
quality threshold instead of blindly selecting a majority.

```typescript
import { Anthropic, MultipleAnswers, OpenAI, ReActAgent } from "@ravenlens/raven-adk";

const sharedContext = [
  { type: "user", content: "Explain why the sky appears blue in three concise paragraphs." }
];

const specialist = new ReActAgent({
  model: new OpenAI({ model: "gpt-5-mini" }),
  systemPrompt: "Answer with accurate, accessible science.",
  messages: [],
  tools: [],
  withConclusion: false
});

const candidates = new MultipleAnswers([
  new OpenAI({ model: "gpt-5-mini" }),
  new Anthropic({ model: "claude-4-8-sonnet-latest" }),
  specialist
]);

await candidates.invoke({ messages: sharedContext });

const evaluations = await candidates.evaluate(sharedContext, {
  model: new OpenAI({ model: "gpt-5-mini" }),
  systemPrompt: [
    "Evaluate each answer for scientific accuracy, relevance, and clarity.",
    "Give a score from 0 to 1 and reject answers containing factual errors."
  ].join("\n"),
  tools: []
});

const ranked = [...evaluations].sort(
  (left, right) => right.evaluation.result.score - left.evaluation.result.score
);
const accepted = ranked.find(({ evaluation }) =>
  evaluation.result.score >= 0.8 && evaluation.result.verdict !== "REJECTED"
);

const selected = accepted
  ? {
    answer: accepted.result.messages?.at(-1)?.content
      ?? accepted.result.answer?.at(-1)?.content,
    evaluation: accepted.evaluation.result,
    runId: accepted.id
  }
  : null;

console.log(selected ?? "Abstain because no answer met the quality threshold.");
```

Use `getBest(sharedContext, evaluatorConfig)` instead when the application only
needs the single highest-scoring record. `getBest` runs `invoke` itself, so do
not call it after the preceding `invoke` unless running the candidate generation
again is intentional.

### Use case 3: Verify a selected answer with FactChecker

**Usecases:** "news summaries", "legal or policy claims", "compliance checks",
"medical information that requires source verification".

AEval ranks an answer against the request; it does not make the answer's facts
true by itself. After selecting a candidate, pass its text to `FactChecker` and
provide one or more `FactSentry` verifiers backed by a database, search system,
RAG store, or another trusted source. The current public field name
`baseOnRecource` is intentionally preserved in this example because it is part
of the FactChecker API.

```typescript
import { FactChecker, type FactSentry } from "@ravenlens/raven-adk";

const selectedAnswer = "The capital of France is Paris.";

const trustedKnowledgeBase: FactSentry = async fact => {
  const truthy = /\bParis\b/i.test(fact);

  return {
    from: 0,
    to: fact.length,
    truthy,
    baseOnRecource: "The capital of France is Paris."
  };
};

const checker = new FactChecker({
  toCheck: selectedAnswer,
  verifiers: trustedKnowledgeBase
});

const ratings = await checker.check();
const correctedAnswer = await checker.improve(ratings);
const supported = ratings.length > 0 && ratings.every(rating => rating.truthy);

const decision = supported
  ? { answer: correctedAnswer, verified: true }
  : { answer: null, verified: false, reason: "The selected answer was not verified." };

console.log(decision);
```

When independent verifiers disagree over overlapping ranges, configure
`FactChecker.judge` with an `AgentModel` and optional tools. Without a judge,
`check()` fails closed instead of applying an arbitrary correction. For a
high-risk workflow, run FactChecker for every candidate before applying the
consensus or AEval threshold.

### Use case 4: Add a Tree-of-Thoughts candidate

**Usecases:** "multi-step mathematics", "architecture trade-offs", "planning",
"constraint-heavy decisions".

`TreeOfThoughts` explores and evaluates intermediate options, while
`MultipleAnswers` compares final candidates. Because `TreeOfThoughts` is not a
direct `ParallelRun`, wrap it in a custom function runner and convert its
`theBestOption.content` into the message shape consumed by `MultipleAnswers`.

```typescript
import {
  BFSToT,
  MultipleAnswers,
  OpenAI,
  TreeOfThoughts
} from "@ravenlens/raven-adk";

const sharedContext = [
  { type: "user", content: "Find the most reliable architecture for this constraint-heavy system." }
];

const reasoningModel = new OpenAI({ model: "gpt-5-mini" });

const treeOfThoughtsRunner = async ({ messages, abort }: {
  messages: typeof sharedContext;
  abort?: AbortSignal;
}) => {
  if (abort?.aborted) {
    return { messages };
  }

  const query = String(messages.at(-1)?.content ?? "");
  const search = new TreeOfThoughts({
    query,
    initialOptionsCount: 3,
    thoughtsCount: 3,
    maxThoughtsDepth: 3,
    graphSearchAlgorithm: new BFSToT({ topK: 1 }),
    optionGenerator: reasoningModel,
    thoughtGenerator: reasoningModel,
    evaluator: reasoningModel
  });

  const result = await search.invoke();

  return {
    messages: [
      ...messages,
      { type: "ai", content: result.theBestOption.content }
    ]
  };
};

const candidates = new MultipleAnswers([
  new OpenAI({ model: "gpt-5-mini" }),
  treeOfThoughtsRunner
]);

const results = await candidates.invoke({ messages: sharedContext });
```

The adapter checks `abort` before starting the search, but the current
`TreeOfThoughts.invoke()` API does not accept an abort signal. Add cancellation
inside the custom runner or use an abort-aware generator when the application
needs to stop an in-progress ToT search.

### Select, abstain, and keep an audit trail

Useful selection policies include:

- **Majority vote:** choose the largest normalized cluster for canonical values.
- **Weighted vote:** weight candidates by model quality, source reliability, or
  calibrated historical performance.
- **Evaluator ranking:** use AEval to score each candidate and select the best
  supported answer.
- **Verified selection:** require both an evaluator threshold and FactChecker
  support before returning an answer.
- **Abstention:** return no answer when agreement, evidence, or quality is below
  the required threshold.

Keep the original result, generated run ID, normalized candidate, cluster or
vote, evaluator output, verification ratings, threshold decisions, latency,
and cost. Consensus is about agreement between candidates; AEval is a judge of
quality; FactChecker is evidence verification. They are complementary, and a
majority answer can still be wrong.

## FactChecker for factual claims

Use `FactChecker` when candidates make claims that can be checked against
external evidence. Supply independent `FactSentry` verifiers and configure its
judge when overlapping verifier results conflict. Browsing, RAG, databases, and
other tools can provide the evidence. FactChecker is evidence verification,
not a general answer-consensus algorithm.

## ToT for difficult reasoning

Use ToT when one task needs deliberate exploration of multiple intermediate
reasoning paths. ToT evaluates and prunes thoughts, can backtrack, and selects
an option. Self-consistency compares independent final answers. They can be
combined by running ToT as one candidate generator and comparing its final
answer with independent agents, or by applying self-consistency to several ToT
runs. This is more expensive and should be reserved for tasks where reasoning
quality justifies the additional calls.

## Structured outputs

Prefer a schema with fields such as:

- `answer`: canonical value or final response;
- `claims`: independently checkable statements;
- `sources`: evidence identifiers or citations;
- `confidence`: the model's own estimate, retained as metadata only;
- `reasoning_summary`: a short explanation suitable for evaluation.

Compare `answer` and `claims`, not arbitrary formatting or hidden chain of
thought. Never require models to expose private chain-of-thought; store concise
decision summaries instead.

## Configuration and operations

Choose the sample count based on the task's risk, latency budget, and cost.
Start small, then increase it only when validation shows that agreement improves
accuracy. Use model or prompt diversity to reduce correlated errors, but keep
the task and acceptance criteria identical. Set provider temperature and other
sampling controls deliberately, and bound parallelism, retries, and timeouts.

Record:

- request and configuration identifiers;
- candidate run IDs and model/provider metadata;
- normalized candidates and cluster membership;
- evaluator scores, verdicts, reasoning summaries, and evidence;
- agreement, threshold decisions, abstentions, latency, retries, and cost.

Use events such as `start_run`, `end_run`, `evaluate_start`, and `evaluate_end`
to update monitoring without losing candidate traceability. Redact sensitive
prompt or answer content according to the application's data policy.

Measure the system on a labeled test set using accuracy, agreement rate,
abstention rate, calibration, evaluator quality, latency, token usage, and
cost. Agreement rate alone is not a success metric: a confidently consistent
wrong answer is a failure.

## When not to use it

Self-consistency may be a poor fit when one authoritative deterministic
calculation is available, latency or cost is extremely constrained, answers are
highly creative and have no single target, or all candidates depend on the same
unverified source. For high-impact decisions, use authoritative verification
and human review rather than consensus alone.

## Module boundary

`SelfConsistency` is responsible for candidate orchestration around a
reliability decision, normalization/clustering hooks, agreement calculation,
traceable result reporting, and abstention. It should compose, not duplicate,
AEval, FactChecker, ToT, model providers, or human-in-the-loop controls.
