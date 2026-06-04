# Raven ADK

[![npm version](https://img.shields.io/npm/v/@ravenlens/raven-adk.svg)](https://www.npmjs.com/package/@ravenlens/raven-adk)
[![npm downloads](https://img.shields.io/npm/dm/@ravenlens/raven-adk.svg)](https://www.npmjs.com/package/@ravenlens/raven-adk)
[![License](https://img.shields.io/badge/license-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-7289da?logo=discord&logoColor=white)](https://discord.gg/eFfVjDj7Xd)

Open source Agent Developement Kit ***made to support wild AI-Agents Developement initiatives***. Gives native support for JavaScript environments, ***strongly base on events population*** - each action of library can be captured as the event what simplifies creating of breathtaking UX like: user see that agent is now thinking without complicated logic on side of developement. Open from definition; Anyone can become contributor

## Installation
```bash
npm install @ravenlens/raven-adk
```

## GraphBased
Use graph with this style to make your own workflow

```typescript
import { Graph, GraphMarkers } from "@ravenlens/@ravenlens/raven-adk/graph";

const graphState = { invokeTimes: 0 };
const graph = new Graph(graphState);

// Listen events execution
graph.onEvent("node_start", (nodeId, state) => {
    // When node execution has begun
});

graph.onEvent("node_end", (nodeId, state) => {
    // When node was finished (after return)
});

graph.onEvent("state_change", (nodeId, stateBefore, stateAfter) => {
    // When state was changed before node execution
});

// Graph Src logic
graph
    .addNode("node_1", (graphState) => {
        /// your logic
        if (invokeTimes === 1) {
            return {}; // Empty object when no state nor node was updated -> then will be called node introduced by the edge
        }

        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            },
            // Overrides node calling logic -> can call different node with this
            callNode: "node_1"
        }
    })
    .addNode("node_2", async (graphState) => {
        /// your logic
        return {
            stateUpdate: {
                ...graphState,
                invokeTimes: graphState.invokeTimes + 1
            }
        }
    })
    .addEdge(GraphMarkers.START, "node_1")
    .addEdge("node_1", "node_2")
    .addEdge("node_2", GraphMarkers.END);

// Start graph execution
await graph.start();

// Returns your updated state via all nodes execution
const updatedState = graph.getState(); // OR: graph.graphState;
```

> [Check more about graph](./documentation/Graph.md)

## Agent
### ReAct Agent
ReAct Agent is the standalone agent of RavenADK -> it's about to Reason atop of given task and act in his behalf to accomplish given task The best as possible.

> **ReAct** agent will: Reason, Make Actions, Use tools, Produce Thoughts and at the end produce output.

```typescript
    import { ReActAgent } from "@ravenlens/raven-adk/agents";
    import { OpenAI } from "@ravenlens/raven-adk/models";

    const reactAgent = new ReActAgent({
        model: new OpenAI({
            model: "gpt-4",
            apiKey: "your-api-key",
        }),
        systemPrompt: "Your system prompt",
        messages: [{ type: "user", content: "Hello!" }],
        tools: []
    });

    const agentSync = await reactAgent.invoke();
    console.log(agentSync.messages.at(-1).content);
```

> [Check full ReAct Agent documentation](./documentation/ReAct-Agent.md)

#### Skills
Skills of RavenADK are compliant with open [skills standard](https://agentskills.io/home) what is use by e.g: Claude Code, MS Copilot and likelly more
[Read more about RavenADK skills](./documentation/Skills.md)

## Documentation
[Check Documentation](https://app.gitbook.com/invite/ntFRoMEZ2t1Dk0CcVggr/MrsYwAwWVVYKPpgcNpjk)

## Contribution
If you would like to become official contributor contact with one of bellow channels

* [Discord](https://discord.gg/eFfVjDj7Xd)
* [email](mailto:official@ravenlens.io)
* [LinkedIn](https://www.linkedin.com/in/micha%C5%82-szczepa%C5%84ski-0476192a8/)

### Your ideas are going to be appreciated
You can openly tell your your idea in the **issues** or in the one of above specified channels
