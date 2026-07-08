# MCP (Model Context Protocol)

RavenADK includes MCP support based on the official [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro) SDK.

With this integration you can:

- Connect to local MCP servers (stdio/ipc)
- Connect to remote MCP servers (sse, streamable-http/http, websocket)
- Download server tools dynamically
- Download and use MCP Prompts and Resources
- Convert downloaded MCP tools into RavenADK Tool instances
- Use discovery tools to allow the agent to explore all MCP capabilities (Tools, Prompts, Resources) at runtime
- Pass those tools directly into ReActAgent
- Execute MCP tools from the ReAct tool loop automatically

## How It Works

1. Create an MCP manager instance.
2. Connect one or many MCP servers.
3. Download tools, prompts, and resources exposed by connected servers.
4. (Optional) Get discovery tools so the agent can browse and read prompts/resources.
5. Convert downloaded tools to agent-compatible tools.
6. Pass those tools to ReActAgent in agentConfig.tools.
7. Invoke the agent. If the model picks an MCP tool, ReActAgent calls MCP under the hood.

## Does it ship Telemetry?
- Yes
- Usage of each MCP Tool and discovering the context, prompts and resources is registered as OpenTelemetry Span and huge data like tool attrs and output are saved as OLTP events
- Size of tool output is limited to 5000 characters to avoid stiff backend limits in terms of Jaeger, HoneyComb are between `64-128Kb` for *entire span*
- Thanks to this implementation you have fine-grained control over what your AI Agent/AI Autonomous system is doing


## Step-by-Step Setup

### Step 1: Initialize MCP
... existing code ...
### Step 2: Connect MCP Servers
... existing code ...
### Step 3: Download Capabilities

To use MCP effectively, you should download tools, prompts, and resources.

```typescript
// Download everything
await mcp.downloadToolsFromAllServers();
await mcp.downloadPromptsFromAllServers();
await mcp.downloadResourcesFromAllServers();

// Standard tools (Executable)
const mcpTools = mcp.getToolsAsAgentTools();

// Discovery tools (For Browsing Prompts/Resources)
const discoveryTools = mcp.getDiscoveryTools();
```

### Step 4: Pass MCP Tools to ReActAgent

By passing both standard tools and discovery tools, the agent can both execute functions and read external context (Resources) or follow prompt templates.

```typescript
import { ReActAgent } from "./src/agent/ReAct.agent";
import { OpenAI } from "./src/models/openai";

const model = new OpenAI({
	model: "gpt-5.1",
	apiKey: process.env.OPENAI_API_KEY,
	tools: [],
	messages: []
});

const agent = new ReActAgent({
	model,
	systemPrompt: "You are an assistant with access to MCP servers. Use mcp_list_capabilities to see what is available.",
	tools: [
		...mcpTools,       // serverId::toolName
		...discoveryTools // mcp_list_capabilities, mcp_get_prompt, mcp_read_resource
	]
});

const result = await agent.invoke();
console.log(result.messages.at(-1));
```

## Using Prompts and Resources

When `mcp.getDiscoveryTools()` is used, the agent receives three specialized tools:

1.  **`mcp_list_capabilities`**: Returns a tree of all available tools, prompts (with their arguments), and resource URIs.
2.  **`mcp_get_prompt`**: Allows the agent to fetch a specific prompt template by name.
3.  **`mcp_read_resource`**: Allows the agent to fetch the content of a resource (e.g., a file, log, or database entry) by its URI.

This allows the `ReActAgent` to behave as a **Reasoning Agent** that fetches context only when necessary, rather than cramming all data into the initial context window.

## Full Example (Advanced Discovery Flow)

```typescript
import { MCP } from "@ravenlens/raven-adk/tools/mcp";
import { ReActAgent } from "./src/agent/ReAct.agent";
import { OpenAI } from "./src/models/openai";

async function run() {
	const mcp = new MCP({ clientName: "thinking-agent", clientVersion: "1.0.0" });

	// Connect to a server that provides tools, prompts AND resources
	await mcp.connect({
		serverId: "my-data-server",
		transport: {
			protocol: "stdio",
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-everything"]
		}
	});

	// populate internal maps
	await mcp.downloadToolsFromAllServers();
	await mcp.downloadPromptsFromAllServers();
	await mcp.downloadResourcesFromAllServers();

	const model = new OpenAI({
		model: "gpt-5.1",
		apiKey: process.env.OPENAI_API_KEY,
		tools: [],
		messages: []
	});

	const agent = new ReActAgent({
		model,
		systemPrompt: "You are a thinking agent. Use mcp_list_capabilities to explore available data/prompts.",
		messages: [{ type: "user", content: "What is available in the MCP server? If there is a documentation resource, read it." }],
		tools: [
			...mcp.getToolsAsAgentTools(),
			...mcp.getDiscoveryTools()
		]
	});

	const result = await agent.invoke();
	console.log(result.messages.at(-1));

	await mcp.disconnectAll();
}

run().catch(console.error);
```

## Runtime Behavior in ReActAgent
... existing code ...
## Naming Convention
... existing code ...
## Useful MCP Methods

- connect(serverConfig): connect one server
- connectMany(serverConfigs): connect many servers
- downloadTools(serverId): pull tools from one server
- downloadPrompts(serverId): pull prompts from one server
- downloadResources(serverId): pull resource URIs from one server
- downloadToolsFromAllServers(): pull tools from all connected servers
- downloadPromptsFromAllServers(): pull prompts from all connected servers
- downloadResourcesFromAllServers(): pull resources from all connected servers
- getToolsAsAgentTools(serverId?): get Tool[] compatible with ReActAgent
- getDiscoveryTools(): get tools for runtime exploration (list/read prompts/resources)
- callTool(serverId, remoteToolName, args?): call a specific remote tool
- getPrompt(serverId, promptName, args?): get template content
- readResource(serverId, resourceUri): get resource content
- disconnectAll(): close all connections

## Tips

- Always call downloadTools(...) before passing tools to ReActAgent.
- Re-download tools when server capabilities change.
- If you connect many servers, use unique serverId values.


