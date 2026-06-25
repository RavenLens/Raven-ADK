# Quickstart

Get up and running with RavenADK in just a few minutes.

## 1. Installation

Install the library using npm:

```bash
npm install @ravenlens/raven-adk
```

## 2. Basic ReAct Agent

The `ReActAgent` is the most common way to start building with RavenADK. It follows a loop of reasoning and acting to solve complex tasks.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { tool } from "@ravenlens/raven-adk/tools";
import { OpenAI } from "@ravenlens/raven-adk/models";
import * as z from "zod";

async function main() {
    // 1. Initialize the model
    const model = new OpenAI({
        model: "gpt-4-turbo",
        apiKey: process.env.OPENAI_API_KEY,
    });

    // 2. Create the agent
    const agent = new ReActAgent({
        model: model,
        systemPrompt: "You are a helpful research assistant.",
        messages: [
            { type: "user", content: "What is the temperature in San Francisco?" }
        ],
        tools: [
            tool(
                async ({ location }) => {
                    // In a real app, you would call a weather API here
                    return JSON.stringify({ temperature: 18, unit: "Celsius" });
                },
                {
                    toolName: "get_weather",
                    toolDescription: "Get the current weather for a specific location",
                    toolArguments: z.object({
                        location: z.string()
                    })
                }
            )
        ]
    });

    // 3. Listen to agent events (optional but recommended!)
    agent.onEvent("llm_result", (result) => {
        console.log("Agent is thinking...");
    });

    // 4. Run the agent
    await agent.start();

    // 5. Get the result
    const messages = agent.getMessages();
    const finalAnswer = messages[messages.length - 1].content;
    console.log("Final Answer:", finalAnswer);
}

main();
```

## 3. Using Graphs for Workflows

If you need more control over your agent's flow, you can use the `Graph` engine to define custom logic.

```typescript
import { Graph, GraphMarkers } from "@ravenlens/raven-adk/graph";

const graph = new Graph({ step: 1 });

graph
    .addNode("step_1", async (state) => {
        console.log("Executing Step 1");
        return { stateUpdate: { step: 2 } };
    })
    .addNode("step_2", async (state) => {
        console.log("Executing Step 2");
        return {}; // Finish here
    })
    .addEdge(GraphMarkers.START, "step_1")
    .addEdge("step_1", "step_2")
    .addEdge("step_2", GraphMarkers.END);

await graph.start();
```

## Next Steps

Now that you have your first agent running, dive deeper into more advanced features:

- [ReAct Agent Detailed Guide](./ReAct-Agent.md)
- [Managing Memory](./Memory.md)
- [Using Tools & MCP](./MCP.md)
- [Recursive Language Modeling (RLMs)](./RLMs.md)
- [Building Agent Workflows with Graph](./Graph.md)
)