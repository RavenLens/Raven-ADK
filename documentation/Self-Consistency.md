# Self-Consistency

Self-consistency is a reliability pattern: generate several independent answers
to the same request, compare them, and return an answer only when the evidence
for doing so is strong enough. It is not a guarantee of truth. If every run
shares the same prompt, model, retrieval mistake, or misleading source, the
answers can agree and still be wrong.

RavenADK does not currently ship a `SelfConsistency` class. The pattern can be
implemented by composing the existing `MultipleAnswers`, `AgenticEvaluator`
(`AEval`), `FactChecker`, and `TreeOfThoughts` (`ToT`) APIs. Starting with this
composition keeps the policy visible and avoids committing to an API before
consensus, confidence, and abstention semantics are stable.

## Implement Self-Consistency by combining existing constructs

The implementation is an application-level policy built from existing
constructs:

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

`MultipleAnswers` does not decide what consensus means. Its constructor accepts
`AgentModel`, `ReActAgent`, or function runners. `invoke` returns results as
`[runId, result][]`; `evaluate` processes those results sequentially and
returns `{ id, evaluation, result }` records without sorting them; `getBest`
invokes, evaluates, sorts by descending score, and returns the first record.
The examples below add the normalization, quality, verification, and
abstention policy around those primitives.

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

## Future module boundary

After several applications reveal a stable policy, RavenADK could add a
`SelfConsistency` module. Its responsibilities should be limited to candidate
orchestration, normalization/clustering hooks, consensus and confidence
calculation, traceable result reporting, and abstention. It should compose—not
duplicate—AEval, FactChecker, ToT, model providers, or human-in-the-loop
controls.
