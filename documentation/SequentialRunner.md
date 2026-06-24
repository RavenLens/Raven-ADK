
# SequentialRunner

The `SequentialRunner` is a core utility designed to chain multiple asynchronous actions (runners) in a strict sequence. It provides a robust evaluation and retry mechanism, allowing you to define specific strategies for handling functional failures (`success: false`) and runtime exceptions (`catch` blocks).

## Purpose

The primary goal of `SequentialRunner` is to manage complex workflows where each step depends on the output of the previous one. It is particularly useful for AI-driven pipelines where outputs might be non-deterministic and require multiple attempts to meet quality gates.

## Key Features

- **Standardized State Passing**: Each runner receives the exit state of the prior runner.
- **Dual Rollback Strategy**: Separate retry counters for functional failures vs. code errors.
- **Event-Driven Lifecycle**: Detailed hooks for `start`, `runStart`, `rollback`, `runEnd`, `error`, and `end`.
- **Flexible Runner Identification**: Mark each step with a `RunnerID` (string or number) for easier debugging and logging.

## Core Concepts

### SequentialRunnerOperationalObject
This is the object passed between runners:
- `success`: A boolean indicating if the action achieved its goal.
- `state`: The data produced by the runner (optional).
- `args`: Metadata or error details provided when `success` is `false`.

### Rollback Configuration
```typescript
{
    error: 3,   // Number of retries for thrown Exceptions
    failure: 2  // Number of retries for results where success is false
}
```

## Usage Example

```typescript
import { SequentialRunner } from "../src/agent/abstract/sequential";

// 1. Define your runners
const analyzeText = async (prior) => {
    // Logic here...
    return { success: true, state: { keywords: ["AI", "Agents"] } };
};

const generateSummary = async (prior) => {
    const keywords = prior?.state.keywords;
    if (!keywords) return { success: false, args: { reason: "No keywords" } };
    return { success: true, state: "Summary based on " + keywords.join(", ") };
};

// 2. Initialize the runner
const pipeline = new SequentialRunner([
    ["analysis", analyzeText],
    ["summary", generateSummary]
], { error: 1, failure: 2 });

// 3. Listen to events
pipeline.onEvent("rollback", (id, type, count) => {
    console.log(`Retrying ${id} due to ${type}. Attempt #${count}`);
});

// 4. Invoke
const result = await pipeline.invoke();
console.log("Final Outcome:", result.state);
```

## More Use Cases
You can use `SequentialRunner` with AEval, ReAct agent and LLMs along other RavenADK standards to qucikly make resistant flows. Few cases demonstrates where it's primary useful is shown down below

### 1. Multi-Stage Content Generation
Generate a blog post outline, then the content, then SEO metadata, and finally translate it. If the translation fails, retry just that step without re-generating the entire post.

### 2. Autonomous Agent Tool-Use
An agent needs to:
1. Search for information.
2. Extract relevant data.
3. Format the data into a report.
If the extraction step returns `success: false` because the search results were poor, the runner can retry the extraction (perhaps with updated logic) before moving to the formatting stage.

### 3. Data Transformation Pipelines
Processing large datasets where Step A cleans the data, Step B enriches it via an external API, and Step C saves it to a database. The rollback strategy can handle API rate limits (as errors) or data validation failures (as functional failures).

### 4. Media Production Workflows
As mentioned in the introduction:
- Generate a script from a prompt.
- Generate character dialogue from the script.
- Generate voiceovers for each character.
- Composite into a final video.

## API Reference

### `onEvent(event, listener)`
Subscribes to lifecycle events:
- `start`: Flow started.
- `runStart`: A specific runner is about to execute.
- `rollback`: A retry was triggered.
- `runEnd`: A specific runner finished (successfully or exhausted retries).
- `error`: An exception was caught.
- `end`: The entire sequence completed.

### `invoke()`
Starts the execution. Returns a `Promise<SequentialRunnerOperationalObject>` representing the final state of the last runner.

