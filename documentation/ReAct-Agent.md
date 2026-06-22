# ReAct Agent

The `ReActAgent` is a standalone agent in RavenADK designed to follow the ReAct (Reason + Act) loop. It reasons about tasks, uses tools to gather information or perform actions, and iterates until it produces a final answer.

## Key Features

- **Reasoning Loop**: The agent generates internal thoughts before making any tool calls or providing a final response.
- **Tool Usage**: Native support for standard tools and MCP (Model Context Protocol) tools. Supports both sequential and **parallel tools execution**.
- **Skills**: Integrates with the RavenADK Skills system for dynamic capability enhancement.
- **Memory**: Supports persistent memory stores (e.g., ChromaDB) to remember user preferences and session history.
    - Memory via `hasToRemember` retrives specification what agent has to remember
    - (Optional): Memory can retrive the `session` that is id used to bound the memory to the specific entry (e.g: user, workspace, ...) - you can use different sessions ids 
- **Human-In-The-Loop (HITL)**: Can pause and ask for user approval or clarification via Socket.io.
- **Subagents**: Capability to delegate complex tasks to specialized subagents. Supports **parallel subagents execution** with multi-agent orchestration. [Checkout subagents documentation](./Subagents.md) for more
- **Structured Output**: Capability to retrive the output follows specified `zod (v4) schema`. [Checkout structured-output documentation](./StructuredOutput.md) for more
- **Optimized Execution**: Features internal reasoning recalls and optimized tool resolution to minimize unnecessary turns.
- **Plugins**: Use [Chat-Compaction Plugin](./compression/Compression.md) and/or [TODO Plugin](./Todo-Plugin.md) and make your own/use community plugins to extend how does model behave

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

## Events

The `ReActAgent` is built on an event-driven architecture. You can listen to various stages of the agent's lifecycle:

| Event Name | Description | Parameters |
| :--- | :--- | :--- |
| `llm_result` | Emitted whenever the underlying LLM returns a result. | `result: LLMAnswer` |
| `tool_invoked` | Emitted just before a tool is called. | `toolName: string`, `toolParams: Record<string, any>` |
| `tool_executed` | Emitted after a tool has finished execution. | `toolName: string`, `toolParams: Record<string, any>`, `output: string` |
| `reasoning_end` | Emitted at the end of the reasoning phase when thoughts are produced. | `thoughts: string` |
| `result_producing_start` | Emitted when the agent begins to generate its final output. | - |
| `concluding_start` | Emitted when the agent starts generating the final conclusion summary. | - |
| `concluding_end` | Emitted when the final conclusion is ready. | `conclusion: string` |

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
        model: "gpt-4",
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
reactAgent.onEvent("tool_invoked", (name, params) => {
    console.log(`Invoking tool: ${name} with`, params);
});

reactAgent.onEvent("reasoning_end", (thoughts) => {
    console.log("Agent Thoughts:", thoughts);
});

// Invoke the agent
const result = await reactAgent.invoke();
console.log("Final Answer:", result.messages.at(-1).content);
```

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
