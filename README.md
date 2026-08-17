# RavenADK

[![npm version](https://img.shields.io/npm/v/@ravenlens/raven-adk.svg)](https://www.npmjs.com/package/@ravenlens/raven-adk)
[![npm downloads](https://img.shields.io/npm/dm/@ravenlens/raven-adk.svg)](https://www.npmjs.com/package/@ravenlens/raven-adk)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Discord](https://img.shields.io/badge/Discord-Join%20Us-7289da?logo=discord&logoColor=white)](https://discord.gg/XJed3eKn4v)
[![Documentation](https://img.shields.io/badge/documentation-read-informational.svg?logo=read-the-docs&logoColor=white)](https://ravenalliance.gitbook.io/ravenalliance-docs)
<!-- TODO: Someday point to the dedicated webpage -->
[![Webpage](https://img.shields.io/badge/webpage-visit-blue.svg?logo=google-chrome&logoColor=white)](https://www.ravenalliance.tech)

**RavenADK** is an ultra-fast, lightweight, TypeScript-native **Agentic-AI** framework built-on *event-driven* approach with AI-SOTA patterns on mind.
<br/>**RavenADK** is designed to help you build high-performance AI agents with minimal dependencies; OpenSource in definition

> Join to out community on [discord](https://discord.gg/XJed3eKn4v)

<!-- Open source Agent Developement Kit ***made to support wild AI-Agents Developement initiatives***. Gives native support for JavaScript environments, ***strongly base on events population*** - each action of library can be captured as the event what simplifies creating of breathtaking UX like: user see that agent is now thinking without complicated logic on side of developement. Open from definition; Anyone can become contributor. -->

#### RavenADK as default supports these SOTA Agentic patterns:
- ReAct Agent - Design for high performance with **parallel tools** and **parallel subagents** support
- RLMs - Recursive approach to increase agent accuracy on large set of text with reducing significantly costs
- **ToT (Tree-of-Thoughts)** - Advanced reasoning framework for exploring multiple solution paths with parallel evaluation and backtracking - [check](./documentation/chains/Tree-of-Thoughts%20(ToT).md)
- **GACP** - Revolutionary **Graph Agent Communication Protocol** that changes how agents communicate and contribute to tasks and their **society** - [check](./documentation/gacp/GACP.md)
- Skills
    - Exploring and applying
    - Dynamic Skills solutions
    - Scripts Execution
- Memory
    - Memory exploring and writing (it does build memory about interactions)
    - Memory stores:
        - ChromaDB
        - Expand by writing your own memory store - [check tutorial](./documentation/Memory.md#creating-custom-memory-store)
- MCP - Model context protocol is to your disposition - [check it](./documentation/MCP.md)
- **Self-Improvement** - Agents can improve themselves through CASCADE pattern and recursive memory consolidation - [check](./documentation/Self-Improvement.md)
- **Self-Consistency** - Compose multiple answers, AEval, FactChecker, and ToT to improve reliability - [check](./documentation/Self-Consistency.md)
- **Multiple Answers** - Run multiple models, agents, or custom runners in parallel and select the best outcome - [check](./documentation/Multiple-Answers.md)
- Events - Listen agent events and transfer this to UI/TUI to show user what your agent is doing
- HITL - sometimes actions are risky or agent needs more information and it can ask you for that - [check](./documentation/HITL.md)
- Sandboxes - Secure code execution environments designed for RLM and ReAct tools - [check](./documentation/Sandbox.md)
- Builting tools
    - Browser - run serverless browser on your device - [check](./documentation/tools/Browsing.md)
- RAG (Resource-Augmented-Generation) - Use to enforce responses with documents from your vector-database. Retriver loads these documents matches to the Semantic Similarity of query given to llm. It's usefull when you've huge documents database cannot be treat as CAG. - [check](./documentation/augmented%20generation/RAG.md)
- AEval - Agentic evaluation for scoring responses and guiding improvements - [check](./documentation/AEval.md)
- FactChecker - Verify the truthfulness of specified information - [check](./documentation/FactChecker.md)
- AgentsDebate - Debate among agents the next step to take - [check](./documentation/AgentsDebate.md)

## Installation
```bash
npm install @ravenlens/raven-adk
```

## Documentation
[RavenADK Documentation](https://ravenalliance.gitbook.io/ravenalliance-docs)

- [Overview](./documentation/Overview.md)
- [Quickstart](./documentation/Quickstart.md)
- [ReAct Agent](./documentation/ReAct-Agent.md)
- [Workflows](./documentation/Workflows.md)
    - [Graph](./documentation/Graph.md)
    - [SequentialRunner](./documentation/SequentialRunner.md)
- [Tree-of-Thoughts (ToT)](./documentation/chains/Tree-of-Thoughts%20(ToT).md)
- [RLMs](./documentation/RLMs.md)
- [Graph Based Workflows](./documentation/Graph.md)
- [Memory Management](./documentation/Memory.md)
- [MCP Integration](./documentation/MCP.md)
- [HITL Support](./documentation/HITL.md)
- [GACP (Agent Communication)](./documentation/gacp/GACP.md)
- [Skills System](./documentation/Skills.md)
    - If enabled - overtime agent learns new skills
- [Self-Improvement](./documentation/Self-Improvement.md)
    - Agent learns new skills and keeps memories
- [Self-Consistency](./documentation/Self-Consistency.md)
- [Multiple Answers](./documentation/Multiple-Answers.md)
- [Secure Sandboxes](./documentation/Sandbox.md)
- [AEval](./documentation/AEval.md)
- [FactChecker](./documentation/FactChecker.md)
- [AgentsDebate](./documentation/AgentsDebate.md)
- [Supported Models](./documentation/Models.md)
    - [Models come with Compaction](./documentation/compaction/Readme.md#model-support)

## GraphBased
Use graph with this style to make your own workflow

## Motivation for library
<!-- TODO: Base on: https://www.ibm.com/think/insights/ai-adoption-challenges and current AI libraries compose motivation formula here -->
Our motivation for Raven Agent-Developmenet-Kit is to build an ai-agentic library is cleaver in its engineering and gives programmers ability to ship an ai apps with sota patterns along a UI/UX experiences delivering via native-javascript appraoach is events propagation. Extension of standalone is also benefit of RavenADK - extend the basic functionality base on your needances and current kit documentation

```typescript
import { Graph, GraphMarkers } from "@ravenlens/raven-adk/graph";

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
            model: "gpt-5.6",
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

### RLM (Recurrent Language Models)

RLM is a powerful pattern for processing **massive datasets** (100MB+) and **complex analyses** through recursive delegation to specialized models. It implements the **CodeAct pattern** where an orchestrator LLM **writes and executes code** to explore data, delegating analysis tasks to cheaper sub-models when needed.

**Why RLM?**
- **Process huge datasets** without context window limitations
- **Reduce costs** by ***70-90%*** through smart model delegation
- **Faster execution** via iterative code-based exploration
- **Transparent reasoning** via code execution events

```typescript
    import { RLMAgent } from "@ravenlens/raven-adk/rlm";
    import { NodeExecutionSandbox } from "@ravenlens/raven-adk/sandboxes";
    import { OpenAI } from "@ravenlens/raven-adk/models";

    // Load massive dataset (e.g., 500MB log file)
    const largeDataset = await fs.readFile("./massive-data.txt", "utf-8");

    const rlmAgent = new RLMAgent(largeDataset, {
        model: new OpenAI({
            model: "gpt-5.6",  // Orchestrator: writes code to explore data
            apiKey: process.env.OPENAI_API_KEY
        }),
        submodels: [
            {
                model: new OpenAI({
                    model: "gpt-5.6",  // Sub-model: fast & cheap
                    apiKey: process.env.OPENAI_API_KEY
                }),
                instruction: "Analyze patterns and classify data"
            }
        ],
        maxIterations: 5,
        codeSandbox: new NodeExecutionSandbox()
    });

    // Monitor the reasoning process
    rlmAgent.onEvent("orchestrator_model_call", (model, result) => {
        console.log("🧠 Orchestrator code:", result.substring(0, 100) + "...");
    });

    rlmAgent.onEvent("submodel_call", (model, task) => {
        console.log("🤖 Delegating to sub-model:", task.substring(0, 80) + "...");
    });

    // Run analysis
    const result = await rlmAgent.invoke(
        "Analyze logs: find top 5 error types, frequency trends, and performance bottlenecks"
    );

    console.log("✅ Analysis:", result);
    console.log("📊 Tokens used:", rlmAgent.getUsage());
```

**Combine RLM + ReAct for Complex Workflows:**

```typescript
    // Step 1: RLM processes huge dataset efficiently
    const rlmAnalysis = await rlmAgent.invoke("Extract key findings from 500K records");

    // Step 2: ReAct Agent acts on findings (uses tools, makes decisions)
    const reactAgent = new ReActAgent({
        model: new OpenAI({ model: "gpt-5.5", apiKey: process.env.OPENAI_API_KEY }),
        systemPrompt: "You are an operations agent.",
        messages: [
            {
                type: "user",
                content: `Based on this analysis:\n${rlmAnalysis}\n\nCreate alerts and notify teams.`
            }
        ],
        tools: [
            {
                name: "create_alert",
                description: "Create a system alert",
                execute: async (params) => createAlert(params)
            }
        ]
    });

    await reactAgent.invoke();
```

**Use Cases:**
- 📊 **Log Analysis**: Find errors & anomalies in GB-sized logs
- 🔍 **Search Results Processing**: Filter 10K+ results down to top insights
- 📄 **Document Review**: Assess contracts, policies, PDFs at scale
- 👥 **Data Segmentation**: Classify millions of records efficiently
- 🏦 **Compliance Checks**: Scan large datasets for violations

> [Read full RLM documentation with case studies](./documentation/RLMs.md) • [CodeAct Pattern](https://learn.microsoft.com/en-us/agent-framework/agents/code_act?pivots=programming-language-csharp)

> Combine RLM with ReAct agent for the best performance gains [start here](./documentation/RLMs.md#advanced-usage-rlm--react-agent)

### Skills
Skills of RavenADK are compliant with open [skills standard](https://agentskills.io/home) what is use by e.g: Claude Code, MS Copilot and likelly more
[Read more about RavenADK skills](./documentation/Skills.md). Additional skill features:

- Agent can execute skill scripts
- Skills can be downloaded from outside of the Agent - from some skill hub (beware of malicious scripts within some community skills)
- Agent can automatically create new skills if option is turn on

### Self-Improvement
RavenADK allows agents to evolve through interaction. By leveraging the **CASCADE** pattern, agents can develop their own expertise by creating and refining new skills dynamically. Additionally, the **Memory Conclusion** system recursively consolidates interaction history into durable knowledge, allowing the agent to "remember more" by abstracting specific events into general principles.

> [Check more about Self-Improvement](./documentation/Self-Improvement.md)

## Documentation
[Check Documentation](https://ravenalliance.gitbook.io/ravenalliance-docs)

## Contribution
If you would like to become official contributor [Check Guide](./CONTRIBUTION.md) contact with one of bellow channels

* [Discord](https://discord.gg/eFfVjDj7Xd)
* [email](mailto:official@ravenlens.io)
* [LinkedIn](https://www.linkedin.com/in/micha%C5%82-szczepa%C5%84ski-0476192a8/)

### Your ideas are going to be appreciated
You can openly tell your your idea in the **issues** or in the one of above specified channels
