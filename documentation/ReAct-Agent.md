# ReAct Agent

The `ReActAgent` is a standalone agent in RavenADK designed to follow the ReAct (Reason + Act) loop. It reasons about tasks, uses tools to gather information or perform actions, and iterates until it produces a final answer.

## Key Features

- **Reasoning Loop**: The agent generates internal thoughts before making any tool calls or providing a final response.
- **Tool Usage**: Native support for standard tools and MCP (Model Context Protocol) tools.
- **Skills**: Integrates with the RavenADK Skills system for dynamic capability enhancement.
- **Memory**: Supports persistent memory stores (e.g., ChromaDB) to remember user preferences and session history.
    - Memory via `hasToRemember` retrives specification what agent has to remember
    - (Optional): Memory can retrive the `session` that is id used to bound the memory to the specific entry (e.g: user, workspace, ...) - you can use different sessions ids 
- **Human-In-The-Loop (HITL)**: Can pause and ask for user approval or clarification via Socket.io.
- **Subagents**: Capability to delegate complex tasks to specialized subagents. [Checkout subagents documentation](./Subagents.md) for more
- **Structured Output**: Capability to retrive the output follows specified `zod (v4) schema`. [Checkout structured-output documentation](./StructuredOutput.md) for more

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
