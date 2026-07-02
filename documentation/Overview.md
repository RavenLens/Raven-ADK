# Overview

RavenADK is an open-source **Agent Development Kit** designed to support sophisticated AI-Agent development initiatives. Built natively for JavaScript/TypeScript environments, it focuses on high-performance agentic patterns, event-driven architecture, and a seamless developer experience for building agentic UX.

## Core Philosophy

- **Native Agentic Patterns**: Support for SOTA patterns like ReAct (Reason + Act) and RLMs (Recursive Language Modeling) out of the box.
- **Event-Driven Architecture**: Every action taken by the library can be captured as an event, making it easy to build real-time, transparent UIs that show what the agent is thinking and doing.
- **Extensibility**: A plugin-based system and open interfaces for models, memory stores, and skills.
- **SOTA Performance**: Built for parallel tool and subagent execution, optimizing for both speed and cost.

## Key Components

### 1. ReAct Agent
A standalone agent following the ReAct loop. It supports parallel tool execution, parallel subagents, and advanced reasoning recalls. [Read more](./ReAct-Agent.md).

### 2. RLMs (Recursive Language Models)
A recursive approach to processing large sets of text, significantly increasing accuracy while reducing costs by breakdown tasks into smaller, manageable chunks. [Read more](./RLMs.md).

### 3. Tree-of-Thoughts (ToT)
An advanced reasoning pattern that allows agents to explore multiple solution branches, evaluate them in parallel, and backtrack when necessary. [Read more](./chains/Tree-of-Thoughts%20(ToT).md).

### 4. Graph
A powerful graph-based execution engine that allows you to define custom workflows and complex agentic logic using nodes and edges. [Read more](./Graph.md).

### 5. Memory
Native support for persistent memory stores (like ChromaDB) that allow agents to remember interactions and user preferences across sessions. [Read more](./Memory.md).

### 6. Skills
Dynamic capability enhancement via the Skills system. Agents can explore and apply new skills on the fly. [Read more](./Skills.md).

### 7. MCP (Model Context Protocol)
Integration with the Model Context Protocol, allowing agents to use a standard interface for accessing external data and tools. [Read more](./MCP.md).

### 8. HITL (Human-In-The-Loop)
Built-in support for pausing agent execution to ask for human approval or clarification, essential for risky or ambiguous tasks. [Read more](./HITL.md).

### 9. Sandboxes
Secure and isolated environments for code execution, designed to be used by RLM and ReAct tools. [Read more](./Sandbox.md).

## Why RavenADK?

RavenADK is designed for developers who want to build *production-grade* AI agents that are not just smart, but also fast and transparent. By exposing the agent's internal reasoning and actions through a robust event system, developers can create user experiences that feel alive and reliable.

---

[Get Started with the Quickstart Guide](./Quickstart.md)
)