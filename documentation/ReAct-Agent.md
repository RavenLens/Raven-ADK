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

### Core Lifecycle Events
| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `llm_result` | Emitted whenever the underlying LLM returns a result. | `result: LLMAnswer` |
| `tool_invoked` | Emitted just before a tool is called. | `toolName: string`, `toolParams: Record<string, any>` |
| `tool_executed` | Emitted after a tool has finished execution. | `toolName: string`, `toolParams: Record<string, any>`, `output: string` |
| `reasoning` | Emitted during the reasoning phase (useful for streaming chunks). | `content: string` |
| `reasoning_end` | Emitted at the end of the reasoning phase with the full thought summary. | `thoughts: string` |
| `result_producing_start` | Emitted when the agent begins to generate its final output. | - |
| `abort` | Emitted once when the configured abort signal stops the run. | - |
| `concluding_start` | Emitted when the agent starts generating the final conclusion summary. | - |
| `concluding_end` | Emitted when the final conclusion is ready. | `conclusion: string` |

### Plugin Events
| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `plugin_invoking` | Emitted just before a plugin execution starts. | `pluginName: string`, `executionWay: string \| string[]` |
| `plugin_result` | Emitted after a plugin has finished its execution. | `pluginName: string`, `executionWay: string \| string[]`, `result: any` |

### Subagent Events
| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `subagent_called` | Emitted when a subagent is invoked/delegated. | `role: string`, `instruction: string` |
| `subagent_result` | Emitted when a subagent returns its final result. | `role: string`, `instruction: string`, `result: ReActAgentInvokeResult` |
| `subagent_reasoning` | Emitted during subagent reasoning phase. | `role: string`, `content: string` |
| `subagent_tool_invoked` | Emitted before a subagent calls a tool. | `role: string`, `toolName: string`, `toolParams: any` |
| `subagent_tool_executed` | Emitted after a subagent tool execution. | `role: string`, `toolName: string`, `toolParams: any`, `output: string` |

### Human-In-The-Loop (HITL) Events
| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `hitl_triggered` | Emitted when an HITL interaction is requested. | `type: string`, `payload: any` |
| `hitl_result` | Emitted when the HITL response is received. | `type: string`, `payload: any`, `result: any` |
| `hitl_tool_approval` | Emitted during tool-usage approval request. | `toolName: string`, `allowance: any` |
| `hitl_question` | Emitted when a question is asked to the user. | `questionType: "abc" \| "open"`, `question: string`, `answer: any` |
| `hitl_acceptance` | Emitted for confirmation/acceptance prompts. | `question: string`, `answer: any` |

### Memory Events
| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `memory_action` | Generic event for any memory operation. | `action: string`, `memoryName: string`, `details: any`, `result?: any` |
| `memory_fetch` | Emitted right after memory retrieval. | `memoryName: string`, `params: any`, `result: any` |
| `memory_save` | Emitted right after memory storage. | `memoryName: string`, `record: any`, `result: any` |
| `memory_get_conclusion`| Emitted when memory file conclusion is read. | `memoryName: string`, `conclusion: string` |
| `memory_set_conclusion`| Emitted after updating a memory conclusion. | `memoryName: string`, `content: string`, `status: boolean` |

## Plugins
Plugins allow you to extend or modify the `ReActAgent` behavior at various stages of its execution loop.

### Plugin Execution Ways
A plugin can hook into the following execution points:

| Execution Way | Description |
| :--- | :--- |
| `before_agent_run` | Runs before the agent starts. Useful for modifying configuration. |
| `after_agent_run` | Runs after the agent finishes. Ideal for cleanup or final summaries. |
| `before_model_call` | Runs before an LLM call (main agent or subagents). |
| `after_model_call` | Runs after an LLM call completes its run. |
| `before_tool_invoked` | Runs before a specific tool is called. |
| `after_tool_result` | Runs after a tool returns a result or error. |
| `subagent_invoked` | Runs when a subagent delegation starts. |
| `subagent_result` | Runs when a subagent returns its result. |
| `subagent_thought` | Runs for each subagent reasoning chunk. |
| `memory` | Runs for each memory interaction. |
| `thought` | Runs for each reasoning chunk produced by the main agent. |

### Plugin Context (`ExecutionFrom`)
When a plugin's `execute` method is called, it receives an `executionFrom` object containing context about the current execution point:

- `way`: The current `PluginExecutionWays`.
- `nodeType`: Either `"main"`, `"subagent"`, or `"aside"`.
- `toolName` / `toolParams` / `toolOutput`: Available when hooking into tool execution.
- `subagentRole` / `subagentResult`: Available when hooking into subagent execution.
- `memoryInstance` / `memoryPosition`: Available when hooking into memory operations.
- `thought`: The actual reasoning string when hooking into thoughts.

### Using Plugins
You can use built-in plugins like `createTodoPlugin` or create your own custom plugins.

#### Custom Plugin Example
```typescript
const myPlugin = {
    name: "MyCustomPlugin",
    executionWay: "before_tool_invoked",
    async execute(executionFrom, agentConfig, graphState) {
        console.log(`Plugin active! Tool ${executionFrom.toolName} is about to be called.`);
        
        // Return status true and optionally modify config/state
        return {
            status: true,
            result: {
                // Modified agentConfig or graphState
            }
        };
    }
};

const agent = new ReActAgent({
    // ...
    plugins: [myPlugin]
});
```

#### Predefined Plugins
RavenADK provides several predefined plugins to handle complex behaviors:

```typescript
import { createTodoPlugin } from "@ravenlens/raven-adk/plugins/todo";
import { createMemoryConclusionPlugin } from "@ravenlens/raven-adk/memory";

const agent = new ReActAgent({
    // ...
    plugins: [
        createTodoPlugin(todoStorage),
        createMemoryConclusionPlugin(memoryAgentConfig)
    ]
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
