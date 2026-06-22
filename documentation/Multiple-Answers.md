# Multiple Answers
Multiple answers is a feature allows to run multiple llms and agents in parallel, evalue answers and pick the one contains the best outcome for given task

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
const runner = new MultipleAnswers([
    new OpenAI({ model: "gpt-5.5-mini" }),
    new OpenAI({ model: "gpt-5.5-mini" }),
    new Anthropic({ model: "claude-4-8-sonnet-latest" })
]);

// Run all and get results
const results = await runner.invoke();
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

### Events

| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `start_run` | Emitted when a parallel run starts. | `id: string` |
| `end_run` | Emitted when a parallel run finishes. | `id: string, output: any` |
| `evaluate_start` | Emitted when evaluation for a specific run starts. | `id: string` |
| `evaluate_end` | Emitted when evaluation for a specific run finishes. | `id: string, evaluation: EvaluationResult` |

## Usecases
- Benchmark (like: https://arena.ai)
- Get the best outcome for user with validation
- Get first outcome for user - for ASAP scenarios
- Combine multiple answers with use of llm as concluder
