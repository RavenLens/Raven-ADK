# TODO Plugin

The `TODO-Plugin` for RavenADK provides a robust way for ReAct Agents to manage and track the completion of tasks during a conversation. It leverages specialized tools for task management and a strict **Operational Protocol** injected into the agent's system prompt to ensure high behavioral fidelity and task resolution.

## How it Works

The plugin operates during both the initialization and completion phases of the agent:

### Initialization (`before_agent_run`)
When the agent starts, the plugin:
- **Injects Tools**: Adds `update_todo_list` and `get_todo_list_points` to the agent's toolset.
- **Protocol Injection**: Injects a "TODO List Management Protocol" into the system prompt. This protocol forces the agent to call the tools frequently, update status immediately upon changes, and prioritize the resolution of all points.
- **Context Injection**: Updates the system prompt with the current live state of the TODO list from storage.

### Completion & Resolution Struggle (`after_agent_run`)
If the `struggleForAccomplishementRetries` parameter is provided, the plugin performs an audit after the agent finishes its run:
- **Unfinished Task Detection**: It checks `todoStorage` for any tasks not marked as `done`.
- **Struggle Respawn**: If tasks remain, it respawns a clean `ReActAgent` instance with a specialized "Struggle Protocol" and the previous conversation history.
- **Structured Reasoning**: The respawned agent is forced to produce a structured output. If it still cannot finish the tasks, it must provide a detailed `unresolvedTasksReason`.
- **Event Notification**: Upon completion of the struggle phase, it emits an event via the internal `TODOPluginEventEmitter`.

## Key Features

- **Autonomous Management**: Unlike passive tracking, the plugin empowers the agent to be the "owner" of the task list, using tools to reflect its actual progress.
- **Subagent Transparency**: The main agent uses the same tools to delegate and track work performed by subagents, maintaining a unified source of truth.
- **Shared Storage**: Uses a simple JavaScript structure (`TodoStoreSchemaTS[]`) allowing for seamless integration with in-memory states or persistent databases.
- **Resolution Commitment**: The struggle mechanism ensures that the agent doesn't just "give up" but makes a dedicated final attempt to reach a 100% completion rate or explains why it's impossible.

## Events

The plugin exports a `TODOPluginEventEmitter` that allows the host application to react to the resolution process.

### `todo_struggle_finished`
Emitted after the "struggle" phase completes (only if retries were configured).
- **Payload**: `{ unresolvedTasksReason: string, todoPoints: TodoPoint[] }`

## Scenarios

### Project Management
Use the plugin to let the agent break down a complex user request into actionable steps. The agent can then work through these steps one-by-one, providing progress updates to the user.

### Long-Running Tasks
In complex workflows involving multiple tools or subagents, the TODO list acts as the "source of truth," preventing the agent from repeating work or losing track of the goal.

## Usage Example

The following snippet shows how to register the TODO plugin with retry logic and listen for the struggle result.

```typescript
import { ReActAgent, OpenAI } from "@raven-adk/core";
import { createTodoPlugin, TodoStoreSchemaTS, TODOPluginEventEmitter } from "@raven-adk/plugins/todo";

// 1. Initialize shared storage
const todoStorage: TodoStoreSchemaTS[] = [{ todoPoints: [] }];

// 2. Setup the model
const model = new OpenAI({
    model: "gpt-5-mini",
    apiKey: process.env.OPENAI_API_KEY
});

// 3. Create the plugin with 3 retries for the "struggle" phase
const todoPlugin = createTodoPlugin(todoStorage, 3);

// 4. Listen for the struggle result (if agent fails to finish tasks)
TODOPluginEventEmitter.on("todo_struggle_finished", (data) => {
    console.log("Struggle result reason:", data.unresolvedTasksReason);
    console.log("Final task states:", data.todoPoints);
});

// 5. Initialize the Agent
const agent = new ReActAgent({
    model,
    systemPrompt: "You are a professional project coordinator.",
    plugins: [todoPlugin],
    subagents: [
        {
            role: "Research Assistant",
            roleDescription: "Performs deep research on requested topics.",
            model,
            systemPrompt: "Focus on technical accuracy.",
            tools: []
        }
    ],
    tools: [],
    messages: [
        {
            type: "user",
            content: "I need to plan a trip to Mars. Create a TODO list and delegate research to your assistant."
        }
    ]
});

// Run the agent
const result = await agent.invoke();
console.log("Run finished.");
```

## Tools Reference

### `update_todo_list`
Used by the agent to manually add, remove, or modify tasks. 
- **Arguments**: `todoPoints` (Array of `name`, `description`, `state`).

### `get_todo_list_points`
Allows the agent to retrieve the most recent version of the task list.
- **Arguments**: None.

## Listening the updates
If you would like to listen the tools are executing use `tool_executed` to match the todo tools names and stream to user proper event [check todo tools](./Todo-Plugin.md#tools-reference)
