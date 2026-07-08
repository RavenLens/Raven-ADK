import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as z from "zod";
import { Tool, tool, ToolConfig, ToolLogic } from "../tools";
import {
    MCPClientConfig,
    MCPDownloadedPrompt,
    MCPDownloadedResource,
    MCPDownloadedTool,
    MCPServerConfig,
    MCPServerTransport
} from "./types";
import { withTelemetry, recordEventWithData } from "../../../telemetry/telemetry";

interface MCPServerSession {
    config: MCPServerConfig;
    client: Client;
    transport: Transport;
    connected: boolean;
    toolsByAgentName: Map<string, MCPDownloadedTool>;
    toolsByRemoteName: Map<string, MCPDownloadedTool>;
    promptsByAgentName: Map<string, MCPDownloadedPrompt>;
    promptsByRemoteName: Map<string, MCPDownloadedPrompt>;
    resourcesByUri: Map<string, MCPDownloadedResource>;
}

interface MCPToolCallResult {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
    toolResult?: unknown;
    isError?: boolean;
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function normalizeText(value: unknown): string {
    const text = stringifyUnknown(value).trim();
    return text.length ? text : "(empty)";
}

function parseMCPContentBlock(contentBlock: unknown): string {
    if (!contentBlock || typeof contentBlock !== "object") {
        return normalizeText(contentBlock);
    }

    const block = contentBlock as Record<string, unknown>;
    const blockType = String(block.type ?? "unknown");

    if (blockType === "text") {
        return normalizeText(block.text);
    }

    if (blockType === "resource") {
        const resource = (block.resource ?? {}) as Record<string, unknown>;
        const uri = normalizeText(resource.uri ?? "unknown://resource");

        if (typeof resource.text === "string") {
            return `Resource ${uri}:\n${resource.text}`;
        }

        if (typeof resource.blob === "string") {
            return `Resource ${uri}: [binary payload omitted]`;
        }

        return `Resource ${uri}: ${normalizeText(resource)}`;
    }

    if (blockType === "resource_link") {
        const name = normalizeText(block.name ?? "Unnamed resource");
        const uri = normalizeText(block.uri ?? "unknown://resource");
        return `Resource link ${name}: ${uri}`;
    }

    if (blockType === "image") {
        const mimeType = normalizeText(block.mimeType ?? "unknown mime type");
        return `[image content: ${mimeType}]`;
    }

    if (blockType === "audio") {
        const mimeType = normalizeText(block.mimeType ?? "unknown mime type");
        return `[audio content: ${mimeType}]`;
    }

    return normalizeText(block);
}

function formatMCPToolResult(toolResult: MCPToolCallResult): string {
    const sections: string[] = [];

    if (Array.isArray(toolResult.content) && toolResult.content.length > 0) {
        const parsedContent = toolResult.content
            .map(parseMCPContentBlock)
            .filter((entry) => entry.trim().length > 0)
            .join("\n\n");

        if (parsedContent.trim().length > 0) {
            sections.push(parsedContent);
        }
    }

    if (toolResult.structuredContent !== undefined) {
        sections.push(`Structured output:\n${stringifyUnknown(toolResult.structuredContent)}`);
    }

    if (toolResult.toolResult !== undefined) {
        sections.push(normalizeText(toolResult.toolResult));
    }

    const merged = sections.filter(Boolean).join("\n\n").trim();

    if (!merged.length) {
        return "MCP tool returned no readable output.";
    }

    if (toolResult.isError) {
        return `MCP tool returned an error:\n${merged}`;
    }

    return merged;
}

function normalizeToolNameSegment(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_:\-\.]/g, "_");
}

export class MCPTool extends Tool<any, any> {
    readonly isMCPTool = true;
    readonly serverId: string;
    readonly remoteToolName: string;

    private readonly mcp: MCP;

    constructor(mcp: MCP, downloadedTool: MCPDownloadedTool) {
        super(
            async (argsObj) => mcp.callToolByAgentName(downloadedTool.agentToolName, argsObj as Record<string, unknown>),
            {
                toolName: downloadedTool.agentToolName,
                toolDescription: [
                    `MCP server: ${downloadedTool.serverName ?? downloadedTool.serverId}`,
                    `Remote MCP tool name: ${downloadedTool.remoteToolName}`,
                    downloadedTool.description,
                    `Input schema: ${stringifyUnknown(downloadedTool.inputSchema)}`,
                    downloadedTool.outputSchema ? `Output schema: ${stringifyUnknown(downloadedTool.outputSchema)}` : ""
                ]
                    .filter((line) => line && line.trim().length > 0)
                    .join("\n"),
                // The exact JSON schema is described in toolDescription. Runtime stays permissive.
                toolArguments: z.object({}).passthrough()
            }
        );

        this.mcp = mcp;
        this.serverId = downloadedTool.serverId;
        this.remoteToolName = downloadedTool.remoteToolName;
    }

    async invokeFromMCP(args: Record<string, unknown>): Promise<string> {
        return this.mcp.callTool(this.serverId, this.remoteToolName, args);
    }
}

export class MCP {
    private readonly config: Required<MCPClientConfig>;
    private readonly servers = new Map<string, MCPServerSession>();
    private readonly toolsByAgentName = new Map<string, MCPDownloadedTool>();
    private readonly promptsByAgentName = new Map<string, MCPDownloadedPrompt>();
    private readonly resourcesByUri = new Map<string, MCPDownloadedResource>();

    constructor(config?: MCPClientConfig) {
        this.config = {
            clientName: config?.clientName ?? "raven-adk-mcp-client",
            clientVersion: config?.clientVersion ?? "1.0.0",
            toolNameDelimiter: config?.toolNameDelimiter ?? "::"
        };
    }

    private createTransport(transportConfig: MCPServerTransport): Transport {
        switch (transportConfig.protocol) {
            case "stdio":
            case "ipc":
                return new StdioClientTransport({
                    command: transportConfig.command,
                    args: transportConfig.args,
                    env: transportConfig.env,
                    cwd: transportConfig.cwd,
                    stderr: transportConfig.stderr
                });
            case "sse":
                return new SSEClientTransport(new URL(transportConfig.url), transportConfig.options);
            case "streamable-http":
            case "http":
                return new StreamableHTTPClientTransport(new URL(transportConfig.url), transportConfig.options);
            case "websocket":
            case "ws":
            case "wss":
                return new WebSocketClientTransport(new URL(transportConfig.url));
            default:
                throw new Error(`Unsupported MCP transport protocol: ${(transportConfig as { protocol?: string }).protocol ?? "unknown"}`);
        }
    }

    private makeAgentToolName(serverId: string, remoteToolName: string): string {
        const normalizedServerId = normalizeToolNameSegment(serverId);
        const normalizedRemoteName = normalizeToolNameSegment(remoteToolName);
        return `${normalizedServerId}${this.config.toolNameDelimiter}${normalizedRemoteName}`;
    }

    private getServerSession(serverId: string): MCPServerSession {
        const session = this.servers.get(serverId);

        if (!session || !session.connected) {
            throw new Error(`MCP server '${serverId}' is not connected.`);
        }

        return session;
    }

    async connect(serverConfig: MCPServerConfig): Promise<void> {
        if (!serverConfig.serverId.trim()) {
            throw new Error("MCP serverId cannot be empty.");
        }

        if (this.servers.has(serverConfig.serverId)) {
            await this.disconnect(serverConfig.serverId);
        }

        const client = new Client(
            {
                name: this.config.clientName,
                version: this.config.clientVersion
            },
            {
                capabilities: {}
            }
        );
        const transport = this.createTransport(serverConfig.transport);

        recordEventWithData("mcp.connection", JSON.stringify(serverConfig, null, 4));

        await client.connect(transport);

        this.servers.set(serverConfig.serverId, {
            config: serverConfig,
            client,
            transport,
            connected: true,
            toolsByAgentName: new Map(),
            toolsByRemoteName: new Map(),
            promptsByAgentName: new Map(),
            promptsByRemoteName: new Map(),
            resourcesByUri: new Map()
        });
    }

    async connectMany(serverConfigs: MCPServerConfig[]): Promise<void> {
        recordEventWithData("mcp.connect_many", JSON.stringify(serverConfigs, null, 4));
        
        for (const serverConfig of serverConfigs) {
            await this.connect(serverConfig);
        }
    }

    async disconnect(serverId: string): Promise<void> {
        const session = this.servers.get(serverId);

        if (!session) {
            return;
        }

        session.connected = false;

        session.toolsByAgentName.forEach((tool) => {
            this.toolsByAgentName.delete(tool.agentToolName);
        });

        session.promptsByAgentName.forEach((prompt) => {
            this.promptsByAgentName.delete(prompt.agentPromptName);
        });

        session.resourcesByUri.forEach((resource) => {
            this.resourcesByUri.delete(resource.uri);
        });

        session.toolsByAgentName.clear();
        session.toolsByRemoteName.clear();
        session.promptsByAgentName.clear();
        session.promptsByRemoteName.clear();
        session.resourcesByUri.clear();

        try {
            await session.client.close();
        } finally {
            this.servers.delete(serverId);
            recordEventWithData("mcp.disconnection", JSON.stringify({}));
        }
    }

    async disconnectAll(): Promise<void> {
        recordEventWithData("mcp.disconnect_many", JSON.stringify({}, null, 4));
        
        const connectedServerIds: string[] = [];
        this.servers.forEach((_, serverId) => {
            connectedServerIds.push(serverId);
        });

        for (const serverId of connectedServerIds) {
            await this.disconnect(serverId);
        }
    }

    async downloadTools(serverId: string): Promise<MCPDownloadedTool[]> {
        return withTelemetry("mcp.download_tools", { serverId }, async (span) => {
            const session = this.getServerSession(serverId);
            const downloadedTools: MCPDownloadedTool[] = [];

            let cursor: string | undefined;

            span?.setAttribute("server_id", serverId);

            do {
                const response = await session.client.listTools(cursor ? { cursor } : undefined);

                for (const remoteTool of response.tools) {
                    const remoteName = String(remoteTool.name);
                    const agentToolName = this.makeAgentToolName(serverId, remoteName);
                    const downloadedTool: MCPDownloadedTool = {
                        serverId,
                        serverName: session.config.serverName,
                        remoteToolName: remoteName,
                        agentToolName,
                        description: remoteTool.description ?? "MCP tool without description.",
                        inputSchema: remoteTool.inputSchema ?? {},
                        outputSchema: remoteTool.outputSchema
                    };

                    session.toolsByAgentName.set(agentToolName, downloadedTool);
                    session.toolsByRemoteName.set(remoteName, downloadedTool);
                    this.toolsByAgentName.set(agentToolName, downloadedTool);
                    downloadedTools.push(downloadedTool);
                }

                cursor = response.nextCursor;
            } while (cursor);

            span?.setAttribute("mcp.downloaded_tools_count", downloadedTools.length);
            span?.addEvent("mcp.tools_downloaded", {
                toolsCount: downloadedTools.length,
                tools: JSON.stringify(downloadedTools.map((t) => t.remoteToolName))
            });
            return downloadedTools;
        });
    }

    async downloadToolsFromAllServers(): Promise<MCPDownloadedTool[]> {
        return withTelemetry("mcp.download_all_tools", {}, async (span) => {
            const allTools: MCPDownloadedTool[] = [];

            const serverIds: string[] = [];
            this.servers.forEach((_, serverId) => {
                serverIds.push(serverId);
            });
            span?.setAttribute("servers_id", serverIds);

            for (const serverId of serverIds) {
                const downloaded = await this.downloadTools(serverId);
                allTools.push(...downloaded);
            }

            span?.setAttribute("mcp.total_downloaded_tools", allTools.length);
            return allTools;
        });
    }

    async downloadPrompts(serverId: string): Promise<MCPDownloadedPrompt[]> {
        return withTelemetry("mcp.download_prompts", { serverId }, async (span) => {
            const session = this.getServerSession(serverId);
            const downloadedPrompts: MCPDownloadedPrompt[] = [];
            let cursor: string | undefined;
    
            span?.setAttribute("server_id", serverId);
            
            do {
                const response = await session.client.listPrompts(cursor ? { cursor } : undefined);
                span.addEvent("mcp.list_prompts_response", {
                    response: JSON.stringify(response, null, 4).substring(0, 5000)
                });
    
                for (const remotePrompt of response.prompts) {
                    const remoteName = String(remotePrompt.name);
                    const agentPromptName = this.makeAgentToolName(serverId, remoteName);
                    const downloadedPrompt: MCPDownloadedPrompt = {
                        serverId,
                        serverName: session.config.serverName,
                        remotePromptName: remoteName,
                        agentPromptName,
                        description: remotePrompt.description,
                        arguments: remotePrompt.arguments?.map(arg => ({
                            name: arg.name,
                            description: arg.description,
                            required: arg.required
                        }))
                    };
    
                    session.promptsByAgentName.set(agentPromptName, downloadedPrompt);
                    session.promptsByRemoteName.set(remoteName, downloadedPrompt);
                    this.promptsByAgentName.set(agentPromptName, downloadedPrompt);
                    downloadedPrompts.push(downloadedPrompt);
                }
    
                cursor = response.nextCursor;
            } while (cursor);

            span.addEvent("mcp.prompts_downloaded", {
                count: downloadedPrompts.length,
                prompts: JSON.stringify(downloadedPrompts, null, 4).substring(0, 5000)
            });
    
            return downloadedPrompts;
        })
    }

    async downloadPromptsFromAllServers(): Promise<MCPDownloadedPrompt[]> {
        return withTelemetry("mcp.download_prompts_from_all_servers", {}, async (span) => {
            const allPrompts: MCPDownloadedPrompt[] = [];
            const serverIds = Array.from(this.servers.keys());
            span?.setAttribute("servers_id", serverIds);
            
            for (const serverId of serverIds) {
                allPrompts.push(...(await this.downloadPrompts(serverId)));
            }

            return allPrompts;
        })
    }

    async downloadResources(serverId: string): Promise<MCPDownloadedResource[]> {
        return withTelemetry("mcp.download_resources", {}, async (span) => {
            const session = this.getServerSession(serverId);
            const downloadedResources: MCPDownloadedResource[] = [];
            let cursor: string | undefined;

            span?.setAttribute("server_id", serverId);
    
            do {
                const response = await session.client.listResources(cursor ? { cursor } : undefined);
                span.addEvent("mcp.list_resources_response", {
                    response: JSON.stringify(response, null, 4).substring(0, 5000)
                });
    
                for (const remoteResource of response.resources) {
                    const downloadedResource: MCPDownloadedResource = {
                        serverId,
                        serverName: session.config.serverName,
                        remoteResourceName: remoteResource.name,
                        uri: remoteResource.uri,
                        description: remoteResource.description,
                        mimeType: remoteResource.mimeType
                    };
    
                    session.resourcesByUri.set(remoteResource.uri, downloadedResource);
                    this.resourcesByUri.set(remoteResource.uri, downloadedResource);
                    downloadedResources.push(downloadedResource);
                }
    
                cursor = response.nextCursor;
            } while (cursor);

            span.addEvent("mcp.resources_downloaded", {
                count: downloadedResources.length,
                resources: JSON.stringify(downloadedResources, null, 4).substring(0, 5000)
            });
    
            return downloadedResources;
        });
    }

    async downloadResourcesFromAllServers(): Promise<MCPDownloadedResource[]> {
        return withTelemetry("mcp.download_resources_from_all_servers", {}, async (span) => {
            const allResources: MCPDownloadedResource[] = [];
            const serverIds = Array.from(this.servers.keys());

            span?.setAttribute("servers_id", serverIds);

            for (const serverId of serverIds) {
                allResources.push(...(await this.downloadResources(serverId)));
            }

            span.addEvent("mcp.all_resources_downloaded", {
                totalCount: allResources.length
            });

            return allResources;
        })
    }

    getDownloadedPrompts(): MCPDownloadedPrompt[] {
        return Array.from(this.promptsByAgentName.values());
    }

    getDownloadedResources(): MCPDownloadedResource[] {
        return Array.from(this.resourcesByUri.values());
    }

    async getPrompt(serverId: string, promptName: string, args?: Record<string, string>): Promise<string> {
        const session = this.getServerSession(serverId);
        const response = await session.client.getPrompt({
            name: promptName,
            arguments: args
        });

        return response.messages.map(m => {
            const content = m.content;
            if (content.type === "text") return `${m.role.toUpperCase()}: ${content.text}`;
            return `${m.role.toUpperCase()}: [${content.type} content]`;
        }).join("\n\n");
    }

    async readResource(serverId: string, resourceUri: string): Promise<string> {
        const session = this.getServerSession(serverId);
        const response = await session.client.readResource({ uri: resourceUri });

        return response.contents.map(c => {
            if ("text" in c) return c.text;
            if ("blob" in c) return `[binary data (${c.mimeType ?? "unknown"})]`;
            return "[unknown resource content]";
        }).join("\n\n");
    }

    getDownloadedTools(serverId?: string): MCPDownloadedTool[] {
        if (serverId) {
            const session = this.getServerSession(serverId);
            const tools: MCPDownloadedTool[] = [];
            session.toolsByAgentName.forEach((tool) => {
                tools.push(tool);
            });
            return tools;
        }

        const tools: MCPDownloadedTool[] = [];
        this.toolsByAgentName.forEach((tool) => {
            tools.push(tool);
        });
        return tools;
    }

    getToolsAsAgentTools(serverId?: string): MCPTool[] {
        return this.getDownloadedTools(serverId).map((downloadedTool) => new MCPTool(this, downloadedTool));
    }

    async callTool(serverId: string, remoteToolName: string, args?: Record<string, unknown>): Promise<string> {
        return withTelemetry("mcp.call_tool", { serverId, remoteToolName }, async (span) => {
            const session = this.getServerSession(serverId);
            
            span.setAttribute("mcp.server_id", serverId);
            span.setAttribute("mcp.tool_name", remoteToolName);
            span.setAttribute("mcp.tool_args", JSON.stringify(args ?? {}, null, 4));

            const tool = session.toolsByRemoteName.get(remoteToolName);
            if (!tool) {
                throw new Error(
                    `MCP tool '${remoteToolName}' is not downloaded for server '${serverId}'. Run downloadTools('${serverId}') first.`
                );
            }

            const result = await session.client.callTool({
                name: remoteToolName,
                arguments: args ?? {}
            });

            const formattedResult = formatMCPToolResult(result as MCPToolCallResult);

            span?.addEvent("mcp.tool_execution_result", {
                isError: (result as MCPToolCallResult).isError ?? false,
                result: formattedResult.length > 5000 ? formattedResult.substring(0, 5000) + "... [truncated]" : formattedResult
            });

            return formattedResult;
        });
    }

    async callToolByAgentName(agentToolName: string, args?: Record<string, unknown>): Promise<string> {
        const tool = this.toolsByAgentName.get(agentToolName);

        if (!tool) {
            throw new Error(`MCP tool '${agentToolName}' is unknown. Run downloadTools(...) and pass getToolsAsAgentTools() to agentConfig.tools.`);
        }

        return this.callTool(tool.serverId, tool.remoteToolName, args);
    }

    private registerTelemetryToolDiscoveryCall(
        { toolName, args, config }: {
            toolName: string;
            args: Record<string, any>;
            config?: ToolConfig<any, any>;
        },
        logic: ToolLogic<any, any>
    ) {
        return withTelemetry("mcp.discovery_tool_call", { toolName, args, config }, async (span) => {
            span.setAttribute("mcp.tool_name", toolName);
            span.setAttribute("mcp.tool_args", JSON.stringify(args ?? {}, null, 4));

            const output = await logic(args, config);

            span.addEvent("mcp.discovery_tool_call_result", {
                result: output.length > 5000 ? output.substring(0, 5000) + "... [truncated]" : output
            });
            
            return output;
        });
    }
    
    /**
     * Returns a set of tools that allow the agent to discover and use MCP prompts and resources.
     */
    getDiscoveryTools(): Tool<any, any>[] {
        return [
            tool(
                async (args, config) => {
                    return this.registerTelemetryToolDiscoveryCall(
                        { toolName: config?.toolName ?? "unknown_(tool_name)", config, args },
                        async (args, config) => {
                            const tools = this.getDownloadedTools().map(t => `- Tool: ${t.agentToolName} (${t.description})`).join("\n");
                            const prompts = this.getDownloadedPrompts().map(p => `- Prompt: ${p.agentPromptName} (${p.description ?? "No description"})\n  Arguments: ${p.arguments?.map(a => `${a.name}${a.required ? "*" : ""}`).join(", ") ?? "None"}`).join("\n");
                            const resources = this.getDownloadedResources().map(r => `- Resource: ${r.uri} (${r.remoteResourceName}) - ${r.description ?? "No description"}`).join("\n");
        
                            return `### MCP Discovery Report\n\n#### Tools\n${tools || "None"}\n\n#### Prompts\n${prompts || "None"}\n\n#### Resources\n${resources || "None"}`;
                        }
                    );
                },
                {
                    toolName: "mcp_list_capabilities",
                    toolDescription: "Lists all available MCP tools, prompts, and resources from connected servers.",
                    toolArguments: z.object({})
                }
            ),
            tool(
                async (params, config) => {
                    return this.registerTelemetryToolDiscoveryCall(
                        { toolName: config?.toolName ?? "unknown_(tool_name)", config, args: params },
                        async ({ agentPromptName, arguments: args }) => {
                            const prompt = this.promptsByAgentName.get(agentPromptName);
                            
                            if (!prompt) return `Error: Prompt ${agentPromptName} not found.`;
                            
                            return this.getPrompt(prompt.serverId, prompt.remotePromptName, args as Record<string, string>);
                        }
                    );
                },
                {
                    toolName: "mcp_get_prompt",
                    toolDescription: "Gets the content of a specific MCP prompt template.",
                    toolArguments: z.object({
                        agentPromptName: z.string().describe("The name of the prompt returned by mcp_list_capabilities"),
                        arguments: z.record(z.string(), z.string()).optional().describe("Prompt arguments as key-value pairs")
                    })
                }
            ),
            tool(
                async (params, config) => {
                    return this.registerTelemetryToolDiscoveryCall(
                        { toolName: config?.toolName ?? "unknown_(tool_name)", config, args: params },
                        async ({ uri }) => {
                            const resource = this.resourcesByUri.get(uri);
                            
                            if (!resource) return `Error: Resource with URI ${uri} not found.`;

                            return this.readResource(resource.serverId, resource.uri);
                        }
                    );
                },
                {
                    toolName: "mcp_read_resource",
                    toolDescription: "Reads the content of an MCP resource by its URI.",
                    toolArguments: z.object({
                        uri: z.string().describe("The URI of the resource to read")
                    })
                }
            )
        ];
    }
}
