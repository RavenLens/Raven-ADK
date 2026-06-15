# Browsing Tools

RavenADK provides a powerful set of browser automation tools based on Playwright. These tools allow agents to navigate the web, read content in various formats, capture screenshots, and analyze visual data.

## Overview

The browsing tools are designed to work together in a stateful manner. Once a browser is opened, it stays open across tool calls until explicitly closed, allowing the agent to perform complex multi-step research tasks.

### Available Tools

| Tool Name | Description | Arguments |
|-----------|-------------|-----------|
| `open_webpage` | Navigates to a specified URL. | `url: string` |
| `read_page_text` | Extracts all text content from the current page. | None |
| `read_page_html` | Retrieves the full outer HTML of the current page. | None |
| `read_page_content`| Returns text, HTML, URL, and title in a single call. | None |
| `take_snapshot` | Takes a screenshot of the page and saves it to disk. | `filename?: string` |
| `get_snapshot_base64`| Converts a saved snapshot into a base64 string. | `snapshotPath: string` |
| `is_browser_open` | Checks if the browser instance is currently running. | None |
| `close_page` | Closes the current active page/tab. | None |
| `close_browser` | Shuts down the entire browser instance and cleans up. | None |

## Using with ReActAgent

To use these tools with a `ReActAgent`, you can simply pass the tools from `BrowserToolsBucket` to the agent configuration.

```typescript
import { ReActAgent } from "@raven/adk";
import { BrowserToolsBucket } from "@raven/adk/tools/general/browser";

const agent = new ReActAgent({
    model: myModel,
    systemPrompt: "You are a research assistant...",
    tools: [
        ...BrowserToolsBucket.tools
    ],
    messages: []
});
```

### The BrowserToolsBucket

The `BrowserToolsBucket` is a pre-configured collection of tools that includes a specialized `systemPrompt`. This prompt is designed to be appended to your agent's system prompt to help it understand the best way to use the tools.

## Best Practices for Optimal Outcomes

For the best possible performance and resource management, follow these guidelines when configuring your agent:

### 1. Workflow Strategy
Instruct your agent to follow a structured workflow:
1. **Navigate**: Use `open_webpage`.
2. **Extract**: Use `read_page_content` for comprehensive data or `read_page_text` for speed.
3. **Analyze**: Let the agent reason over the extracted data.
4. **Cleanup**: Always close the browser when the task is finished.

### 2. Resource Management (Automatic Cleanup)
Playwright instances consume significant memory. It is crucial to ensure the agent closes the browser. The `BrowserToolsBucket` system prompt explicitly instructs the agent to do this. You can reinforce this in your custom system prompt:

> "Always call `close_browser` once you have extracted all the information you need and are ready to provide your final answer."

### 3. Visual Analysis
For complex UIs or debugging, use `take_snapshot` followed by `get_snapshot_base64`. If your model supports vision, you can provide the base64 string to help the agent understand the page's layout.

### 4. Error Handling
Webpages can be slow or fail to load. The browsing tools include built-in timeouts and error handling, but you should instruct your agent to handle "Observation" results that indicate failure by trying alternative selectors or URLs if possible.

## Example System Prompt Integration

When initializing your agent, combine your task-specific instructions with the `BrowserToolsBucket.systemPrompt`:

```typescript
const systemPrompt = `
You are a competitor analysis agent. Your goal is to visit the provided websites and summarize their core value propositions.

${BrowserToolsBucket.systemPrompt}
`;
```

This ensures the agent understands both its high-level goal and the technical nuances of the browsing tools it has at its disposal.
