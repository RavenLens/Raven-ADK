# Multiple Answers
Multiple Answers runs multiple models, agents, or custom runners in parallel, evaluates their responses, and selects the best outcome for a task.

## Features
- Run multiple LLMs in parallel
- Run multiple Agents in parallel
- Get answers of all tasks
- Pick the best answer using `AgenticEvaluator` (`AEval`)
- Monitor ongoing progress of each runner with usage of its ids
    - Retrive id
    - Monitor
- Evaluate outcomes with separate modules like: `HallucinationsDetector` or `AEval` (Evaluations of parallel runs are executed sequentially to ensure stability)

### Basic Usage

```typescript
const messages = [
    { type: "user", content: "What is the capital of France?" }
];

const runner = new MultipleAnswers([
    new OpenAI({ model: "gpt-5.5-mini" }),
    new OpenAI({ model: "gpt-5.5-mini" }),
    new Anthropic({ model: "claude-4-8-sonnet-latest" })
]);

// Run all and get results
const results = await runner.invoke({ messages });
```

### Runner Variations

The `parallelRun` constructor argument is an array of `ParallelRun` values. Each value can be one of these runner types:

| Runner type | Description | Example |
| :--- | :--- | :--- |
| `AgentModel` | A model implementation such as `OpenAI`, `Anthropic`, `Google`, or `RunPod`. | `new OpenAI({ model: "gpt-5.5-mini" })` |
| `ReActAgent` | A configured agent that can reason, call tools, and produce an answer. | `new ReActAgent({ model, systemPrompt, messages: [], tools: [] })` |
| Function runner | A synchronous or asynchronous function receiving `InvokeOptions`. | `async ({ messages, abort }) => ({ messages })` |

Every runner receives the same options when `invoke` starts:

```typescript
const results = await runner.invoke({
    messages,
    abort: abortController.signal
});
```

`messages` is the conversation supplied to each model or agent. The optional `abort` signal is also passed to every runner. A custom function runner should check the signal itself when it performs asynchronous work.

```typescript
const customRunner = async ({ messages, abort }) => {
    if (abort?.aborted) {
        return { messages };
    }

    return {
        messages: [
            ...messages,
            { type: "ai", content: "Answer produced by a custom runner." }
        ]
    };
};

const runner = new MultipleAnswers([
    new OpenAI({ model: "gpt-5.5-mini" }),
    customRunner
]);

const results = await runner.invoke({ messages });
```

### Picking the Best Answer

You can use `getBest` to automatically invoke and evaluate all runs, returning the one with the highest evaluation score.

```typescript
const best = await runner.getBest(messages, {
    model: new OpenAI({ model: "gpt-5.5-mini" }),
    systemPrompt: "Evaluate which answer is most accurate."
});

console.log("Best Score:", best.evaluation.result.score);
console.log("Best Answer:", best.result.answer[0].content);
```

### Evaluating Answers

Use `evaluate` when you need the evaluation for every parallel answer instead of only the highest-scoring answer. This is useful when you want to inspect reasoning and metrics, apply your own acceptance threshold, keep all candidates for comparison, or implement a ranking strategy different from `getBest`.

Call `invoke` first so that `MultipleAnswers.results` contains the completed runner outputs. The `sharedContext` argument should contain the messages that came before the candidate answers, usually the user request. `evaluate` appends each runner's final AI message to that context before sending it to `AgenticEvaluator`.

```typescript
const sharedContext = [
    { type: "user", content: "Explain why the sky appears blue." }
];

const runner = new MultipleAnswers([
    new OpenAI({ model: "gpt-5.5-mini" }),
    new Anthropic({ model: "claude-4-8-sonnet-latest" })
]);

await runner.invoke({ messages: sharedContext });

const evaluations = await runner.evaluate(sharedContext, {
    model: new OpenAI({ model: "gpt-5.5-mini" }),
    systemPrompt: "Evaluate which answer is scientifically accurate and clearly explained.",
    tools: []
});

for (const { id, evaluation, result } of evaluations) {
    console.log(id, result.messages?.at(-1)?.content);
    console.log("Score:", evaluation.result.score);
    console.log("Verdict:", evaluation.result.verdict);
    console.log("Reasoning:", evaluation.result.reasoning);
}
```

`evaluatorConfig` configures the `AgenticEvaluator` used for every answer. Provide the evaluator model, its system prompt, and any tools it needs to validate the responses. Do not provide `messages` in this object; `MultipleAnswers.evaluate` builds the evaluation conversation from `sharedContext` and the candidate answer.

The returned array preserves the order of `this.results`. Each item has this shape:

```typescript
{
    id: string;
    evaluation: {
        result: {
            score: number; // 0 to 1
            verdict: "BEST" | "GOOD" | "POOR" | "REJECTED";
            reasoning: string;
            metrics: Record<string, number>;
            improvements?: string[];
        };
        messages: MessagesVariations[];
    };
    result: any;
}
```

Evaluations run sequentially in the order in which the runners were registered. For each result, the method emits `evaluate_start`, selects `result.messages.at(-1)` or `result.answer.at(-1)` as the candidate message, creates a new `AgenticEvaluator`, waits for its structured evaluation, emits `evaluate_end`, and stores the evaluation together with the original result. If a result has no final message, `evaluate` throws an error for that runner rather than returning an incomplete evaluation.

`evaluate` does not sort the returned array. Sort or filter it yourself when you need custom selection logic:

```typescript
const accepted = evaluations
    .filter(({ evaluation }) => evaluation.result.score >= 0.8)
    .sort((a, b) => b.evaluation.result.score - a.evaluation.result.score);

const bestAccepted = accepted[0];
```

Use `getBest(sharedContext, evaluatorConfig)` when you only need the highest-scoring result. Internally, it invokes all runners with `sharedContext`, evaluates every result, sorts by descending score, and returns the first evaluation.

### Runner Events

Runner instances keep their own event listeners when they are passed to `MultipleAnswers`. Register listeners on the `ReActAgent` or `AgentModel` before adding the instance to the runner list or before launching `MultipleAnswers` logic with `invoke()` method. These events are emitted by the original runner; `MultipleAnswers` does not re-emit them.

```typescript
const agent = new ReActAgent({
    model: new OpenAI({ model: "gpt-5.5-mini" }),
    systemPrompt: "Answer the user request.",
    messages: [],
    tools: []
});

agent.onEvent("reasoning", thoughts => {
    console.log("Agent reasoning:", thoughts);
});

agent.onEvent("llm_result", result => {
    console.log("Agent model result:", result);
});

const model = new OpenAI({ model: "gpt-5.5-mini" });

model.onEvent("reasoning", content => {
    console.log("Model reasoning:", content);
});

model.onEvent("stream", event => {
    console.log("Model stream event:", event);
});

const runner = new MultipleAnswers([agent, model]);
await runner.invoke({ messages });
```

### MultipleAnswers Events

Use `MultipleAnswers.onEvent` for lifecycle events from the parallel run and evaluation process:

| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `start_run` | Emitted when a parallel run starts. Emitted each time `.invoke()` method is triggered  | `id: string` |
| `end_run` | Emitted when a parallel run finishes. Emitted each time `.invoke()` method is triggered  | `id: string, output: any` |
| `evaluate_start` | Emitted when evaluation for a specific run starts. Emitted once `.evaluate()` method is triggered | `id: string` |
| `evaluate_end` | Emitted when evaluation for a specific run finishes. Emitted once `.evaluate()` method is triggered | `id: string, evaluation: EvaluationResult` |

## Usecases
- Benchmarks of models (like: https://arena.ai)
- `RLHF` (Reinforcement Learning with Human Feedback) - Use to compare the outcomes where user chooses the best - use the collected informations then in `RLHF` to fine-tune models for user preferences
- Get the best outcome for user with validation
- Get first outcome for user - for ASAP scenarios
- Combine multiple answers with use of llm as concluder
