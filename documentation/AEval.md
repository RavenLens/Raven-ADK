# AEval
AEval stands for Agentic Evaluator (`AgenticEvaluator`) that is the way to provide analysys the output in comparision to expected outcome given in question to llm or does the answer include the characteristic

## How does it work?
The `AgenticEvaluator` works by spawning a dedicated `ReActAgent` purely for evaluation purposes. 
1. **Context Analysis**: It takes the full conversation transcript (including the last AI response) and analyzes it against the user's intent.
2. **Scoring**: It uses the evaluation agent's reasoning capability to assign a `score` (0.1 - 1.0) and a `verdict` (BEST, GOOD, POOR, REJECTED).
3. **Reasoning & Feedback**: It produces a detailed `reasoning` and a list of `improvements`.
4. **Agentic Validation**: Unlike static evaluators, `AEval` can use tools (e.g., browsing the web, executing code) to verify the correctness of the AI's claims.

## Example usage

```typescript
import { AgenticEvaluator, OpenAI } from "@ravenlens/raven-adk";

const model = new OpenAI({ apiKey: "..." });
const messages = [
    { type: "user", content: "Write a function to calculate fibonacci in Rust" },
    { type: "ai", content: "Here is the code: ..." }
];

const evaluator = new AgenticEvaluator(messages, {
    model, // The model used to evaluate
    systemPrompt: "You are a senior Rust engineer evaluating code quality.",
    tools: [] // Add code execution tools here to verify output!
});

// 1. Simple evaluation
const result = await evaluator.evaluate();
console.log(`Score: ${result.score}, Verdict: ${result.verdict}`);

// 2. Improvement loop
const loopResult = await evaluator.loop(
    model, // The runner to re-execute for improvements
    { 
        score: 0.9, 
        verdict: 'BEST', 
        expectationDescription: "The code must be idiomatic Rust and include tests." 
    },
    3 // Max retries
);

if (loopResult.success) {
    console.log("Improved Answer:", loopResult.reasoningMessages.at(-1)?.content);
}
```

## Improving Evaluation Quality

### Enhancing `agentConfig`
To get the most accurate evaluations, equip your `AgenticEvaluator` with specific tools based on the domain:
- **Internet Search**: Use a Google Search or Browsing tool if the agent needs to verify facts or current events.
- **Code Execution**: Use a Sandbox (e2b, nodejs) if the output contains code. The evaluator can run the code to ensure it's bug-free.
- **Knowledge Retrieval**: Connect the evaluator to your `Memory` store to ensure compliance with internal documentation.

### Setting Expectations in `loop`
When using the `.loop()` method, provide a clear `expectationDescription`. 
- **Bad Expectation**: "Make it better."
- **Good Expectation**: "The response must be under 200 words, use a professional tone, and mention the specifically requested product features X and Y."
- **Verdicts**: Aim for `BEST` or `GOOD` for production-ready responses. `REJECTED` will always trigger a retry if the loop hasn't hit the limit.

## Events

`AgenticEvaluator` provides several events to monitor the evaluation process in real-time.

| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `evaluate_start` | Emitted when the evaluation process starts. | - |
| `evaluate_end` | Emitted when evaluation finishes successfully. | `resultMessage: MessagesVariations` (The message containing structured output) |
| `loop_iteration` | Emitted at the start of each iteration in the improvement loop. | `iteration: number` |

### Listening to Events

```typescript
evaluator.onEvent("evaluate_start", () => {
    console.log("Starting evaluation...");
});

evaluator.onEvent("evaluate_end", (message) => {
    console.log("Evaluation complete. Reasoning:", message.structuredOutput.reasoning);
});

evaluator.onEvent("loop_iteration", (iteration) => {
    console.log(`Starting loop iteration: ${iteration}`);
});
```

## Features
AEval includes these features:

- **Loop**: Automatically requests improvements from the original model/agent if the evaluation criteria are not met. It feeds the `improvements` list back to the prompt, ensuring the next iteration addresses specific failures.
- **Structured Metrics**: Returns a `metrics` record allowing developers to track specific KPIs across multiple evaluations.
