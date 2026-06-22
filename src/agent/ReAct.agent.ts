import { Graph, GraphMarkers } from "../graph";
import { Anthropic } from "../models/anthropic";
import { LLMAnswer } from "../models/mutual";
import { OpenAI } from "../models/openai";
import { Google } from "../models/google";
import { SchemaMemoryStore } from "./memory/stores/schema";
import { Memory as MemoryInterface } from "./memory/memory";
import { SchemaSkillStore } from "./skills/stores/schema";
import { AgentMessagesGraphState, MessagesVariations, ToolMessage } from "./state";
import { SkillEventNames, SkillEvents, Skills as SkillsInterface } from "./skills/skills";
import { MCPTool } from "./tools/mcp/mcpTools";
import { Tool } from "./tools/tools";
import { HITLSocketIo } from "./tools/hitl/trasnports/SocketIoHITLTrasnport";
import { RunPod } from "../models/runpod";
import z from "zod";

export type AgentModel = OpenAI | Anthropic | RunPod | Google;

export type SubAgent = Pick<ReActAgentConfig<any, any>, "model" | "systemPrompt" | "tools"> & {
    role: string;
    roleDescription: string;
}

/**
 * Possible ways of execution for ReAct Agent
 * 
 * List with description:
 * * before_agent_run - runs before agent start its execution. Ideal place to modify agent condifuration or graphState
 * * after_agent_run  - runs after agent has finish its execution. Ideal place to sumup its execution
 * * before_model_call - runs before the master and subagents model was launched
 * * after_model_call - runs after the master and subagents model has finished its run
 */
export type PluginExecutionWays = "before_agent_run" | "after_agent_run" | "before_model_call" | "after_model_call";

export interface ExecutionFrom {
    way: PluginExecutionWays;
    nodeType: "main" | "subagent" | "aside";
    /**
     * For main_node the value is "main_node",
     * For subagent node the value is "subagent.role" so role name of subagent
     */
    nodeName?: string;
    nodeModel?: AgentModel;
}

export interface ReActAgentPluginSpec {
    /** It's a plugin name */
    name: string;
    /** 
     * It's a place where agent is going to be execute
     * TODO: Deliver more plugin execution places: after_tool_execution, "before_tool_execution"
    */
    executionWay: PluginExecutionWays | PluginExecutionWays[];
    /**
     * Runs the plugin logic 
     * @param executionPlace - it's singular place from where execution happens - it can be singular atime
     * @returns Execution status and changed/unchanged state of agent is assigned in place of prior state, When success is `false` then doesn't use a result to override the agent state
    */
    execute<Skills extends SchemaSkillStore, Memory extends SchemaMemoryStore>(
        executionFrom: ExecutionFrom,
        agentConfig: ReActAgentConfig<Skills, Memory>,
        graphState: AgentMessagesGraphState
    ): Promise<{
        /** Status of plugin execution */
        status: boolean;
        /** Result of plugin execution. Overrides original 'entry' state only when `status === true` */
        result?: {
            agentConfig?: ReActAgentConfig<Skills, Memory>;
            graphState?: AgentMessagesGraphState;
        };
    }>;
}

export interface ReActAgentConfig<Skills extends SchemaSkillStore, Memory extends SchemaMemoryStore> {
    model: AgentModel;
    systemPrompt: string;
    messages: MessagesVariations[];
    /**
     * Skills is the set of skills the agent can use to perform some action
     * In CASCADE (https://arxiv.org/abs/2512.23880) scenario -> agent can develop his own skills
    */
    skills?: Skills;
    /**
     * It's the agent memory he developed for specific user session or for organization
    */
    memory?: Memory;
    /** It's list with agent plugins are going to be execute and can */
    plugins?: ReActAgentPluginSpec[];
    tools: Tool<any, any>[];
    /** specify this schema to use the Human In The Loop */
    hitl?: HITLSocketIo;
    /** Subagents definition */
    subagents?: SubAgent[];
    /** Maximum amount of internal self-recalls without tool usage. Defaults to 3 when omitted. */
    maximumReasoningRecalls?: number;
    /** As default is `true` boolean */
    withConclusion?: boolean;
    /** As default is `false` boolean */
    parallelizeSubagents?: boolean;
    /** As default is `false` boolean */
    parallelTools?: boolean;
}

interface ReActAgentEvents extends SkillEvents {
    llm_result: (result: LLMAnswer) => void | Promise<void>;
    tool_invoked: (toolName: string, toolParams: Record<string, any>) => void | Promise<void>;
    tool_executed: (toolName: string, toolParams: Record<string, any>, output: string) => void | Promise<void>;
    /** Is produced at the end of reasoning phase */
    reasoning_end: (thoughts: string) => void | Promise<void>;
    /** When agent starts to produce output */
    result_producing_start: () => void | Promise<void>;
    concluding_start: () => void | Promise<void>;
    concluding_end: (conclusion: string) => void | Promise<void>;
    plugin_invoking: (pluginName: string, executionWay: ReActAgentPluginSpec["executionWay"]) => void | Promise<void>;
    plugin_result: (pluginName: string, executionWay: ReActAgentPluginSpec["executionWay"], result: Awaited<ReturnType<ReActAgentPluginSpec["execute"]>>) => void | Promise<void>;
}

interface ReActAgentInvokeResult {
    messages: MessagesVariations[];
    state: AgentMessagesGraphState;
}

interface ReActAgentStreamEventMap {
    llm_result: {
        content: LLMAnswer;
    };
    tool_invoked: {
        content: {
            toolName: string;
            toolParams: Record<string, any>;
        };
    };
    tool_executed: {
        content: {
            toolName: string;
            toolParams: Record<string, any>;
            output: string;
        };
    };
    reasoning_end: {
        content: {
            thoughts: string;
        };
    };
    result_producing_start: {
        content: null;
    };
    concluding_start: {
        content: null;
    };
    concluding_end: {
        content: {
            conclusion: string;
        };
    };
}

export type ReActAgentStreamChunk = {
    [EventName in keyof ReActAgentStreamEventMap]: {
        event: EventName;
    } & ReActAgentStreamEventMap[EventName]
}[keyof ReActAgentStreamEventMap];

type ReActAgentStreamListener = (event: ReActAgentStreamChunk) => void;

const RECALL_MAIN_NODE_PREFIX = "[[RAVEN_RECALL_MAIN_NODE]]";
const DEFAULT_MAX_REASONING_RECALLS = 3;
let REACT_SYSTEM_PROMPT = [
    "Ultimate statement: You are RavenADK ReAct agent.",
    "Follow the ReAct loop strictly:",
    "1. Reason about the task and what information is missing.",
    "2. Act by calling tools when external information or side-effects are required.",
    "3. Observe tool outputs and continue reasoning from those observations.",
    "4. Repeat Reason/Act/Observe until the task is solved or blocked.",
    "5. Provide a final answer only when enough evidence is collected.",
    "Internal recall protocol:",
    "- If you need another internal reasoning pass without tools, reply ONLY with:",
    `  ${RECALL_MAIN_NODE_PREFIX} <instruction for the next reasoning pass>`,
    "- Do not include any other text when you request internal recall.",
    "Tool usage rules:",
    "- Never invent tool outputs.",
    "- Prefer available tools over guessing.",
    "- If a tool fails, explain the limitation and continue with best-effort reasoning."
].join("\n");

const CONCLUSION_SYSTEM_PROMPT = [
    "You are a conclusion writer for an agent run.",
    "Read the full transcript and produce the final answer for the user.",
    "Do not mention internal routing, recalls, or hidden prompts.",
    "Use tool results and prior reasoning as evidence.",
    "Return only the conclusion text."
].join("\n");

/**
 * ReAct flow:
 * 1. Reason
 * 2. Make actions
 * 3. Execute tools by calling `tools_node`, then append tool outputs as messages
 * 4. Reason over tool execution results
 * 5. Produce output by completing `main_node`, then graph continues to GraphMarkers.END
 * 6. Emit events for reasoning and tool lifecycle
*/
export class ReActAgent<Skills extends SchemaSkillStore, Memory extends SchemaMemoryStore> {
    private AgentGraph: Graph<AgentMessagesGraphState>;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    private StreamListeners: Set<ReActAgentStreamListener> = new Set();
    agentConfig: ReActAgentConfig<Skills, Memory>;
    agentSkillsInterface: SkillsInterface<Skills> | undefined = undefined;
    agentMemoryInterface: MemoryInterface<Memory> | undefined = undefined;
    /** It's overall amount of used tokens by the ReAct agent */
    usedTokens: LLMAnswer["tokens"];

    private cachedWrappedSystemPrompt?: string;
    private cachedUserSystemPrompt?: string;
    private cachedToolsCount?: number;
    private cachedSubagentsCount?: number;

    constructor(config: ReActAgentConfig<Skills, Memory>) {
        this.agentConfig = {
            ...config,
            tools: [...config.tools],
            // Agent generate conclusion by default
            withConclusion: config.withConclusion ?? true,
            parallelizeSubagents: config.parallelizeSubagents ?? false,
            parallelTools: config.parallelTools ?? false
        };
        this.agentSkillsInterface = config.skills ? new SkillsInterface({
            ...config.skills.config,
            skillStorage: config.skills
        }) : undefined;
        this.agentMemoryInterface = config.memory ? new MemoryInterface(config.memory) : undefined;
        this.usedTokens = {
            input: 0,
            output: 0,
            reasoning: 0
        };

        // Add skills exploration feature to standalone agent
        if (this.agentSkillsInterface) {
            const exploreSkillTools = this.agentSkillsInterface.createExploreSkillsAgentTools();
            const executeSkillTools = this.agentSkillsInterface.createSkillScriptExecuteTools();
            const managementSkillsTools = this.agentSkillsInterface?.createManageSkillAgentTools();
            
            const newTools = [
                ...exploreSkillTools, 
                ...executeSkillTools, 
                ...(managementSkillsTools || [])
            ];

            for (const tool of newTools) {
                if (!this.agentConfig.tools.find(t => t.toolConfig.toolName === tool.toolConfig.toolName)) {
                    this.agentConfig.tools.push(tool);
                }
            }

            const skillEventNames = [
                "readSkillFull",
                "readSkillMeta",
                "discoverSkillFolder",
                "createSkillFile",
                "createSkillFolder",
                "reloacateSkill",
                "removeSkill",
                "removeSkillFolder",
            ] as SkillEventNames[];
            
            for (const possibleSkillEvent of skillEventNames) {
                this.agentSkillsInterface.onEvent(possibleSkillEvent, (...args: any[]) => {
                    this.emitEvent(possibleSkillEvent as any, ...args)
                })
            }
        }

        // Add memory
        if (this.agentMemoryInterface) {
            const memoryTools = this.agentMemoryInterface.createMemoryTools();

            for (const tool of memoryTools) {
                if (!this.agentConfig.tools.find(t => t.toolConfig.toolName === tool.toolConfig.toolName)) {
                    this.agentConfig.tools.push(tool);
                }
            }
        }

        // Add hitl handling
        if (this.agentConfig.hitl) {
            // Add questioning tools
            const questionTools = this.agentConfig.hitl.createQuestionTools();

            for (const tool of questionTools) {
                if (!this.agentConfig.tools.find(t => t.toolConfig.toolName === tool.toolConfig.toolName)) {
                    this.agentConfig.tools.push(tool);
                }
            }
        }

        // Subagents are configured and will be spawned as graph nodes below
        // System prompt is dynamically generated in buildWrappedSystemPrompt()

        // Preparation
        this.ensureWrappedSystemPrompt();
        this.synchronizeModelConfig();

        const reactAgentGraph = new Graph<AgentMessagesGraphState>({});

        reactAgentGraph
            .addNode("main_node", async state => {
                let currentState = state;

                // Resolve tools inline -> eliminate dead turns!
                if (state.callTools?.tools.length) {
                    const toolIds = new Set(state.callTools.tools.map(t => t.tool_id));
                    
                    // Filter out existing tool call messages to avoid duplication
                    this.agentConfig.messages = this.agentConfig.messages.filter(msg => 
                        !(msg.type === "tool" && toolIds.has(msg.tool_id))
                    );

                    this.agentConfig.messages = [
                        ...this.agentConfig.messages,
                        ...state.callTools.tools.map(toolMessage => ({
                            ...toolMessage,
                        }))
                    ];

                    const { callTools, ...stateWithoutCallTools } = state;
                    currentState = stateWithoutCallTools as any;
                }

                // From above condition when tool output was retrived
                if (currentState.toolsOutputRetrived) {
                    const { toolsOutputRetrived, ...stateWithoutToolFlag } = currentState;
                    currentState = stateWithoutToolFlag as any;
                }

                // Run plugins
                await this.runPlugins("before_model_call", {
                    nodeType: "main",
                    nodeName: "main_node",
                    nodeModel: this.agentConfig.model
                });
                
                // Invoke model
                const modelInvoke = await this.agentConfig.model.invoke({
                    messages: this.agentConfig.messages
                });

                this.calculateUsedTokens(modelInvoke);
                this.agentConfig.messages = modelInvoke.messages;
                this.emitEvent("llm_result", modelInvoke);

                // Run plugins
                await this.runPlugins("after_model_call", {
                    nodeType: "main",
                    nodeName: "main_node",
                    nodeModel: this.agentConfig.model
                });

                // Reasoning
                const reasoningMessages = modelInvoke.answer
                    .filter((answerMsg): answerMsg is Extract<MessagesVariations, { type: "thinking" }> => answerMsg.type === "thinking")
                    .map((thought) => thought.content)
                    .join("\n\n")
                    .trim();

                if (reasoningMessages.length > 0) {
                    this.emitEvent("reasoning_end", reasoningMessages);
                }

                // Decide to call tools once again - check for top-level tool messages or nested calledTools in AI messages
                const toolAnswers: ToolMessage[] = [];
                const seenToolIds = new Set<string>();

                for (const answerMsg of modelInvoke.answer) {
                    if (answerMsg.type === "tool") {
                        if (!seenToolIds.has(answerMsg.tool_id)) {
                            toolAnswers.push(answerMsg);
                            seenToolIds.add(answerMsg.tool_id);
                        }
                    } else if (answerMsg.type === "ai" && answerMsg.calledTools) {
                        for (const tool of answerMsg.calledTools) {
                            if (!seenToolIds.has(tool.tool_id)) {
                                toolAnswers.push(tool);
                                seenToolIds.add(tool.tool_id);
                            }
                        }
                    }
                }

                if (toolAnswers.length) {
                    return {
                        callNode: "tools_node",
                        stateUpdate: {
                            ...currentState,
                            callTools: {
                                tools: toolAnswers,
                                recentModelAnswers: modelInvoke.answer
                            }
                        }
                    };
                }

                // Parse special model command(s) to call subagent(s)
                const subagentInstructions = this.agentConfig.parallelizeSubagents
                    ? this.parseSubagentInstructions(modelInvoke.answer)
                    : (() => {
                        const single = this.parseSubagentInstruction(modelInvoke.answer);
                        return single ? [single] : [];
                    })();

                if (subagentInstructions.length > 0) {
                    this.stripSubagentDirectiveFromTail();

                    const validInstructions: { role: string; instruction: string }[] = [];
                    for (const { role, instruction } of subagentInstructions) {
                        const subagentExists = this.agentConfig.subagents?.some(a => a.role === role);
                        if (subagentExists) {
                            validInstructions.push({ role, instruction });
                        } else {
                            this.agentConfig.messages.push({
                                type: "user",
                                content: `Error: Subagent with role "${role}" does not exist. Available roles: ${this.agentConfig.subagents?.map(a => a.role).join(", ") || "None"}`
                            });
                        }
                    }

                    if (validInstructions.length > 0) {
                        if (this.agentConfig.parallelizeSubagents) {
                            const subagentsToRun = validInstructions.map(({ role, instruction }) => {
                                const agent = this.agentConfig.subagents!.find(a => a.role === role)!;
                                return { agent, instruction };
                            });

                            // Execute all subagents in parallel
                            await Promise.all(subagentsToRun.map(async ({ agent, instruction }) => {
                                // Add user calling message for this subagent
                                this.agentConfig.messages.push({
                                    type: "user",
                                    content: `[CALLING SUBAGENT: ${agent.role}] Task: ${instruction}`
                                });

                                const subagentInitialMsgsCount = this.agentConfig.messages.length;

                                const subagent = new ReActAgent<Skills, Memory>({
                                    model: agent.model,
                                    systemPrompt: agent.systemPrompt,
                                    messages: [
                                        ...this.agentConfig.messages
                                    ],
                                    skills: this.agentConfig.skills,
                                    memory: this.agentConfig.memory,
                                    hitl: this.agentConfig.hitl,
                                    tools: [
                                        ...this.agentConfig.tools,
                                        ...agent.tools
                                    ],
                                    plugins: this.agentConfig.plugins,
                                    subagents: this.agentConfig.subagents,
                                    withConclusion: false
                                });

                                subagent.onEvent("llm_result", (result) => this.emitEvent("llm_result", result));
                                subagent.onEvent("tool_invoked", (name, params) => this.emitEvent("tool_invoked", name, params));
                                subagent.onEvent("tool_executed", (name, params, out) => this.emitEvent("tool_executed", name, params, out));
                                subagent.onEvent("reasoning_end", (thoughts) => this.emitEvent("reasoning_end", thoughts));

                                await this.runPlugins("before_model_call", {
                                    nodeType: "subagent",
                                    nodeName: agent.role,
                                    nodeModel: agent.model
                                });

                                const result = await subagent.invoke();

                                this.calculateUsedTokens({ tokens: subagent.usedTokens } as LLMAnswer);

                                // Detect if subagent requested an internal recall
                                const subagentRecall = this.parseRecallInstruction(result.messages);

                                let messagesToMerge = result.messages;
                                const lastMsg = messagesToMerge.at(-1);
                                if (lastMsg?.type === "ai" && lastMsg.content?.trim().startsWith(RECALL_MAIN_NODE_PREFIX)) {
                                    messagesToMerge = messagesToMerge.slice(0, -1);
                                }

                                const newMessages = messagesToMerge.slice(subagentInitialMsgsCount);

                                this.agentConfig.messages = [
                                    ...this.agentConfig.messages,
                                    ...newMessages
                                ];

                                await this.runPlugins("after_model_call", {
                                    nodeType: "subagent",
                                    nodeName: agent.role,
                                    nodeModel: agent.model
                                });

                                if (subagentRecall) {
                                    currentState.parallelRecalls = currentState.parallelRecalls || [];
                                    currentState.parallelRecalls.push(subagentRecall);
                                }
                            }));

                            if (currentState.parallelRecalls && currentState.parallelRecalls.length > 0) {
                                const recallsCount = currentState.reasoningRecallsCount ?? 0;
                                const maxRecalls = this.getMaximumReasoningRecalls();
                                if (recallsCount < maxRecalls) {
                                    const nextRecallCount = recallsCount + 1;
                                    const combinedRecall = currentState.parallelRecalls.join("; ");
                                    currentState.parallelRecalls = undefined;

                                    this.agentConfig.messages = [
                                        ...this.agentConfig.messages,
                                        {
                                            type: "user",
                                            content: `[INTERNAL_REASONING_RECALL ${nextRecallCount}/${maxRecalls}] ${combinedRecall}`
                                        }
                                    ];

                                    return {
                                        callNode: "main_node",
                                        stateUpdate: {
                                            ...currentState,
                                            reasoningRecallsCount: nextRecallCount
                                        }
                                    };
                                } else {
                                    await this.concludeAndAppendConclusionMessage();
                                    this.emitEvent("result_producing_start");
                                }
                            }

                            return {
                                callNode: "main_node",
                                stateUpdate: currentState
                            };
                        } else {
                            const { role, instruction } = validInstructions[0];
                            this.agentConfig.messages.push({
                                type: "user",
                                content: `[CALLING SUBAGENT: ${role}] Task: ${instruction}`
                            });

                            return {
                                callNode: role,
                                stateUpdate: currentState
                            };
                        }
                    } else {
                        return {
                            callNode: "main_node",
                            stateUpdate: currentState
                        };
                    }
                }

                // Check is the output the ai assistant
                const hasFinalOutput = modelInvoke.answer.some(
                    answerMsg => answerMsg.type === "ai" && !!answerMsg.content?.trim()
                );

                if (hasFinalOutput) {
                    if (this.agentConfig.withConclusion) {
                        await this.concludeAndAppendConclusionMessage();
                    }
                    else if (this.AgentGraph.graphState.produceStructuredOutput) {
                        await this.concludeWithStructuredOutput();
                    }
                    this.emitEvent("result_producing_start");
                }

                // Return state and finish the ReAct Agent logic
                return {
                    stateUpdate: currentState
                };
            })
            .addNode("tools_node", async state => {
                if (state.callTools?.tools.length) {
                    const { tools: definedTools } = this.agentConfig;
                    const definedToolsByName = new Map(
                        definedTools.map((definedTool) => [definedTool.toolConfig.toolName, definedTool])
                    );

                    // HITL calling for tools required HITL
                    const approvalByCallIndex = new Map<
                        number,
                        { answer: "allow" | "deny"; reason: "user_answer" | "delay_pass" } | { errorMessage: string }
                    >();
                    type HITLApprovalResult =
                        | {
                            callIndex: number;
                            allowance: { answer: "allow" | "deny"; reason: "user_answer" | "delay_pass" };
                        }
                        | {
                            callIndex: number;
                            errorMessage: string;
                        };

                    const hitlTransport = this.agentConfig.hitl;
                    const toolsUsageConfig = this.agentConfig.hitl?.config.toolsUsage;

                    if (hitlTransport && toolsUsageConfig) {
                        const toolsRequiringApproval = state.callTools.tools
                            .map((toolCall, callIndex) => {
                                const toolName = toolCall.tool_name ?? toolCall.tool_id;

                                if (!toolsUsageConfig[toolName]) {
                                    return null;
                                }

                                return {
                                    toolName,
                                    callIndex
                                };
                            })
                            .filter((approvalTarget): approvalTarget is { toolName: string; callIndex: number } => !!approvalTarget);

                        const approvals: HITLApprovalResult[] = await Promise.all(
                            toolsRequiringApproval.map(async ({ toolName, callIndex }) => {
                                try {
                                    const allowance = await hitlTransport.emitToolUsage(toolName);

                                    return {
                                        callIndex,
                                        allowance
                                    };
                                } catch (error) {
                                    const errorMessage = error instanceof Error ? error.message : "Unknown HITL approval error";

                                    return {
                                        callIndex,
                                        errorMessage: `HITL approval for tool "${toolName}" failed: ${errorMessage}`
                                    };
                                }
                            })
                        );

                        approvals.forEach((approvalResult) => {
                            if ("allowance" in approvalResult) {
                                approvalByCallIndex.set(approvalResult.callIndex, approvalResult.allowance);
                                return;
                            }

                            approvalByCallIndex.set(approvalResult.callIndex, {
                                errorMessage: approvalResult.errorMessage
                            });
                        });
                    }

                    const executeSingleTool = async (tool: any, callIndex: number) => {
                        const toolName = tool.tool_name ?? tool.tool_id;
                        const definedTool = definedToolsByName.get(toolName);
                        const toolParams = tool.arguments ?? {};

                        // --- HITL handle error for tool and deny
                        const approvalResult = approvalByCallIndex.get(callIndex);

                        if (approvalResult && "errorMessage" in approvalResult) {
                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: approvalResult.errorMessage,
                                toolOutput: approvalResult.errorMessage,
                                content: approvalResult.errorMessage
                            };
                        }

                        if (approvalResult && approvalResult.answer === "deny") {
                            const denyOutput = `Tool "${toolName}" execution was denied by HITL (${approvalResult.reason}).`;

                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: denyOutput,
                                toolOutput: denyOutput,
                                content: denyOutput
                            };
                        }
                        // --- HITL End

                        if (!definedTool) {
                            const missingToolError = `Tool couldn't be executed because tool with name "${toolName}" does not exist`;

                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: missingToolError,
                                toolOutput: missingToolError,
                                content: missingToolError
                            };
                        }

                        this.emitEvent("tool_invoked", toolName, toolParams);

                        try {
                            const toolOutput = definedTool instanceof MCPTool
                                ? await definedTool.invokeFromMCP((toolParams ?? {}) as Record<string, unknown>)
                                : await definedTool.invoke(toolParams as never);
                            this.emitEvent("tool_executed", toolName, toolParams, toolOutput);

                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: undefined,
                                toolOutput,
                                content: toolOutput
                            };
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : "Unknown tool execution error";
                            const toolFailureOutput = `Tool "${toolName}" failed during execution: ${errorMessage}`;

                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: errorMessage,
                                toolOutput: toolFailureOutput,
                                content: toolFailureOutput
                            };
                        }
                    };

                    let toolsStatePrepared;
                    if (this.agentConfig.parallelTools) {
                        toolsStatePrepared = await Promise.all(
                            state.callTools.tools.map(async (tool, callIndex) => {
                                return await executeSingleTool(tool, callIndex);
                            })
                        );
                    } else {
                        toolsStatePrepared = [];
                        for (let callIndex = 0; callIndex < state.callTools.tools.length; callIndex++) {
                            const tool = state.callTools.tools[callIndex];
                            const prepared = await executeSingleTool(tool, callIndex);
                            toolsStatePrepared.push(prepared);
                        }
                    }

                    return {
                        callNode: "main_node",
                        stateUpdate: {
                            ...state,
                            callTools: {
                                ...state.callTools,
                                tools: toolsStatePrepared
                            }
                        }
                    };
                }

                return {
                    callNode: "main_node",
                    stateUpdate: {
                        ...state,
                        callTools: undefined
                    }
                };
            })
            .addEdge(GraphMarkers.START, "main_node")
            .addEdge("main_node", GraphMarkers.END);

        // Spawn separate nodes where each of node is subagent
        if (this.agentConfig.subagents?.length) {
            for (const agent of this.agentConfig.subagents) {
                reactAgentGraph.addNode(agent.role, async state => {
                    const subagent = new ReActAgent<Skills, Memory>({
                        model: agent.model,
                        systemPrompt: agent.systemPrompt,
                        messages: [
                            ...this.agentConfig.messages
                        ],
                        skills: this.agentConfig.skills,
                        memory: this.agentConfig.memory,
                        hitl: this.agentConfig.hitl,
                        tools: [
                            ...this.agentConfig.tools,
                            ...agent.tools
                        ],
                        plugins: this.agentConfig.plugins,
                        subagents: this.agentConfig.subagents,
                        withConclusion: false
                    });

                    subagent.onEvent("llm_result", (result) => this.emitEvent("llm_result", result));
                    subagent.onEvent("tool_invoked", (name, params) => this.emitEvent("tool_invoked", name, params));
                    subagent.onEvent("tool_executed", (name, params, out) => this.emitEvent("tool_executed", name, params, out));
                    subagent.onEvent("reasoning_end", (thoughts) => this.emitEvent("reasoning_end", thoughts));

                    
                    // Run plugins // WARNING: As far as subagents inherits the messages context from the rest of models the compress algorithm will work
                    await this.runPlugins("before_model_call", {
                        nodeType: "subagent",
                        nodeName: agent.role,
                        nodeModel: agent.model
                    });
                    
                    const subagentInitialMsgsCount = this.agentConfig.messages.length;

                    const result = await subagent.invoke();

                    this.calculateUsedTokens({ tokens: subagent.usedTokens } as LLMAnswer);

                    // Detect if subagent requested an internal recall for the main node
                    const subagentRecall = this.parseRecallInstruction(result.messages);

                    // Prepare messages to merge: strip raw recall directive from subagent messages
                    let messagesToMerge = result.messages;
                    const lastMsg = messagesToMerge.at(-1);
                    if (lastMsg?.type === "ai" && lastMsg.content?.trim().startsWith(RECALL_MAIN_NODE_PREFIX)) {
                        messagesToMerge = messagesToMerge.slice(0, -1);
                    }

                    // Only merge new messages created by subagent to avoid duplication in history
                    const newMessages = messagesToMerge.slice(subagentInitialMsgsCount);

                    this.agentConfig.messages = [
                        ...this.agentConfig.messages,
                        ...newMessages
                    ];

                    // Run after subagent
                    await this.runPlugins("after_model_call", {
                        nodeType: "subagent",
                        nodeName: agent.role,
                        nodeModel: agent.model
                    });

                    // If subagent requested recall, convert it into main internal recall flow
                    if (subagentRecall) {
                        const recallsCount = state.reasoningRecallsCount ?? 0;
                        const maxRecalls = this.getMaximumReasoningRecalls();
                        if (recallsCount < maxRecalls) {
                            const nextRecallCount = recallsCount + 1;

                            // Persist an internal recall instruction so the next model pass has explicit focus.
                            this.agentConfig.messages = [
                                ...this.agentConfig.messages,
                                {
                                    type: "user",
                                    content: `[INTERNAL_REASONING_RECALL ${nextRecallCount}/${maxRecalls}] ${subagentRecall}`
                                }
                            ];

                            return {
                                callNode: "main_node",
                                stateUpdate: {
                                    ...state,
                                    reasoningRecallsCount: nextRecallCount
                                }
                            };
                        }

                        // Exceeded recall limit: conclude
                        await this.concludeAndAppendConclusionMessage();
                        this.emitEvent("result_producing_start");

                        return {
                            callNode: "main_node",
                            stateUpdate: {
                                ...state,
                                reasoningRecallsCount: recallsCount
                            }
                        };
                    }

                    return {
                        callNode: "main_node",
                        stateUpdate: state
                    };
                });
            }
        }
        
        this.AgentGraph = reactAgentGraph;
    }

    private async buildWrappedSystemPrompt(userSystemPrompt: string): Promise<string> {
        const cleanedUserPrompt = userSystemPrompt.trim();

        if (
            this.cachedUserSystemPrompt === cleanedUserPrompt &&
            this.cachedWrappedSystemPrompt !== undefined &&
            this.cachedToolsCount === this.agentConfig.tools.length &&
            this.cachedSubagentsCount === (this.agentConfig.subagents?.length ?? 0)
        ) {
            return this.cachedWrappedSystemPrompt;
        }

        const maxRecalls = this.getMaximumReasoningRecalls();
        const recallBoundary = `You can request at most ${maxRecalls} internal self-recalls in this run.`;

        let baseSystemPrompt = REACT_SYSTEM_PROMPT;

        if (this.agentSkillsInterface) {
            baseSystemPrompt += `\n\n## Explore your skills and use them according to this specification:\n${SkillsInterface.exploreSkillsPrompt}`;
            baseSystemPrompt += `\n\n## Execute skill scripts and CLI commands according to this specification:\n${SkillsInterface.executeSkillScriptsPrompt}`;

            if (this.agentSkillsInterface.config.dynamicSkillCreation || this.agentSkillsInterface.config.dynamicSkillRelocation || this.agentSkillsInterface.config.dynamicSkillRemoval) {
                baseSystemPrompt += `\n\n## Create and manage skills as needed according to this specification:\n${this.agentSkillsInterface.createSkillsManagementPrompt()}`;
            }

            const getListOfAvaibalbeSkills = await this.agentSkillsInterface.getListOfAvailableSkillsString();
            baseSystemPrompt += `\n\n## Available skills list:\n${getListOfAvaibalbeSkills}`;
        }

        if (this.agentMemoryInterface) {
            baseSystemPrompt += `\n\n\n\n## Memory and recall system:\n${MemoryInterface.memorySystemPrompt}\n\nYou've to remember following informations always when has occured in conversation transcript and were't already remembered:\n${this.agentMemoryInterface.store.config.hasToRemember}`;
        }

        if (this.agentConfig.hitl) {
            baseSystemPrompt += `\n\nQuestioning of user. Use questioning tools accroding to this specification to ask user about whatever:\n${this.agentConfig.hitl.questionHITLPrompt}`;
        }

        if (this.agentConfig.subagents?.length) {
            baseSystemPrompt += "\n\n## Subagents available:\n";
            baseSystemPrompt += "You can delegate tasks to specialized subagents. To call a subagent, reply ONLY with:\n";
            baseSystemPrompt += `  [[RAVEN_CALL_SUBAGENT]] <Role> | <Detailed instruction for the subagent>\n`;
            baseSystemPrompt += "Available subagents:\n";
            for (const agent of this.agentConfig.subagents) {
                baseSystemPrompt += `- Role: "${agent.role}", Description: "${agent.roleDescription}"\n`;
            }
        }

        let result;
        if (!cleanedUserPrompt.length) {
            result = `${baseSystemPrompt}\n${recallBoundary}`;
        } else {
            result = `${baseSystemPrompt}\n${recallBoundary}\n\nUser system prompt:\n${cleanedUserPrompt}`;
        }

        this.cachedUserSystemPrompt = cleanedUserPrompt;
        this.cachedWrappedSystemPrompt = result;
        this.cachedToolsCount = this.agentConfig.tools.length;
        this.cachedSubagentsCount = this.agentConfig.subagents?.length ?? 0;

        return result;
    }

    private getMaximumReasoningRecalls(): number {
        const configuredValue = this.agentConfig.maximumReasoningRecalls;

        if (configuredValue === undefined) {
            return DEFAULT_MAX_REASONING_RECALLS;
        }

        if (!Number.isFinite(configuredValue) || configuredValue < 0) {
            return DEFAULT_MAX_REASONING_RECALLS;
        }

        return Math.floor(configuredValue);
    }

    private parseSubagentInstructions(answer: ReActAgentInvokeResult["messages"]): { role: string; instruction: string }[] {
        const latestAIMessage = [...answer]
            .reverse()
            .find((message): message is Extract<MessagesVariations, { type: "ai" }> => message.type === "ai" && !!message.content?.trim());

        if (!latestAIMessage?.content) {
            return [];
        }

        const lines = latestAIMessage.content.split("\n");
        const instructions: { role: string; instruction: string }[] = [];
        const prefix = "[[RAVEN_CALL_SUBAGENT]]";

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith(prefix)) {
                const remainder = trimmedLine.slice(prefix.length).trim();
                const separatorIndex = remainder.indexOf("|");
                if (separatorIndex !== -1) {
                    const role = remainder.slice(0, separatorIndex).trim();
                    const instruction = remainder.slice(separatorIndex + 1).trim();
                    if (role && instruction) {
                        instructions.push({ role, instruction });
                    }
                }
            }
        }

        return instructions;
    }

    private parseSubagentInstruction(answer: ReActAgentInvokeResult["messages"]): { role: string; instruction: string } | null {
        const latestAIMessage = [...answer]
            .reverse()
            .find((message): message is Extract<MessagesVariations, { type: "ai" }> => message.type === "ai" && !!message.content?.trim());

        if (!latestAIMessage?.content) {
            return null;
        }

        const trimmedContent = latestAIMessage.content.trim();
        const prefix = "[[RAVEN_CALL_SUBAGENT]]";

        if (!trimmedContent.startsWith(prefix)) {
            return null;
        }

        const remainder = trimmedContent.slice(prefix.length).trim();
        const separatorIndex = remainder.indexOf("|");
        
        if (separatorIndex === -1) {
            return null;
        }

        const role = remainder.slice(0, separatorIndex).trim();
        const instruction = remainder.slice(separatorIndex + 1).trim();

        if (!role || !instruction) {
            return null;
        }

        return { role, instruction };
    }

    private stripSubagentDirectiveFromTail(): void {
        const lastMessage = this.agentConfig.messages.at(-1);

        if (lastMessage?.type !== "ai" || !lastMessage.content?.trim()) {
            return;
        }

        if (!lastMessage.content.trim().startsWith("[[RAVEN_CALL_SUBAGENT]]")) {
            return;
        }

        this.agentConfig.messages = this.agentConfig.messages.slice(0, -1);
    }

    // Detect explicit internal recall command returned by the model.
    private parseRecallInstruction(answer: ReActAgentInvokeResult["messages"]): string | null {
        const latestAIMessage = [...answer]
            .reverse()
            .find((message): message is Extract<MessagesVariations, { type: "ai" }> => message.type === "ai" && !!message.content?.trim());

        if (!latestAIMessage?.content) {
            return null;
        }

        const trimmedContent = latestAIMessage.content.trim();

        if (!trimmedContent.startsWith(RECALL_MAIN_NODE_PREFIX)) {
            return null;
        }

        const instruction = trimmedContent.slice(RECALL_MAIN_NODE_PREFIX.length).trim();
        return instruction.length > 0 ? instruction : null;
    }

    private generateTranscript(): string {
        return this.agentConfig.messages
            .map((message, index) => {
                const label = `${index + 1}. ${message.type}`;

                if (message.type === "tool") {
                    const toolName = message.tool_name ?? message.tool_id;
                    const output = message.toolOutput ?? message.content;
                    let displayOutput = output;
                    if (output && output.startsWith("data:image/")) {
                        displayOutput = `[Image Data: ${output.substring(0, 100)}...]`;
                    } else if (output && output.length > 5000) {
                        displayOutput = output.substring(0, 5000) + "... [Truncated for transcript]";
                    }
                    return `${label} | ${toolName}: ${displayOutput}`;
                }

                if (message.type === "thinking") {
                    const content = message.content;
                    const displayContent = content.length > 5000 ? content.substring(0, 5000) + "... [Truncated for transcript]" : content;
                    return `${label} | ${displayContent}`;
                }

                if (message.type === "user") {
                    const content = message.content;
                    const displayContent = content.length > 5000 ? content.substring(0, 5000) + "... [Truncated for transcript]" : content;
                    const parts = [displayContent];
                    if (message.imageInput) {
                        parts.push(`[Image Input: ${message.imageInput.image_url ? message.imageInput.image_url.substring(0, 100) : "base64"}...]`);
                    }
                    if (message.audioInput) {
                        parts.push(`[Audio Input: format=${message.audioInput.input_audio?.format || "unknown"}]`);
                    }
                    if (message.fileInput) {
                        parts.push(`[File Input: ${message.fileInput.filename || "file"}]`);
                    }
                    if (message.videoInput) {
                        parts.push(`[Video Input: ${message.videoInput.video_url || "video data"}]`);
                    }
                    return `${label} | ${parts.join(" ")}`;
                }

                if (message.type === "ai") {
                    const content = message.content ?? "";
                    const displayContent = content.length > 5000 ? content.substring(0, 5000) + "... [Truncated for transcript]" : content;
                    const parts = [displayContent];
                    if (message.fileInput) {
                        parts.push(`[File Output: ${message.fileInput.filename || "file"}]`);
                    }
                    if (message.audioInput) {
                        parts.push(`[Audio Input Output]`);
                    }
                    if (message.audioOutput) {
                        parts.push(`[Audio Output: transcript=${message.audioOutput.transcript || "none"}]`);
                    }
                    return `${label} | ${parts.join(" ")}`;
                }

                return `${label} | ${message.content}`;
            })
            .join("\n");
    }

    // Generate the final conclusion with a dedicated LLM summary call over the full transcript.
    private async concludeAndAppendConclusionMessage(): Promise<void> {
        this.emitEvent("concluding_start");
        
        // FIXME: Since transcript is truncated instead of it as evidence use prior messages
        const transcript = this.generateTranscript();

        const previousTools = this.agentConfig.model.config.tools;
        const previousMessages = this.agentConfig.model.config.messages;

        try {
            this.agentConfig.model.config.tools = [];
            this.agentConfig.model.config.messages = [
                {
                    type: "system",
                    content: CONCLUSION_SYSTEM_PROMPT
                },
                {
                    type: "user",
                    content: [
                        "Write the final user-facing conclusion from this conversation transcript.",
                        "If there were tool results, use them as evidence.",
                        "If the run ended because of recall limit, summarize the best available answer.",
                        "",
                        transcript
                    ].join("\n")
                }
            ];

            const conclusionResult = await this.agentConfig.model.invoke({
                messages: this.agentConfig.model.config.messages
            });
            this.calculateUsedTokens(conclusionResult);

            this.emitEvent("llm_result", conclusionResult);

            const conclusionMessage = conclusionResult.answer.find(
                (message): message is Extract<MessagesVariations, { type: "ai" }> => message.type === "ai" && !!message.content?.trim()
            );
            const conclusionMessageContent = conclusionMessage?.content ?? "Conclusion could not be generated from the transcript.";

            this.emitEvent("concluding_end", conclusionMessageContent);
            this.agentConfig.messages = [
                ...this.agentConfig.messages,
                {
                    type: "ai",
                    content: conclusionMessageContent
                }
            ];
        } finally {
            this.agentConfig.model.config.tools = previousTools;
            this.agentConfig.model.config.messages = previousMessages;
            this.synchronizeModelConfig();
        }
    }

    /** conclude final message with usage of the schema use wants */
    private async concludeWithStructuredOutput(): Promise<void> {
        const produceConfig = this.AgentGraph.graphState.produceStructuredOutput;
        if (!produceConfig) return;

        const { zodSchema, retriesCount } = produceConfig;

        const transcript = this.generateTranscript();

        const previousTools = this.agentConfig.model.config.tools;
        const previousMessages = this.agentConfig.model.config.messages;

        try {
            this.agentConfig.model.config.tools = [];
            this.agentConfig.model.config.messages = [
                {
                    type: "system",
                    content: CONCLUSION_SYSTEM_PROMPT
                },
                {
                    type: "user",
                    content: [
                        "Extract and return the final structured output from this conversation transcript, following the provided schema exactly.",
                        "If there were tool results, use them as evidence.",
                        "",
                        transcript
                    ].join("\n")
                }
            ];

            const structuredResult = await this.agentConfig.model.invokeStructuredOutput(zodSchema, retriesCount);
            this.calculateUsedTokens(structuredResult);
            this.emitEvent("llm_result", structuredResult);

            const aiMessage = structuredResult.answer.find(
                (message): message is Extract<MessagesVariations, { type: "ai" }> => message.type === "ai"
            );

            this.agentConfig.messages = [
                ...this.agentConfig.messages,
                {
                    type: "ai",
                    content: aiMessage?.content ?? null,
                    structuredOutput: aiMessage?.structuredOutput
                }
            ];
        } finally {
            this.agentConfig.model.config.tools = previousTools;
            this.agentConfig.model.config.messages = previousMessages;
            this.synchronizeModelConfig();
        }
    }

    private async ensureWrappedSystemPrompt(): Promise<void> {
        const wrappedSystemPrompt = await this.buildWrappedSystemPrompt(this.agentConfig.systemPrompt);
        const nonSystemMessages = this.agentConfig.messages.filter(message => message.type !== "system");

        this.agentConfig.messages = [
            {
                type: "system",
                content: wrappedSystemPrompt
            },
            ...nonSystemMessages
        ];
    }

    private synchronizeModelConfig(): void {
        this.agentConfig.model.config.tools = this.agentConfig.tools;
        this.agentConfig.model.config.messages = this.agentConfig.messages;
    }

    private emitStreamEvent(event: ReActAgentStreamChunk): void {
        this.StreamListeners.forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.warn("ReAct stream listener failed during execution.", error);
            }
        });
    }

    private mapEventToStreamChunk<EventName extends keyof ReActAgentEvents>(eventName: EventName, ...eventArgs: Parameters<ReActAgentEvents[EventName]>): ReActAgentStreamChunk | null {
        switch (eventName) {
            case "llm_result":
                return {
                    event: "llm_result",
                    content: eventArgs[0] as LLMAnswer
                };
            case "tool_invoked":
                return {
                    event: "tool_invoked",
                    content: {
                        toolName: eventArgs[0] as string,
                        toolParams: eventArgs[1] as Record<string, any>
                    }
                };
            case "tool_executed":
                return {
                    event: "tool_executed",
                    content: {
                        toolName: eventArgs[0] as string,
                        toolParams: eventArgs[1] as Record<string, any>,
                        output: eventArgs[2] as string
                    }
                };
            case "reasoning_end":
                return {
                    event: "reasoning_end",
                    content: {
                        thoughts: eventArgs[0] as string
                    }
                };
            case "result_producing_start":
                return {
                    event: "result_producing_start",
                    content: null
                };
            case "concluding_start":
                return {
                    event: "concluding_start",
                    content: null
                };
            case "concluding_end":
                return {
                    event: "concluding_end",
                    content: {
                        conclusion: eventArgs[0] as string
                    }
                };
            default:
                return null;
        }
    }

    onEvent<EventName extends keyof ReActAgentEvents>(
        eventName: EventName,
        eventListener: ReActAgentEvents[EventName]
    ): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof ReActAgentEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<ReActAgentEvents[EventName]>
    ) {
        const streamEvent = this.mapEventToStreamChunk(eventName, ...eventArgs);

        // Emit stream event
        if (streamEvent) {
            this.emitStreamEvent(streamEvent);
        }

        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as ReActAgentEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    calculateUsedTokens(llmAnswer: LLMAnswer) {
        this.usedTokens = {
            input: this.usedTokens.input + llmAnswer.tokens.input,
            output: this.usedTokens.output + llmAnswer.tokens.output,
            reasoning: this.usedTokens.reasoning + llmAnswer.tokens.reasoning
        };
    }

    /** It's responsible to run agent plugins have the specific execution way
     * 
     * TODO: Add error resistant plugin execution behaviour as default and ignoring as option
    */
    private async runPlugins(executionWay: PluginExecutionWays, executionFrom?: Omit<ExecutionFrom, "way">) {
        const pluginsToRun = this.agentConfig.plugins?.filter(plugin => plugin.executionWay instanceof Array ? plugin.executionWay.includes(executionWay) : plugin.executionWay === executionWay);
        if (pluginsToRun?.length) {
            for (const plugin of pluginsToRun) {
                this.emitEvent("plugin_invoking", plugin.name, executionWay);
                
                const executionFromObjPass: ExecutionFrom = executionFrom ? { ...executionFrom, way: executionWay } : { way: executionWay, nodeType: "aside" };
                const runResult = await plugin.execute(executionFromObjPass, this.agentConfig, this.AgentGraph.graphState);
                
                this.emitEvent("plugin_result", plugin.name, executionWay, runResult);

                if (runResult.status) {
                    if (runResult.result?.agentConfig) this.agentConfig = runResult.result.agentConfig;
                    if (runResult.result?.graphState) this.AgentGraph.graphState = runResult.result.graphState;
                }
            }
        }
    }
    
    /**
     * 
     * @param withGraphState - is the optional parameter with what the graph will start
     * @returns 
     */
    private async runGraph(withGraphState?: Record<string, any>): Promise<ReActAgentInvokeResult> {
        // Initialize graph state first so plugins can modify it
        this.AgentGraph.graphState = withGraphState ?? {};

        // Runs Plugins
        await this.runPlugins("before_agent_run");
        
        await this.ensureWrappedSystemPrompt();
        this.synchronizeModelConfig();

        // Run Agent
        await this.AgentGraph.start();

        // Sync
        this.synchronizeModelConfig();

        // Runs plugins
        await this.runPlugins("after_agent_run");
        
        return {
            messages: this.agentConfig.messages,
            state: this.AgentGraph.getState()
        };
    }
    
    async invoke(): Promise<ReActAgentInvokeResult> {
        return await this.runGraph();
    }

    async invokeStream(): Promise<AsyncIterable<ReActAgentStreamChunk>> {
        // Start the agent in the background and stream each emitted ReAct event immediately.
        const self = this;

        return {
            async *[Symbol.asyncIterator](): AsyncGenerator<ReActAgentStreamChunk> {
                const eventQueue: ReActAgentStreamChunk[] = [];
                const waiters: Array<() => void> = [];
                let finished = false;
                let failure: unknown = null;

                const wakeNext = () => {
                    const waiter = waiters.shift();
                    if (waiter) {
                        waiter();
                    }
                };

                const pushEvent: ReActAgentStreamListener = (event) => {
                    eventQueue.push(event);
                    wakeNext();
                };

                self.StreamListeners.add(pushEvent);

                const execution = self.invoke()
                    .catch((error) => {
                        failure = error;
                    })
                    .finally(() => {
                        finished = true;
                        wakeNext();
                    });

                try {
                    while (!finished || eventQueue.length > 0) {
                        if (!eventQueue.length) {
                            await new Promise<void>((resolve) => {
                                waiters.push(resolve);
                            });
                            continue;
                        }

                        yield eventQueue.shift() as ReActAgentStreamChunk;
                    }

                    await execution;

                    if (failure) {
                        throw failure;
                    }
                } finally {
                    self.StreamListeners.delete(pushEvent);
                }
            }
        };
    }

    async invokeStructuredOutput(schema: z.ZodType, maxRecallTries?: number): Promise<ReActAgentInvokeResult> {
        return await this.runGraph({
            produceStructuredOutput: {
                zodSchema: schema,
                retriesCount: maxRecallTries ?? 5
            }
        } satisfies AgentMessagesGraphState)
    }

    public get messages() {
        return this.agentConfig.messages;
    }
}
