To speed up the `ReActAgent` and reduce execution time for the same results, you can focus on minimizing the **number of inference turns** and **graph node transitions**, as these are the primary sources of latency.

Based on the ReAct.agent.ts implementation, here are several actionable strategies:

### 1. Disable Subagent Conclusions
Currently, every time a subagent is spawned, it is hardcoded to generate a final conclusion:
```typescript
// src/agent/ReAct.agent.ts L616
const subagent = new ReActAgent<Skills, Memory>({
    // ...
    withConclusion: true // <--- Adds one full LLM turn per subagent call
});
```
**Speedup**: Modify the subagent initialization to use `withConclusion: false`. Subagents are "internal" to the agent's reasoning; the main agent usually only needs the raw output, and the extra "Conclusion" turn adds significant latency without changing the outcome for the main agent.

### 2. Parallelize Subagent Calls
The current ReAct.agent.ts logic only detects a single subagent call per turn.
**Speedup**: Update the regex/parsing logic to detect multiple `[[RAVEN_CALL_SUBAGENT]]` directives in a single AI message. Then, update the `main_node` to trigger multiple subagent nodes in parallel (using `Promise.all` if your Graph implementation supports it) rather than waiting for one and then looping back.



### 3. Eliminate Tool Output "Dead Turns"
In `main_node`, when tool results are retrieved, the agent returns to the main node just to update its state before making the next model call:
```typescript
// src/agent/ReAct.agent.ts L369
return {
    callNode: "main_node",
    stateUpdate: {
        ...stateWithoutCallTools,
        toolsOutputRetrived: true
    }
};
```
**Speedup**: Merge the tool message processing logic directly into the model invocation flow. Instead of yielding back to the graph and waiting for the next cycle, update the messages and proceed directly to the model call in the same execution turn. This saves one graph transition per tool-use cycle.

### 3.5. Parallel tools calling
- Make the tools to be able to call in parallel
- Make it as separate paramater to allow to call same as parallel agents calling

### 4. Optimize the System Prompt Loop
The `ensureWrappedSystemPrompt` and `synchronizeModelConfig` methods are called frequently.
**Speedup**: Cache the wrapped system prompt. Only rebuild it if the underlying `agentConfig.systemPrompt` or the available subagents/tools change. This reduces overhead in high-frequency reasoning loops.

### 5. Smart Conclusion Logic
The main agent also performs a separate inference call to write a conclusion:
```typescript
// src/agent/ReAct.agent.ts L428
if (this.agentConfig.withConclusion) {
    await this.concludeAndAppendConclusionMessage();
}
```
**Speedup**: If the last AI message already provides a concise and complete answer (which can be detected via a keyword or simple heuristic), you can skip the ReAct.agent.ts call. This avoids the cost and latency of a redundant "summary" turn.

### Summary of Potential Gains
| Strategy | Turn Savings | Latency Impact |
| :--- | :--- | :--- |
| **Disable Subagent Conclusions** | 1 turn per subagent | ~5-15s saved per call |
| **Parallel Subagents** | $N-1$ turns | Huge for multi-task orders |
| **Inline Tool Resolution** | 1 graph step | ~50ms - 200ms |
| **Smart Conclusion** | 1 turn per run | ~5-10s saved |

By implementing these changes, you effectively reduce the "chattiness" of the agent framework, allowing the core reasoning to happen with fewer round-trips to the LLM.