# TODO Plugin

The `TODO-Plugin` for RavenADK provides a robust way for ReAct Agents to manage, track, and automatically verify the completion of tasks during a conversation. It leverages a combination of specialized tools for task management and a background "verifier" logic that scans message history to update the state of your project.

## How it Works

The plugin operates in two primary phases within the ReAct loop:

### 1. Initialization (`before_agent_run`)
When the agent starts, the plugin:
- **Injects Tools**: Adds `update_todo_list` and `get_todo_list_points` to the agent's toolset.
- **Context Injection**: Modifies the system prompt to include the current state of the TODO list, ensuring the agent is always aware of what remains to be done.

### 2. Verification (`after_model_call`)
After every model call (whether from the main agent or a subagent):
- **Automated Check**: The plugin uses the configured `AgentModel` (or the agent's own model) to evaluate the conversation history.
- **State Synchronization**: It identifies which tasks have been completed based on the dialogue and automatically marks them as `done` in the shared storage.

## Key Features

- **Subagent Support**: Tasks assigned to or completed by subagents are automatically tracked and verified.
- **Shared Storage**: Uses a simple JavaScript object (`TodoStoreSchemaTS[]`) as storage, allowing for easy persistence or integration with external databases.
- **Structured Verification**: Uses structured output to ensure the verification process is consistent and accurate.

## Scenarios

### Project Management
Use the plugin to let the agent break down a complex user request into actionable steps. The agent can then work through these steps one-by-one, providing progress updates to the user.

### Long-Running Tasks
In complex workflows involving multiple tools or subagents, the TODO list acts as the "source of truth," preventing the agent from repeating work or losing track of the goal.

## Usage Example

The following snippet shows how to register the TODO plugin and use it with a subagent.

```typescript
import { ReActAgent, OpenAI } from "@raven-adk/core";
import { createTodoPlugin, TodoStoreSchemaTS } from "@raven-adk/plugins/todo";

// 1. Initialize shared storage
const todoStorage: TodoStoreSchemaTS[] = [{ todoPoints: [] }];

// 2. Setup the model
const model = new OpenAI({
    model: "gpt-5-mini",
    apiKey: process.env.OPENAI_API_KEY
});

// 3. Create the plugin
const todoPlugin = createTodoPlugin(todoStorage);

// 4. Initialize the Agent
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
console.log("Final TODO State:", todoStorage[0].todoPoints);
```

## Tools Reference

### `update_todo_list`
Used by the agent to manually add, remove, or modify tasks. 
- **Arguments**: `todoPoints` (Array of `name`, `description`, `state`).

### `get_todo_list_points`
Allows the agent to retrieve the most recent version of the task list.
- **Arguments**: None.

