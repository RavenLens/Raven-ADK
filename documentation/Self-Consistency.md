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

## Workflow

1. Define the task and the acceptance criteria.
2. Generate independent candidates with `MultipleAnswers`.
3. Require a structured output when answers must be compared reliably.
4. Normalize candidates (for example, trim whitespace, canonicalize JSON, or
   extract a chosen label) and cluster semantically equivalent answers.
5. Measure agreement within the clusters.
6. Use AEval to score correctness, relevance, and completeness.
7. Use `FactChecker` when the answer contains externally verifiable claims.
8. Select a result only if its consensus and quality meet configured
   thresholds; otherwise abstain or request human review.

Consensus is about agreement between independent candidates. AEval ranking is
about quality according to a judge. They are complementary: a majority answer
can be wrong, while a well-supported minority answer can be correct.

## Generate candidates

`MultipleAnswers` runs models, agents, or functions in parallel and preserves a
run ID for every result:

```typescript
import { MultipleAnswers, OpenAI } from "@ravenlens/raven-adk";

const candidates = new MultipleAnswers([
  new OpenAI({ model: "gpt-5-mini" }),
  new OpenAI({ model: "gpt-5-mini" }),
  new OpenAI({ model: "gpt-5-mini" })
]);

candidates.onEvent("start_run", id => console.log("started", id));
candidates.onEvent("end_run", (id, output) => console.log("finished", id));

const results = await candidates.invoke();
```

For real independence, vary models, prompts, retrieval order, or sampling
settings where the provider supports them. Repeating an identical deterministic
call is useful for measuring infrastructure stability, but contributes little
independent evidence.

## Compare and select answers

For categorical or structured answers, normalize before counting:

```typescript
type Candidate = { id: string; answer: string; result: unknown };

const normalized = results.map(([id, result]) => ({
  id,
  result,
  answer: String(result?.answer?.at(-1)?.content ?? result?.messages?.at(-1)?.content ?? "")
    .trim()
    .toLowerCase()
}));

const counts = new Map<string, number>();
for (const candidate of normalized) {
  counts.set(candidate.answer, (counts.get(candidate.answer) ?? 0) + 1);
}

const consensus = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
const agreement = consensus ? consensus[1] / normalized.length : 0;
const shouldAbstain = !consensus || agreement < 0.67;
```

Exact string matching is appropriate only for canonical labels or structured
values. For prose, use a domain-specific normalizer, embeddings, or an
evaluator to decide whether two answers mean the same thing. Keep the original
candidate and run ID alongside every normalized value so the decision remains
auditable.

Useful selection strategies include:

- **Majority vote:** choose the largest semantic cluster.
- **Weighted vote:** weight candidates by model quality, source reliability, or
  a calibrated historical score.
- **Evaluator ranking:** use AEval to score each candidate and select the best
  supported answer.
- **Judge-based resolution:** ask an evaluator to compare only the strongest
  candidates when clusters disagree.
- **Abstention:** return no answer when agreement, evidence, or evaluator score
  is below the required threshold.

## AEval for quality and disagreement

`AgenticEvaluator` returns a score, verdict, reasoning, metrics, and improvement
points. It can use tools, so it is suitable for comparing candidate answers
against the original request:

```typescript
import { AgenticEvaluator, OpenAI } from "@ravenlens/raven-adk";

const evaluation = await new AgenticEvaluator(
  [
    { type: "user", content: "Give the capital of France." },
    { type: "ai", content: "Paris." }
  ],
  {
    model: new OpenAI({ model: "gpt-5-mini" }),
    systemPrompt: "Score factual accuracy and relevance. Prefer supported answers.",
    tools: []
  }
).evaluate();

console.log(evaluation.result.score, evaluation.result.reasoning);
```

Evaluate each candidate when quality matters more than simple agreement. For
cost control, cluster first and evaluate one representative per cluster, then
use AEval as a judge only for close or conflicting results. Do not treat an
LLM-generated score as ground truth without calibrating it against labeled
examples.

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
