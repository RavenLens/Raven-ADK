# ReAct Agent

The `ReActAgent` is a standalone agent in RavenADK designed to follow the ReAct (Reason + Act) loop. It reasons about tasks, uses tools to gather information or perform actions, and iterates until it produces a final answer.

## Key Features

- **Reasoning Loop**: The agent generates internal thoughts before making any tool calls or providing a final response. Supports **unified reasoning** across major providers (OpenAI, Anthropic, Google).
- **Tool Usage**: Native support for standard tools and MCP (Model Context Protocol) tools. Supports both sequential and **parallel tools execution**.
- **Skills**: Integrates with the RavenADK Skills system for dynamic capability enhancement.
- **Memory**: Supports persistent memory stores (e.g., ChromaDB) to remember user preferences and session history.
    - Memory via `hasToRemember` retrives specification what agent has to remember
    - (Optional): Memory can retrive the `session` that is id used to bound the memory to the specific entry (e.g: user, workspace, ...) - you can use different sessions ids 
- **Human-In-The-Loop (HITL)**: Can pause and ask for user approval or clarification via Socket.io.
- **Subagents**: Capability to delegate complex tasks to specialized subagents. Supports **parallel subagents execution** with multi-agent orchestration. [Checkout subagents documentation](./Subagents.md) for more
- **Structured Output**: Capability to retrive the output follows specified `zod (v4) schema`. [Checkout structured-output documentation](./StructuredOutput.md) for more
- **Optimized Execution**: Features internal reasoning recalls and optimized tool resolution to minimize unnecessary turns.
- **Plugins**: Use [Chat-Compaction Plugin](./compaction/Readme.md) and/or [TODO Plugin](./Todo-Plugin.md) and make your own/use community plugins to extend how does model behave

## Communication with other Agents internal/external

Configure one or more communication protocol bindings with `communicationProtocols` to let the agent communicate with external agents. The binding's `systemPrompt` is added to the agent's system prompt, and its protocol tools and `customCommunicationTools` are added to the agent's tools.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { A2A } from "@ravenlens/raven-adk";
import { OpenAI } from "@ravenlens/raven-adk/models";

const a2a = A2A.createBinding({
    endpoint: "https://research-agent.example.com/rpc",
    participant: {
        id: "planner-agent",
        name: "Planner Agent",
        capabilities: ["delegate_task", "consult_agents"]
    },
    pollingIntervalMs: 500,
    waitTimeoutMs: 120_000
});

const reactAgent = new ReActAgent({
    model: new OpenAI({
        model: "gpt-5.6-sol",
        apiKey: process.env.OPENAI_API_KEY
    }),
    systemPrompt: "Use the A2A research agent when external expertise is needed.",
    messages: [],
    tools: [],
    communicationProtocols: [a2a]
});

// ReActAgent automatically adds A2A delegate and consultation tools.
reactAgent.onEvent("protocol_event", (protocolName, eventName, taskId, eventArgs) => {
    console.log({ protocolName, eventName, taskId, eventArgs });
});

const result = await reactAgent.invoke({
    messages: [{
        type: "user",
        content: "Ask the research agent for the latest findings on Mars water reservoirs."
    }]
});

console.log("Final answer:", result.messages.at(-1)?.content);
```

> Check more about communication protocols at [Communication Protocols](./agents-communication-protocols/README.md)

- `invoke()` is the outbound communication path. It does not consume an inbound queue: when the model calls a protocol tool, the agent waits for the protocol result and can use the returned answer in the rest of its reasoning loop.

- `serve()` is the inbound worker path. It retrieves tasks from a protocol queue, invokes the ReAct agent for each task, and completes the queued task with the generated outcome. A binding must provide `queue` to use `serve()`.

## Multiple Skills

The `skills` configuration accepts one skill store or an array of skill stores. When multiple stores are provided, the agent exposes the exploration, script, and management tools from all stores and includes each store's available-skill information in the system prompt.

```typescript
const reactAgent = new ReActAgent({
    model,
    systemPrompt: "You are a capable assistant.",
    messages: [],
    tools: [],
    skills: [sessionSkills, sharedSkills]
});
```

## Execution Flow

The `ReActAgent` follows a sophisticated execution flow designed for efficiency:

1. **Reasoning**: The agent analyzes the task and decides on the next step.
2. **Internal Recall**: If the agent needs to re-evaluate or perform another reasoning pass without tools, it uses the `[[RAVEN_RECALL_MAIN_NODE]]` protocol.
3. **Action**:
    - **Tools**: Executes tools (standard or MCP). If `parallelTools` is enabled, multiple tool calls are handled concurrently.
    - **Subagents**: Delegates tasks using `[[RAVEN_CALL_SUBAGENT]]`. If `parallelizeSubagents` is enabled, it can spawn multiple subagents at once.
4. **Observation**: Collects results from tools or subagents and updates its context.
5. **Conclusion**: Once the task is complete, it produces a final summary for the user (can be disabled via `withConclusion: false`).

### Example: Internal Protocols

```text
// Internal Reason Recall pass
[[RAVEN_RECALL_MAIN_NODE]] Now I have the city name, I need to check the coordinates.

// Subagent Delegation
[[RAVEN_CALL_SUBAGENT]] Researcher | Find recent breakthroughs in quantum computing.
```
- This is how ReActAgent calls the subagents and delegates the task from the subagent to the main agent back then

## Events

The `ReActAgent` is built on an event-driven architecture. You can listen to various stages of the agent's lifecycle:

| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `llm_result` | Emitted whenever the underlying LLM returns a result. | `result: LLMAnswer` |
| `tool_invoked` | Emitted just before a tool is called. | `toolName: string`, `toolParams: Record<string, any>` |
| `tool_executed` | Emitted after a tool has finished execution. | `toolName: string`, `toolParams: Record<string, any>`, `output: string` |
| `reasoning` | Emitted during the reasoning phase (useful for streaming chunks). | `content: string` |
| `reasoning_end` | Emitted at the end of the reasoning phase with the full thought summary. | `thoughts: string` |
| `result_producing_start` | Emitted when the agent begins to generate its final output. | - |
| `abort` | Emitted once when the configured abort signal stops the run. | - |
| `concluding_start` | Emitted when the agent starts generating the final conclusion summary. It's right before `result_producing_start` event | - |
| `concluding_end` | Emitted when the final conclusion is ready. It's right before `result_producing_start` event | `conclusion: string` |
| `memory_error` | Emitted when a deterministic memory hook or registered memory tool fails. The agent logs the error and continues the run. | `ReActAgentMemoryError` |

### Memory failures

Deterministic memory failures are isolated per memory system, so a parsing, validation, retrieval, or persistence error does not stop the ReAct loop. Before-run failures are added to the wrapped system prompt under `Memory Diagnostics`, together with any successful memory context, so the model can continue without claiming that unavailable memory was retrieved or saved.

After-run failures are emitted through `memory_error` and written to `console.error` after the model has completed. `ReActAgent` does not provide a generic transaction rollback because memory implementations own their storage; use a transactional memory store when an update must be atomic.

When a registered tool-based memory `fetch` or `update` tool fails, the agent emits the same event and returns a memory-specific failed tool message to the model. The ReAct loop continues, and the model is told not to claim that the unavailable memory was retrieved or saved. Ordinary tool failures continue to emit only their normal failed tool message.

**Error Payload:** The error payload contains `memoryName`, `toolName`, `toolKind` (`"fetch"` or `"update"`), and a sanitized `message` for memory-tool failures. `toolKind` identifies the declared custom memory-tool category, not the storage operation performed by the callback. An `update` tool may save, overwrite, or delete a record, and all of those operations are reported as `toolKind: "update"`. Deterministic hook failures continue to contain `memoryName`, `hook`, `phase`, and `message`.

```typescript
reactAgent.onEvent("memory_error", (error) => {
    const source = error.toolName
        ? `tool ${error.toolName} (${error.toolKind})`
        : `hook ${error.hook} (${error.phase})`;
    console.error(`Memory ${error.memoryName} failed in ${source}: ${error.message}`);
});
```

## Example Usage

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { tool } from "@ravenlens/raven-adk/tools";
import { OpenAI, Anthropic } from "@ravenlens/raven-adk/models";
import * as z from "zod";
import { SkillMongoDBStore } from "@ravenlens/raven-adk/skills/store";
import { MemoryChromaDBStore } from "@ravenlens/raven-adk/memory/store";
import { HITLSocketIo } from "@ravenlens/raven-adk/tools/hitl";

const reactAgent = new ReActAgent({
    model: new OpenAI({
        model: "gpt-5.6-sol",
        apiKey: "your-api-key",
    }),
    systemPrompt: "You are a helpful assistant.",
    messages: [
        {
            type: "user",
            content: "Check the weather in London"
        }
    ],
    tools: [
        tool(
            ({ location }) => {
                return JSON.stringify({ temperature: 22, unit: "Celsius" });
            }, 
            {
                toolName: "get_weather",
                toolDescription: "Check weather condition for given location",
                toolArguments: z.object({
                    location: z.string()
                })
            }
        )
    ],
    // Optional: High Performance Execution Configuration
    parallelTools: true,
    parallelizeSubagents: true,
    withConclusion: true,
    maximumReasoningRecalls: 5,
    // Optional: Skills, Memory, HITL, Subagents configuration
    // ...
});


// Register event listeners
reactAgent.onEvent("reasoning", (thought) => {
    console.log("Thinking...", thought);
});

reactAgent.onEvent("reasoning_end", (thoughts) => {
    console.log("Agent full thoughts:", thoughts);
});

// Invoke the agent with reasoning configuration
const result = await reactAgent.invoke({
    reasoning: {
        budgetTokens: 16000 // For models supporting thought budgets (Claude 3.7 / Gemini)
    }
});
console.log("Final Answer:", result.messages.at(-1).content);
```

> Setup `parallelTools: true` and/or `parallelizeSubagents: true` and/or `withConclusion: true` to maximally speedup the process

### RLMs and ReAct Agent
For some scenarios like processing the large files of text you can find combining both standards **RLMs** with **ReAct** to be more effecitve. [Check more here](./RLMs.md)

## Structured Output

The `ReActAgent` can produce validated, type-safe JSON objects using `invokeStructuredOutput`. This allows the agent to execute its full reasoning loop and then extract the final result into a specific schema.

```typescript
import { z } from "zod";

const ResponseSchema = z.object({
    analysis: z.string(),
    score: z.number(),
    isSafe: z.boolean()
});

// Run the agent and get structured output
const result = await agent.invokeStructuredOutput(ResponseSchema);
console.log(result.messages.at(-1).structuredOutput);
```

> **Note**: To produce structured output, you must set `withConclusion: false` in the agent configuration. This prevents the agent from generating a natural language summary, which would otherwise interfere with the structured extraction process. For more details, see the [Structured Output documentation](./StructuredOutput.md).


## RAG
Combine your ReAct Agent with RAG for better outcomes check more at [RAG Documentation](./augmented%20generation/RAG.md)

## `AbortSignal`
Use [AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal) to stop the agent with immediate denial of the next step and suppression of results from currently pending steps.

### Essential Characteristics
- Once the signal is aborted, the agent stops scheduling new actions, emits the `abort` event once, and returns a `ReActAgentInvokeResult` with `state.isAborted = true`.
- Results from pending model, tool, HITL, or subagent operations are ignored after the abort.
- OpenTelemetry registration is intentionally deferred. The implementation contains the integration point for a later telemetry stage.

### Configuration
```typescript
const abortController = new AbortController();
const agent = new ReActAgent({
    // ...Obvious config
    abort: abortController.signal
})

// Simulation for Aborting after 2 sec -> In production evironment this will look differently
setTimeout(() => abortController.abort(), 2000);

agent.onEvent("abort", () => {
    console.log("Agent run aborted");
});

// Asynchronous run
agent.invoke()
    .then(result => console.log("Agent result", result));

```

<!-- TODO: Add abort to opentelemetry -->
