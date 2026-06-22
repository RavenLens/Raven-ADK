# Multiple Answers
Multiple answers is a feature allows to run multiple llms and agents in parallel, evalue answers and pick the one contains the best outcome for given task

## Features
- Run multiple LLMs in parallel
- Run multiple Agents in parallel
- Get answers of all tasks
- Monitor ongoing progress of each runner with usage of its ids
    - Retrive id
    - Monitor
- Evaluate outcomes with separate modules like: `HallucinationsDetector` or `AEval`

```typescript

```

## Usecases
- Benchmark (like: https://arena.ai)
- Get the best outcome for user with validation
- Get first outcome for user - for ASAP scenarios
- Combine multiple answers with use of llm as concluder
