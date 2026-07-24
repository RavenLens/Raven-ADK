import { Graph, GraphMarkers } from "../graph";
import { Anthropic } from "../models/anthropic";
import { InvokeOptions, LLMAnswer } from "../models/mutual";
import { OpenAI } from "../models/openai";
import { Google } from "../models/google";
import { SchemaMemoryStore } from "./memory/stores/schema";
import { Memory as MemoryInterface, MutliMemoryObject } from "./memory/memory";
import { SchemaSkillStore } from "./skills/stores/schema";
import { AgentMessagesGraphState, MessagesVariations, ToolMessage } from "./state";
import { SkillEventNames, SkillEvents, Skills as SkillsInterface } from "./skills/skills";
import { MCPTool } from "./tools/mcp/mcpTools";
import { Tool } from "./tools/tools";
import { RunPod } from "../models/runpod";
import z from "zod";
import { HITLTransportSchema, EmitToolUsageBody, HITLToolAllowancePossibleAnswer } from "./tools/hitl/hitlToolSchema";
import { CodeExecutionSandboxSchema } from "./tools/CodeExecutionSandboxes/mutual";

export type AgentModel = OpenAI | Anthropic | RunPod | Google;

export type SubAgent = Pick<ReActAgentConfig<any, any, any>, "model" | "systemPrompt" | "tools"> & {
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
 * * before_tool_invoked - runs before a tool is invoked
 * * after_tool_result - runs after a tool returns its result or error
 * * subagent_invoked - runs when a subagent is invoked
 * * subagent_result - runs when a subagent returns its result
 * * subagent_thought - runs when a subagent produces a thought/reasoning
 * * memory - runs for each memory position/system
 * * memory_position - synonym alias for memory
 * * thought - runs when a thought/reasoning is produced
 * * thoughts - synonym alias for thought
 */
export type PluginExecutionWays =
    | "before_agent_run"
    | "after_agent_run"
    | "before_model_call"
    | "after_model_call"
    | "before_tool_invoked"
    | "after_tool_result"
    | "subagent_invoked"
    | "subagent_result"
    | "subagent_thought"
    | "memory"
    | "memory_position"
    | "thought"
    | "thoughts";

export interface ExecutionFrom {
    way: PluginExecutionWays;
    nodeType: "main" | "subagent" | "aside";
    /**
     * For main_node the value is "main_node",
     * For subagent node the value is "subagent.role" so role name of subagent
     */
    nodeName?: string;
    nodeModel?: AgentModel;

    /** Tool information when way is 'before_tool_invoked' or 'after_tool_result' */
    toolName?: string;
    toolParams?: Record<string, any>;
    toolOutput?: string;
    toolError?: string;

    /** Subagent information when way is 'subagent_invoked', 'subagent_result', or 'subagent_thought' */
    subagentRole?: string;
    subagentInstruction?: string;
    subagentResult?: ReActAgentInvokeResult;

    /** Memory information when way is 'memory' or 'memory_position' */
    memoryInstance?: MemoryInterface<any>;
    memoryPosition?: number;

    /** Thought content when way is 'thought', 'thoughts', or 'subagent_thought' */
    thought?: string;
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
    execute<Skills extends SchemaSkillStore, Memory extends SchemaMemoryStore, HITL extends HITLTransportSchema>(
        executionFrom: ExecutionFrom,
        agentConfig: ReActAgentConfig<Skills, Memory, HITL>,
        graphState: AgentMessagesGraphState
    ): Promise<{
        /** Status of plugin execution */
        status: boolean;
        /** Result of plugin execution. Overrides original 'entry' state only when `status === true` */
        result?: {
            agentConfig?: ReActAgentConfig<Skills, Memory, HITL>;
            graphState?: AgentMessagesGraphState;
        };
    }>;
}

export interface ReActAgentConfig<Skills extends SchemaSkillStore, Memory extends SchemaMemoryStore, HITL extends HITLTransportSchema> {
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
    memory?: Memory | ({
        memory: Memory;
    } & MutliMemoryObject)[];
    /** It's list with agent plugins are going to be execute and can */
    tools: Tool<any, any>[];
    plugins?: ReActAgentPluginSpec[];
    /** specify this schema to use the Human In The Loop */
    hitl?: HITL;
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
    /** Use to elegenatly abort actions */
    abort?: AbortSignal;
}

interface ReActAgentEvents extends SkillEvents {
    llm_result: (result: LLMAnswer) => void | Promise<void>;
    tool_invoked: (toolName: string, toolParams: Record<string, any>) => void | Promise<void>;
    tool_executed: (toolName: string, toolParams: Record<string, any>, output: string) => void | Promise<void>;
    /** Reasoning chunk */
    reasoning: (content: string) => void | Promise<void>;
    /** Is produced at the end of reasoning phase */
    reasoning_end: (thoughts: string) => void | Promise<void>;
    /** When agent starts to produce output */
    result_producing_start: () => void | Promise<void>;
    /** Spawned when user aborts signal */
    abort: () => void | Promise<void>;
    concluding_start: () => void | Promise<void>;
    concluding_end: (conclusion: string) => void | Promise<void>;
    plugin_invoking: (pluginName: string, executionWay: ReActAgentPluginSpec["executionWay"]) => void | Promise<void>;
    plugin_result: (pluginName: string, executionWay: ReActAgentPluginSpec["executionWay"], result: Awaited<ReturnType<ReActAgentPluginSpec["execute"]>>) => void | Promise<void>;

    /** Subagent events */
    subagent_called: (role: string, instruction: string) => void | Promise<void>;
    subagent_result: (role: string, instruction: string, result: ReActAgentInvokeResult) => void | Promise<void>;
    subagent_reasoning: (role: string, content: string) => void | Promise<void>;
    subagent_tool_invoked: (role: string, toolName: string, toolParams: Record<string, any>) => void | Promise<void>;
    subagent_tool_executed: (role: string, toolName: string, toolParams: Record<string, any>, output: string) => void | Promise<void>;

    /** HITL events */
    hitl_triggered: (type: "tool_usage" | "question_abc" | "question_open" | "acceptance", payload: Record<string, any>) => void | Promise<void>;
    hitl_result: (type: "tool_usage" | "question_abc" | "question_open" | "acceptance", payload: Record<string, any>, result: any) => void | Promise<void>;
    hitl_tool_approval: (toolName: string, allowance: EmitToolUsageBody) => void | Promise<void>;
    hitl_question: (questionType: "abc" | "open", question: string, answer: any) => void | Promise<void>;
    hitl_acceptance: (question: string, answer: HITLToolAllowancePossibleAnswer) => void | Promise<void>;

    /** Memory events */
    memory_action: (action: "fetch" | "save" | "get_conclusion" | "set_conclusion", memoryName: string, details: Record<string, any>, result?: any) => void | Promise<void>;
    memory_fetch: (memoryName: string, params: Record<string, any>, result: any) => void | Promise<void>;
    memory_save: (memoryName: string, record: any, result: any) => void | Promise<void>;
    memory_get_conclusion: (memoryName: string, conclusion: string) => void | Promise<void>;
    memory_set_conclusion: (memoryName: string, content: string, status: boolean) => void | Promise<void>;
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
    reasoning: {
        content: string;
    };
    reasoning_end: {
        content: string;
    };
    result_producing_start: {
        content: null;
    };
    abort: {
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
    subagent_called: {
        content: {
            role: string;
            instruction: string;
        };
    };
    subagent_result: {
        content: {
            role: string;
            instruction: string;
            result: ReActAgentInvokeResult;
        };
    };
    subagent_reasoning: {
        content: {
            role: string;
            reasoning: string;
        };
    };
    subagent_tool_invoked: {
        content: {
            role: string;
            toolName: string;
            toolParams: Record<string, any>;
        };
    };
    subagent_tool_executed: {
        content: {
            role: string;
            toolName: string;
            toolParams: Record<string, any>;
            output: string;
        };
    };
    hitl_triggered: {
        content: {
            type: "tool_usage" | "question_abc" | "question_open" | "acceptance";
            payload: Record<string, any>;
        };
    };
    hitl_result: {
        content: {
            type: "tool_usage" | "question_abc" | "question_open" | "acceptance";
            payload: Record<string, any>;
            result: any;
        };
    };
    hitl_tool_approval: {
        content: {
            toolName: string;
            allowance: EmitToolUsageBody;
        };
    };
    hitl_question: {
        content: {
            questionType: "abc" | "open";
            question: string;
            answer: any;
        };
    };
    hitl_acceptance: {
        content: {
            question: string;
            answer: HITLToolAllowancePossibleAnswer;
        };
    };
    memory_action: {
        content: {
            action: "fetch" | "save" | "get_conclusion" | "set_conclusion";
            memoryName: string;
            details: Record<string, any>;
            result?: any;
        };
    };
    memory_fetch: {
        content: {
            memoryName: string;
            params: Record<string, any>;
            result: any;
        };
    };
    memory_save: {
        content: {
            memoryName: string;
            record: any;
            result: any;
        };
    };
    memory_get_conclusion: {
        content: {
            memoryName: string;
            conclusion: string;
        };
    };
    memory_set_conclusion: {
        content: {
            memoryName: string;
            content: string;
            status: boolean;
        };
    };
}

export type ReActAgentStreamChunk = {
    [EventName in keyof ReActAgentStreamEventMap]: {
        event: EventName;
    } & ReActAgentStreamEventMap[EventName]
}[keyof ReActAgentStreamEventMap];

type ReActAgentStreamListener = (event: ReActAgentStreamChunk) => void;
type ReActAgentAnyEventListener = (eventName: keyof ReActAgentEvents, ...args: any[]) => void | Promise<void>;
type AbortableOperationResult<Result> = Result | typeof ABORTED_OPERATION;

const RECALL_MAIN_NODE_PREFIX = "[[RAVEN_RECALL_MAIN_NODE]]";
const DEFAULT_MAX_REASONING_RECALLS = 3;
const ABORTED_OPERATION = Symbol("react-agent-aborted-operation");
let REACT_SYSTEM_PROMPT = [
    "Ultimate statement: You are RavenADK ReAct agent.",
    "Follow the ReAct loop strictly:",
    "1. Reason about the task and what information is missing.",
    "2. Act by calling tools when external information or side-effects are required.",
    "3. Observe tool outputs and continue reasoning from those observations.",
    "4. Repeat Reason/Act/Observe until the task is solved or blocked.",
    "5. Provide a final answer only when enough evidence is collected.",
    "Latency Optimization:",
    "- Parallelize: If multiple independent tools (e.g., saving facts to different memory stores) are required, call them ALL in a single turn.",
    "- Efficient Reasoning: Provide clear, concise reasoning and avoid unnecessary internal recalls.",
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

interface ReActAgentAbortableContext {
    getAbortSignal: () => AbortSignal | undefined;
    getGraphState: () => AgentMessagesGraphState;
    setGraphState: (state: AgentMessagesGraphState) => void;
    getMessages: () => MessagesVariations[];
    emitAbortEvent: () => void;
}

/** Construct used to handle abort operation at ReAct Agent */
export class ReActAgentAbortable {
    private abortEventEmitted = false;

    constructor(private readonly context: ReActAgentAbortableContext) {}

    resetForRun(): void {
        this.abortEventEmitted = false;
    }

    isAbortRequested(): boolean {
        const abortSignal = this.context.getAbortSignal();

        if (!abortSignal?.aborted) {
            return false;
        }

        this.emitAbortEventOnce();
        return true;
    }

    private emitAbortEventOnce(): void {
        if (this.abortEventEmitted) {
            return;
        }

        this.abortEventEmitted = true;

        // TODO: Register this abort transition with OpenTelemetry when abort telemetry is enabled.
        this.context.emitAbortEvent();
    }

    createAbortedState(state: AgentMessagesGraphState): AgentMessagesGraphState {
        this.emitAbortEventOnce();
        return {
            ...state,
            isAborted: true
        };
    }

    createAbortedNodeResult(state: AgentMessagesGraphState) {
        return {
            stateUpdate: this.createAbortedState(state)
        };
    }

    createAbortedInvokeResult(): ReActAgentInvokeResult {
        const abortedState = this.createAbortedState(this.context.getGraphState());
        this.context.setGraphState(abortedState);

        return {
            messages: this.context.getMessages(),
            state: abortedState
        };
    }

    /** Runs operation and allows to stop when was aborted with handy implementation for each action */
    async runAbortable<Result>(operation: () => Promise<Result>): Promise<AbortableOperationResult<Result>> {
        const abortSignal = this.context.getAbortSignal();

        if (!abortSignal) {
            return await operation();
        }

        if (abortSignal.aborted) {
            this.emitAbortEventOnce();
            return ABORTED_OPERATION;
        }

        return await new Promise<AbortableOperationResult<Result>>((resolve, reject) => {
            let settled = false;

            const cleanup = () => {
                abortSignal.removeEventListener("abort", onAbort);
            };

            const onAbort = () => {
                if (settled) {
                    return;
                }

                settled = true;
                cleanup();
                this.emitAbortEventOnce();
                resolve(ABORTED_OPERATION);
            };

            abortSignal.addEventListener("abort", onAbort, { once: true });

            if (abortSignal.aborted) {
                onAbort();
                return;
            }

            let operationPromise: Promise<Result>;
            try {
                operationPromise = operation();
            } catch (error) {
                settled = true;
                cleanup();
                reject(error);
                return;
            }

            Promise.resolve(operationPromise).then(
                (result) => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    cleanup();
                    resolve(result);
                },
                (error) => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    cleanup();
                    reject(error);
                }
            );
        });
    }
}

// TODO: Configure HITL `questions` to be able to use a acceptance HITL and adjust the ReAct agent to be able to use that
/**
 * ReAct flow:
 * 1. Reason
 * 2. Make actions
 * 3. Execute tools by calling `tools_node`, then append tool outputs as messages
 * 4. Reason over tool execution results
 * 5. Produce output by completing `main_node`, then graph continues to GraphMarkers.END
 * 6. Emit events for reasoning and tool lifecycle
*/
export class ReActAgent
<
    Skills extends SchemaSkillStore,
    Memory extends SchemaMemoryStore,
    HITL extends HITLTransportSchema,
    SkillsSandbox extends CodeExecutionSandboxSchema
> {
    private AgentGraph: Graph<AgentMessagesGraphState>;
    private readonly abortable: ReActAgentAbortable;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    private StreamListeners: Set<ReActAgentStreamListener> = new Set();
    private AnyEventListeners: Set<ReActAgentAnyEventListener> = new Set();
    agentConfig: ReActAgentConfig<Skills, Memory, HITL>;
    agentSkillsInterface: SkillsInterface<Skills, HITL, SkillsSandbox> | undefined = undefined;
    agentMemoryInterface: MemoryInterface<Memory> | MemoryInterface<Memory>[] | undefined = undefined;
    /** It's overall amount of used tokens by the ReAct agent */
    usedTokens: LLMAnswer["tokens"];

    private cachedWrappedSystemPrompt?: string;
    private cachedUserSystemPrompt?: string;
    private cachedToolsCount?: number;
    private cachedSubagentsCount?: number;

    constructor(config: ReActAgentConfig<Skills, Memory, HITL>) {
        this.agentConfig = {
            ...config,
            tools: [...config.tools],
            // Agent generate conclusion by default
            withConclusion: config.withConclusion ?? true,
            parallelizeSubagents: config.parallelizeSubagents ?? false,
            parallelTools: config.parallelTools ?? false
        };
        this.abortable = new ReActAgentAbortable({
            getAbortSignal: () => this.agentConfig.abort,
            getGraphState: () => this.AgentGraph.graphState,
            setGraphState: state => {
                this.AgentGraph.graphState = state;
            },
            getMessages: () => this.agentConfig.messages,
            emitAbortEvent: () => this.emitEvent("abort")
        });
        this.agentSkillsInterface = config.skills ? new SkillsInterface({
            ...config.skills.config,
            skillStorage: config.skills,
        }) : undefined;
        this.agentMemoryInterface = (() => {
            if (!config.memory) return;

            if (config.memory instanceof Array) {
                return config.memory.map(memoryWithPurpose => {
                    const { memory, ...multimemory } = memoryWithPurpose;
                    return new MemoryInterface(memory, multimemory);
                });
            }
            else if (typeof config.memory === "object" && "memory" in config.memory) {
                const { memory, ...multimemory } = config.memory as any;
                return new MemoryInterface(memory, multimemory);
            }
            else return new MemoryInterface(config.memory as any);
        })();
        this.usedTokens = {
            input: 0,
            output: 0,
            reasoning: 0
        };

        // Register model reasoning event
        if ((this.agentConfig.model as any).onEvent) {
            (this.agentConfig.model as any).onEvent("reasoning", (content: string) => {
                this.emitEvent("reasoning", content);
                void this.runPlugins("thought", {
                    nodeType: "main",
                    nodeName: "main_node",
                    nodeModel: this.agentConfig.model,
                    thought: content
                });
            });
        }

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
            const addMemoryTools = (memoryTools: Tool<any, any>[]) => {
                for (const tool of memoryTools) {
                    if (!this.agentConfig.tools.find(t => t.toolConfig.toolName === tool.toolConfig.toolName)) {
                        this.agentConfig.tools.push(tool);
                    }
                }
            }
            
            if (this.agentMemoryInterface instanceof Array) {
                for (const memoryInstanceInterface of this.agentMemoryInterface) {
                    const memoryTools = memoryInstanceInterface.createMemoryTools();
                    addMemoryTools(memoryTools);
                }
            }
            else {
                const memoryTools = this.agentMemoryInterface.createMemoryTools();
                addMemoryTools(memoryTools);
            }

            this.setupMemoryEvents();
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

            this.setupHITLEvents();
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

                if (state.isAborted || this.abortable.isAbortRequested()) {
                    return this.abortable.createAbortedNodeResult(currentState);
                }

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
                const beforeModelPlugins = await this.abortable.runAbortable(() => this.runPlugins("before_model_call", {
                    nodeType: "main",
                    nodeName: "main_node",
                    nodeModel: this.agentConfig.model
                }));

                if (beforeModelPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                    return this.abortable.createAbortedNodeResult(currentState);
                }
                
                // Invoke model
                const modelInvokeResult = await this.abortable.runAbortable(() => this.agentConfig.model.invoke({
                    messages: this.agentConfig.messages,
                    abort: this.agentConfig.abort,
                    ...state.modelOptions
                }));

                if (modelInvokeResult === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                    return this.abortable.createAbortedNodeResult(currentState);
                }

                const modelInvoke = modelInvokeResult;

                this.calculateUsedTokens(modelInvoke);
                this.agentConfig.messages = modelInvoke.messages;
                this.emitEvent("llm_result", modelInvoke);

                // Run plugins
                const afterModelPlugins = await this.abortable.runAbortable(() => this.runPlugins("after_model_call", {
                    nodeType: "main",
                    nodeName: "main_node",
                    nodeModel: this.agentConfig.model
                }));

                if (afterModelPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                    return this.abortable.createAbortedNodeResult(currentState);
                }

                // Reasoning
                const reasoningMessages = modelInvoke.answer
                    .filter((answerMsg): answerMsg is Extract<MessagesVariations, { type: "thinking" }> => answerMsg.type === "thinking")
                    .map((thought) => thought.content)
                    .join("\n\n")
                    .trim();

                if (reasoningMessages.length > 0) {
                    this.emitEvent("reasoning_end", reasoningMessages);
                    const thoughtPlugins = await this.abortable.runAbortable(() => this.runPlugins("thought", {
                        nodeType: "main",
                        nodeName: "main_node",
                        nodeModel: this.agentConfig.model,
                        thought: reasoningMessages
                    }));

                    if (thoughtPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(currentState);
                    }
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
                    if (this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(currentState);
                    }

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
                            // Execute all subagents in parallel
                            const subagentResultsExecution = await this.abortable.runAbortable(() => Promise.all(validInstructions.map(async ({ role, instruction }) => {
                                const agent = this.agentConfig.subagents!.find(a => a.role === role)!;
                                
                                const subagentInitialMsgsCount = this.agentConfig.messages.length;

                                const subagent = new ReActAgent<Skills, Memory, any, any>({
                                    model: agent.model,
                                    systemPrompt: agent.systemPrompt,
                                    messages: [
                                        ...this.agentConfig.messages,
                                        {
                                            type: "user",
                                            content: `[CALLING SUBAGENT: ${agent.role}] Task: ${instruction}`
                                        }
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
                                    withConclusion: false,
                                    abort: this.agentConfig.abort
                                });

                                subagent.onEvent("llm_result", (result) => this.emitEvent("llm_result", result));
                                subagent.onEvent("tool_invoked", (name, params) => {
                                    this.emitEvent("tool_invoked", name, params);
                                    this.emitEvent("subagent_tool_invoked", agent.role, name, params);
                                });
                                subagent.onEvent("tool_executed", (name, params, out) => {
                                    this.emitEvent("tool_executed", name, params, out);
                                    this.emitEvent("subagent_tool_executed", agent.role, name, params, out);
                                });
                                subagent.onEvent("reasoning", (content) => {
                                    this.emitEvent("reasoning", content);
                                    this.emitEvent("subagent_reasoning", agent.role, content);
                                });
                                subagent.onEvent("reasoning_end", async (thoughts) => {
                                    this.emitEvent("reasoning_end", thoughts);
                                    this.emitEvent("subagent_reasoning", agent.role, thoughts);
                                    await this.abortable.runAbortable(() => this.runPlugins("subagent_thought", {
                                        nodeType: "subagent",
                                        nodeName: agent.role,
                                        nodeModel: agent.model,
                                        subagentRole: agent.role,
                                        thought: thoughts
                                    }));
                                    await this.abortable.runAbortable(() => this.runPlugins("thought", {
                                        nodeType: "subagent",
                                        nodeName: agent.role,
                                        nodeModel: agent.model,
                                        subagentRole: agent.role,
                                        thought: thoughts
                                    }));
                                });
                                subagent.onEvent("hitl_triggered", (type, payload) => this.emitEvent("hitl_triggered", type, payload));
                                subagent.onEvent("hitl_result", (type, payload, res) => this.emitEvent("hitl_result", type, payload, res));
                                subagent.onEvent("hitl_tool_approval", (name, allowance) => this.emitEvent("hitl_tool_approval", name, allowance));
                                subagent.onEvent("hitl_question", (qType, q, ans) => this.emitEvent("hitl_question", qType, q, ans));
                                subagent.onEvent("hitl_acceptance", (q, ans) => this.emitEvent("hitl_acceptance", q, ans));
                                subagent.onEvent("memory_action", (action, name, details, res) => this.emitEvent("memory_action", action, name, details, res));
                                subagent.onEvent("memory_fetch", (name, params, res) => this.emitEvent("memory_fetch", name, params, res));
                                subagent.onEvent("memory_save", (name, rec, res) => this.emitEvent("memory_save", name, rec, res));
                                subagent.onEvent("memory_get_conclusion", (name, conc) => this.emitEvent("memory_get_conclusion", name, conc));
                                subagent.onEvent("memory_set_conclusion", (name, content, status) => this.emitEvent("memory_set_conclusion", name, content, status));

                                this.emitEvent("subagent_called", agent.role, instruction);

                                const subagentInvokedPlugins = await this.abortable.runAbortable(() => this.runPlugins("subagent_invoked", {
                                    nodeType: "subagent",
                                    nodeName: agent.role,
                                    nodeModel: agent.model,
                                    subagentRole: agent.role,
                                    subagentInstruction: instruction
                                }));

                                if (subagentInvokedPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                    return {
                                        role: agent.role,
                                        instruction,
                                        newMessages: [],
                                        recall: null,
                                        aborted: true
                                    };
                                }

                                const beforeSubagentPlugins = await this.abortable.runAbortable(() => this.runPlugins("before_model_call", {
                                    nodeType: "subagent",
                                    nodeName: agent.role,
                                    nodeModel: agent.model
                                }));

                                if (beforeSubagentPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                    return {
                                        role: agent.role,
                                        instruction,
                                        newMessages: [],
                                        recall: null,
                                        aborted: true
                                    };
                                }

                                const subagentResultExecution = await this.abortable.runAbortable(() => subagent.invoke());

                                if (subagentResultExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                    return {
                                        role: agent.role,
                                        instruction,
                                        newMessages: [],
                                        recall: null,
                                        aborted: true
                                    };
                                }

                                const result = subagentResultExecution;
                                this.emitEvent("subagent_result", agent.role, instruction, result);

                                if (result.state.isAborted) {
                                    return {
                                        role: agent.role,
                                        instruction,
                                        newMessages: [],
                                        recall: null,
                                        aborted: true
                                    };
                                }

                                const subagentResultPlugins = await this.abortable.runAbortable(() => this.runPlugins("subagent_result", {
                                    nodeType: "subagent",
                                    nodeName: agent.role,
                                    nodeModel: agent.model,
                                    subagentRole: agent.role,
                                    subagentInstruction: instruction,
                                    subagentResult: result
                                }));

                                if (subagentResultPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                    return {
                                        role: agent.role,
                                        instruction,
                                        newMessages: [],
                                        recall: null,
                                        aborted: true
                                    };
                                }

                                this.calculateUsedTokens({ tokens: subagent.usedTokens } as LLMAnswer);

                                // Detect if subagent requested an internal recall
                                const subagentRecall = this.parseRecallInstruction(result.messages);

                                let messagesToMerge = result.messages;
                                const lastMsg = messagesToMerge.at(-1);
                                if (lastMsg?.type === "ai" && lastMsg.content?.trim().startsWith(RECALL_MAIN_NODE_PREFIX)) {
                                    messagesToMerge = messagesToMerge.slice(0, -1);
                                }

                                const newMessages = messagesToMerge.slice(subagentInitialMsgsCount + 1); // +1 because we added the instruction message

                                const afterSubagentPlugins = await this.abortable.runAbortable(() => this.runPlugins("after_model_call", {
                                    nodeType: "subagent",
                                    nodeName: agent.role,
                                    nodeModel: agent.model
                                }));

                                if (afterSubagentPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                    return {
                                        role: agent.role,
                                        instruction,
                                        newMessages: [],
                                        recall: null,
                                        aborted: true
                                    };
                                }

                                return {
                                    role: agent.role,
                                    instruction,
                                    newMessages,
                                    recall: subagentRecall,
                                    aborted: false
                                };
                            })));

                            if (subagentResultsExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                return this.abortable.createAbortedNodeResult(currentState);
                            }

                            const subagentResults = subagentResultsExecution;

                            if (subagentResults.some(result => result.aborted)) {
                                return this.abortable.createAbortedNodeResult(currentState);
                            }

                            // Merge results after all finished to avoid race conditions on this.agentConfig.messages
                            for (const res of subagentResults) {
                                this.agentConfig.messages.push({
                                    type: "user",
                                    content: `[CALLING SUBAGENT: ${res.role}] Task: ${res.instruction}`
                                });
                                this.agentConfig.messages.push(...res.newMessages);
                                
                                if (res.recall) {
                                    currentState.parallelRecalls = currentState.parallelRecalls || [];
                                    currentState.parallelRecalls.push(res.recall);
                                }
                            }

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

                                    if (this.abortable.isAbortRequested()) {
                                        return this.abortable.createAbortedNodeResult(currentState);
                                    }

                                    this.emitEvent("result_producing_start");
                                }
                            }

                            return {
                                callNode: "main_node",
                                stateUpdate: currentState
                            };
                        } else {
                            const { role, instruction } = validInstructions[0];

                            if (this.abortable.isAbortRequested()) {
                                return this.abortable.createAbortedNodeResult(currentState);
                            }

                            this.agentConfig.messages.push({
                                type: "user",
                                content: `[CALLING SUBAGENT: ${role}] Task: ${instruction}`
                            });

                            return {
                                callNode: role,
                                stateUpdate: {
                                    ...currentState,
                                    subagentInstruction: instruction
                                }
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

                    if (this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(currentState);
                    }

                    this.emitEvent("result_producing_start");
                }

                // Return state and finish the ReAct Agent logic
                return {
                    stateUpdate: currentState
                };
            })
            .addNode("tools_node", async state => {
                if (state.isAborted || this.abortable.isAbortRequested()) {
                    return this.abortable.createAbortedNodeResult(state);
                }

                if (state.callTools?.tools.length) {
                    const toolsToExecute = state.callTools.tools;
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

                        const approvalsExecution = await this.abortable.runAbortable(() => Promise.all(
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
                        ));

                        if (approvalsExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                            return this.abortable.createAbortedNodeResult(state);
                        }

                        const approvals: HITLApprovalResult[] = approvalsExecution;

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
                        if (this.abortable.isAbortRequested()) {
                            return ABORTED_OPERATION;
                        }

                        const toolName = tool.tool_name ?? tool.tool_id;
                        const definedTool = definedToolsByName.get(toolName);
                        const toolParams = tool.arguments ?? {};

                        // --- HITL handle error for tool and deny
                        const approvalResult = approvalByCallIndex.get(callIndex);

                        if (approvalResult && "errorMessage" in approvalResult) {
                            await this.abortable.runAbortable(() => this.runPlugins("before_tool_invoked", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams
                            }));
                            await this.abortable.runAbortable(() => this.runPlugins("after_tool_result", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams,
                                toolOutput: approvalResult.errorMessage,
                                toolError: approvalResult.errorMessage
                            }));

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
                            await this.abortable.runAbortable(() => this.runPlugins("before_tool_invoked", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams
                            }));
                            await this.abortable.runAbortable(() => this.runPlugins("after_tool_result", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams,
                                toolOutput: denyOutput,
                                toolError: denyOutput
                            }));

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
                            await this.abortable.runAbortable(() => this.runPlugins("before_tool_invoked", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams
                            }));
                            await this.abortable.runAbortable(() => this.runPlugins("after_tool_result", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams,
                                toolOutput: missingToolError,
                                toolError: missingToolError
                            }));

                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: missingToolError,
                                toolOutput: missingToolError,
                                content: missingToolError
                            };
                        }

                        if (this.abortable.isAbortRequested()) {
                            return ABORTED_OPERATION;
                        }

                        this.emitEvent("tool_invoked", toolName, toolParams);
                        await this.abortable.runAbortable(() => this.runPlugins("before_tool_invoked", {
                            nodeType: "main",
                            nodeName: "tools_node",
                            toolName,
                            toolParams
                        }));

                        try {
                            const toolOutputExecution = await this.abortable.runAbortable(() => definedTool instanceof MCPTool
                                ? definedTool.invokeFromMCP((toolParams ?? {}) as Record<string, unknown>)
                                : definedTool.invoke(toolParams as never));

                            if (toolOutputExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                return ABORTED_OPERATION;
                            }

                            const toolOutput = toolOutputExecution;
                            this.emitEvent("tool_executed", toolName, toolParams, toolOutput);
                            await this.abortable.runAbortable(() => this.runPlugins("after_tool_result", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams,
                                toolOutput
                            }));

                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: undefined,
                                toolOutput,
                                content: toolOutput
                            };
                        } catch (error) {
                            if (this.abortable.isAbortRequested()) {
                                return ABORTED_OPERATION;
                            }

                            const errorMessage = error instanceof Error ? error.message : "Unknown tool execution error";
                            const toolFailureOutput = `Tool "${toolName}" failed during execution: ${errorMessage}`;
                            await this.abortable.runAbortable(() => this.runPlugins("after_tool_result", {
                                nodeType: "main",
                                nodeName: "tools_node",
                                toolName,
                                toolParams,
                                toolOutput: toolFailureOutput,
                                toolError: errorMessage
                            }));

                            return {
                                ...tool,
                                tool_name: toolName,
                                toolError: errorMessage,
                                toolOutput: toolFailureOutput,
                                content: toolFailureOutput
                            };
                        }
                    };

                    let toolsStatePrepared: ToolMessage[];
                    if (this.agentConfig.parallelTools) {
                        const parallelToolsExecution = await this.abortable.runAbortable(() => Promise.all(
                            toolsToExecute.map(async (tool, callIndex) => {
                                return await executeSingleTool(tool, callIndex);
                            })
                        ));

                        if (parallelToolsExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                            return this.abortable.createAbortedNodeResult(state);
                        }

                        if (parallelToolsExecution.some(toolResult => toolResult === ABORTED_OPERATION)) {
                            return this.abortable.createAbortedNodeResult(state);
                        }

                        toolsStatePrepared = parallelToolsExecution as ToolMessage[];
                    } else {
                        toolsStatePrepared = [];
                        for (let callIndex = 0; callIndex < toolsToExecute.length; callIndex++) {
                            const tool = toolsToExecute[callIndex];
                            const prepared = await executeSingleTool(tool, callIndex);

                            if (prepared === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                                return this.abortable.createAbortedNodeResult(state);
                            }

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
                    if (state.isAborted || this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(state);
                    }

                    const subagent = new ReActAgent<Skills, Memory, any, any>({
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
                        withConclusion: false,
                        abort: this.agentConfig.abort
                    });

                    subagent.onEvent("llm_result", (result) => this.emitEvent("llm_result", result));
                    subagent.onEvent("tool_invoked", (name, params) => {
                        this.emitEvent("tool_invoked", name, params);
                        this.emitEvent("subagent_tool_invoked", agent.role, name, params);
                    });
                    subagent.onEvent("tool_executed", (name, params, out) => {
                        this.emitEvent("tool_executed", name, params, out);
                        this.emitEvent("subagent_tool_executed", agent.role, name, params, out);
                    });
                    subagent.onEvent("reasoning", (content) => {
                        this.emitEvent("reasoning", content);
                        this.emitEvent("subagent_reasoning", agent.role, content);
                    });
                    subagent.onEvent("reasoning_end", async (thoughts) => {
                        this.emitEvent("reasoning_end", thoughts);
                        this.emitEvent("subagent_reasoning", agent.role, thoughts);
                        await this.abortable.runAbortable(() => this.runPlugins("subagent_thought", {
                            nodeType: "subagent",
                            nodeName: agent.role,
                            nodeModel: agent.model,
                            subagentRole: agent.role,
                            thought: thoughts
                        }));
                        await this.abortable.runAbortable(() => this.runPlugins("thought", {
                            nodeType: "subagent",
                            nodeName: agent.role,
                            nodeModel: agent.model,
                            subagentRole: agent.role,
                            thought: thoughts
                        }));
                    });
                    subagent.onEvent("hitl_triggered", (type, payload) => this.emitEvent("hitl_triggered", type, payload));
                    subagent.onEvent("hitl_result", (type, payload, res) => this.emitEvent("hitl_result", type, payload, res));
                    subagent.onEvent("hitl_tool_approval", (name, allowance) => this.emitEvent("hitl_tool_approval", name, allowance));
                    subagent.onEvent("hitl_question", (qType, q, ans) => this.emitEvent("hitl_question", qType, q, ans));
                    subagent.onEvent("hitl_acceptance", (q, ans) => this.emitEvent("hitl_acceptance", q, ans));
                    subagent.onEvent("memory_action", (action, name, details, res) => this.emitEvent("memory_action", action, name, details, res));
                    subagent.onEvent("memory_fetch", (name, params, res) => this.emitEvent("memory_fetch", name, params, res));
                    subagent.onEvent("memory_save", (name, rec, res) => this.emitEvent("memory_save", name, rec, res));
                    subagent.onEvent("memory_get_conclusion", (name, conc) => this.emitEvent("memory_get_conclusion", name, conc));
                    subagent.onEvent("memory_set_conclusion", (name, content, status) => this.emitEvent("memory_set_conclusion", name, content, status));

                    const subagentInstruction = (state as any).subagentInstruction || (this.agentConfig.messages.at(-1)?.content ?? "").replace(/^\[CALLING SUBAGENT: [^\]]+\] Task: /, "");
                    this.emitEvent("subagent_called", agent.role, subagentInstruction);

                    const subagentInvokedPlugins = await this.abortable.runAbortable(() => this.runPlugins("subagent_invoked", {
                        nodeType: "subagent",
                        nodeName: agent.role,
                        nodeModel: agent.model,
                        subagentRole: agent.role,
                        subagentInstruction
                    }));

                    if (subagentInvokedPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(state);
                    }

                    // Run plugins // WARNING: As far as subagents inherits the messages context from the rest of models the compress algorithm will work
                    const beforeSubagentPlugins = await this.abortable.runAbortable(() => this.runPlugins("before_model_call", {
                        nodeType: "subagent",
                        nodeName: agent.role,
                        nodeModel: agent.model
                    }));

                    if (beforeSubagentPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(state);
                    }
                    
                    const subagentInitialMsgsCount = this.agentConfig.messages.length;

                    const subagentResultExecution = await this.abortable.runAbortable(() => subagent.invoke());

                    if (subagentResultExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(state);
                    }

                    const result = subagentResultExecution;
                    this.emitEvent("subagent_result", agent.role, subagentInstruction, result);

                    if (result.state.isAborted) {
                        return this.abortable.createAbortedNodeResult(state);
                    }

                    const subagentResultPlugins = await this.abortable.runAbortable(() => this.runPlugins("subagent_result", {
                        nodeType: "subagent",
                        nodeName: agent.role,
                        nodeModel: agent.model,
                        subagentRole: agent.role,
                        subagentInstruction,
                        subagentResult: result
                    }));

                    if (subagentResultPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(state);
                    }

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
                    const afterSubagentPlugins = await this.abortable.runAbortable(() => this.runPlugins("after_model_call", {
                        nodeType: "subagent",
                        nodeName: agent.role,
                        nodeModel: agent.model
                    }));

                    if (afterSubagentPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                        return this.abortable.createAbortedNodeResult(state);
                    }

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

                        if (this.abortable.isAbortRequested()) {
                            return this.abortable.createAbortedNodeResult(state);
                        }

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

    private cachedWrappedPromptPromise?: Promise<string>;

    private buildWrappedSystemPrompt(userSystemPrompt: string): Promise<string> {
        const cleanedUserPrompt = userSystemPrompt.trim();

        if (
            this.cachedUserSystemPrompt === cleanedUserPrompt &&
            this.cachedWrappedSystemPrompt !== undefined &&
            this.cachedToolsCount === this.agentConfig.tools.length &&
            this.cachedSubagentsCount === (this.agentConfig.subagents?.length ?? 0) &&
            this.cachedWrappedPromptPromise !== undefined
        ) {
            return this.cachedWrappedPromptPromise;
        }

        this.cachedUserSystemPrompt = cleanedUserPrompt;
        this.cachedToolsCount = this.agentConfig.tools.length;
        this.cachedSubagentsCount = this.agentConfig.subagents?.length ?? 0;

        this.cachedWrappedPromptPromise = (async () => {
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
                if (this.agentMemoryInterface instanceof Array) {
                    const memorySystemsList = await Promise.all(
                        this.agentMemoryInterface.map(async (memoryInstance, index) => {
                            await this.runPlugins("memory", {
                                nodeType: "main",
                                nodeName: "main_node",
                                memoryInstance,
                                memoryPosition: index
                            });

                            const conclusion = await memoryInstance.getMemoryConclusionFile();
                            const hasToRemember = memoryInstance.store.config.hasToRemember;
                            
                            return [
                                memoryInstance.createMemorySystemPrompt(),
                                hasToRemember ? `**Mandatory facts to track for this system**:\n> ${hasToRemember}` : undefined,
                                `**Consolidated Conclusion for this system**:\n${conclusion || "No prior conclusion available. Use tools to query or start a new summary."}`
                            ].filter(Boolean).join("\n\n");
                        })
                    );
                    
                    baseSystemPrompt += `\n\n\n\n## Memory and Recall Systems:
You have access to multiple specialized memory systems. Each system handles a distinct domain of knowledge.

### Rules of Engagement:
1. Identify the correct memory system for the data you are processing based on the names and purposes below.
2. Review the **Consolidated Conclusion** of each system before performing deep searches.
3. Use the system-specific tools (e.g., \`prefix_fetch_memory\`) to access each domain.

${memorySystemsList.join("\n\n---\n\n")}
`;
                }
                else {
                    await this.runPlugins("memory", {
                        nodeType: "main",
                        nodeName: "main_node",
                        memoryInstance: this.agentMemoryInterface,
                        memoryPosition: 0
                    });

                    const memoryConclusionSystemPrompt = await this.agentMemoryInterface.getMemoryConclusionFile();
                    const hasToRemember = this.agentMemoryInterface.store.config?.hasToRemember;
                    
                    baseSystemPrompt += `\n\n\n\n## Memory and Recall System:
${this.agentMemoryInterface.createMemorySystemPrompt()}

${hasToRemember ? `**Mandatory facts to track**:\n> ${hasToRemember}` : ""}

### Consolidated Conclusion:
${memoryConclusionSystemPrompt || "No prior conclusion available. Use tools to seek knowledge."}
`;
                }
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

            this.cachedWrappedSystemPrompt = result;
            return result;
        })();

        this.cachedWrappedSystemPrompt = this.cachedWrappedPromptPromise as any;
        return this.cachedWrappedPromptPromise;
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
        if (this.abortable.isAbortRequested()) {
            return;
        }

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

            const conclusionResultExecution = await this.abortable.runAbortable(() => this.agentConfig.model.invoke({
                messages: this.agentConfig.model.config.messages,
                abort: this.agentConfig.abort
            }));

            if (conclusionResultExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                return;
            }

            const conclusionResult = conclusionResultExecution;
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
        if (this.abortable.isAbortRequested()) {
            return;
        }

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

            const structuredResultExecution = await this.abortable.runAbortable(() => this.agentConfig.model.invokeStructuredOutput(zodSchema, retriesCount, {
                abort: this.agentConfig.abort
            }));

            if (structuredResultExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
                return;
            }

            const structuredResult = structuredResultExecution;
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

    private systemPromptPromise?: Promise<void>;

    private async ensureWrappedSystemPrompt(): Promise<void> {
        if (!this.systemPromptPromise) {
            this.systemPromptPromise = (async () => {
                const wrappedSystemPrompt = await this.buildWrappedSystemPrompt(this.agentConfig.systemPrompt);

                if (this.abortable.isAbortRequested()) {
                    return;
                }

                const nonSystemMessages = this.agentConfig.messages.filter(message => message.type !== "system");

                this.agentConfig.messages = [
                    {
                        type: "system",
                        content: wrappedSystemPrompt
                    },
                    ...nonSystemMessages
                ];
            })();
        }
        await this.systemPromptPromise;
    }

    private synchronizeModelConfig(): void {
        this.agentConfig.model.config.tools = this.agentConfig.tools;
        this.agentConfig.model.config.messages = this.agentConfig.messages;
    }

    private setupMemoryEvents(): void {
        if (!this.agentMemoryInterface) return;

        const setupMemory = (mem: MemoryInterface<any>) => {
            mem.onAction((action, payload) => {
                const memoryName = payload.memoryName ?? "default";
                this.emitEvent("memory_action", action, memoryName, payload, payload.result);
                if (action === "fetch") {
                    this.emitEvent("memory_fetch", memoryName, payload.params, payload.result);
                } else if (action === "save") {
                    this.emitEvent("memory_save", memoryName, payload.record, payload.result);
                } else if (action === "get_conclusion") {
                    this.emitEvent("memory_get_conclusion", memoryName, payload.conclusion);
                } else if (action === "set_conclusion") {
                    this.emitEvent("memory_set_conclusion", memoryName, payload.content, payload.status);
                }
            });
        };

        if (Array.isArray(this.agentMemoryInterface)) {
            this.agentMemoryInterface.forEach(setupMemory);
        } else {
            setupMemory(this.agentMemoryInterface);
        }
    }

    private setupHITLEvents(): void {
        const hitl = this.agentConfig.hitl;
        if (!hitl) return;

        const listenersKey = "__adk_hitl_agent_listeners";
        if (!(hitl as any)[listenersKey]) {
            (hitl as any)[listenersKey] = new Set<(event: string, ...args: any[]) => void>();
        }
        const listeners = (hitl as any)[listenersKey] as Set<(event: string, ...args: any[]) => void>;

        listeners.add((event: string, ...args: any[]) => {
            this.emitEvent(event as any, ...args);
        });

        if (!(hitl as any).__adk_hitl_wrapped) {
            (hitl as any).__adk_hitl_wrapped = true;

            const originalEmitToolUsage = hitl.emitToolUsage?.bind(hitl);
            if (originalEmitToolUsage) {
                hitl.emitToolUsage = async (toolName: string) => {
                    listeners.forEach(l => l("hitl_triggered", "tool_usage", { toolName }));
                    const res = await originalEmitToolUsage(toolName);
                    listeners.forEach(l => {
                        l("hitl_result", "tool_usage", { toolName }, res);
                        l("hitl_tool_approval", toolName, res);
                    });
                    return res;
                };
            }

            const originalEmitAbcQuestion = hitl.emitAbcQuestion?.bind(hitl);
            if (originalEmitAbcQuestion) {
                hitl.emitAbcQuestion = async (question: string, abcOptions: [string, string][]) => {
                    listeners.forEach(l => l("hitl_triggered", "question_abc", { question, options: abcOptions }));
                    const res = await originalEmitAbcQuestion(question, abcOptions);
                    listeners.forEach(l => {
                        l("hitl_result", "question_abc", { question, options: abcOptions }, res);
                        l("hitl_question", "abc", question, res);
                    });
                    return res;
                };
            }

            const originalEmitOpenQuestion = hitl.emitOpenQuestion?.bind(hitl);
            if (originalEmitOpenQuestion) {
                hitl.emitOpenQuestion = async (question: string) => {
                    listeners.forEach(l => l("hitl_triggered", "question_open", { question }));
                    const res = await originalEmitOpenQuestion(question);
                    listeners.forEach(l => {
                        l("hitl_result", "question_open", { question }, res);
                        l("hitl_question", "open", question, res);
                    });
                    return res;
                };
            }

            const originalEmitAcceptance = hitl.emitAcceptance?.bind(hitl);
            if (originalEmitAcceptance) {
                hitl.emitAcceptance = async (question: string, context?: string) => {
                    listeners.forEach(l => l("hitl_triggered", "acceptance", { question, context }));
                    const res = await originalEmitAcceptance(question, context);
                    listeners.forEach(l => {
                        l("hitl_result", "acceptance", { question, context }, res);
                        l("hitl_acceptance", question, res);
                    });
                    return res;
                };
            }
        }
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
            case "reasoning":
                return {
                    event: "reasoning",
                    content: eventArgs[0] as string
                };
            case "reasoning_end":
                return {
                    event: "reasoning_end",
                    content: eventArgs[0] as string
                };
            case "result_producing_start":
                return {
                    event: "result_producing_start",
                    content: null
                };
            case "abort":
                return {
                    event: "abort",
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
            case "subagent_called":
                return {
                    event: "subagent_called",
                    content: {
                        role: eventArgs[0] as string,
                        instruction: eventArgs[1] as string
                    }
                };
            case "subagent_result":
                return {
                    event: "subagent_result",
                    content: {
                        role: eventArgs[0] as string,
                        instruction: eventArgs[1] as string,
                        result: eventArgs[2] as ReActAgentInvokeResult
                    }
                };
            case "subagent_reasoning":
                return {
                    event: "subagent_reasoning",
                    content: {
                        role: eventArgs[0] as string,
                        reasoning: eventArgs[1] as string
                    }
                };
            case "subagent_tool_invoked":
                return {
                    event: "subagent_tool_invoked",
                    content: {
                        role: eventArgs[0] as string,
                        toolName: eventArgs[1] as string,
                        toolParams: eventArgs[2] as Record<string, any>
                    }
                };
            case "subagent_tool_executed":
                return {
                    event: "subagent_tool_executed",
                    content: {
                        role: eventArgs[0] as string,
                        toolName: eventArgs[1] as string,
                        toolParams: eventArgs[2] as Record<string, any>,
                        output: eventArgs[3] as string
                    }
                };
            case "hitl_triggered":
                return {
                    event: "hitl_triggered",
                    content: {
                        type: eventArgs[0] as any,
                        payload: eventArgs[1] as Record<string, any>
                    }
                };
            case "hitl_result":
                return {
                    event: "hitl_result",
                    content: {
                        type: eventArgs[0] as any,
                        payload: eventArgs[1] as Record<string, any>,
                        result: eventArgs[2]
                    }
                };
            case "hitl_tool_approval":
                return {
                    event: "hitl_tool_approval",
                    content: {
                        toolName: eventArgs[0] as string,
                        allowance: eventArgs[1] as EmitToolUsageBody
                    }
                };
            case "hitl_question":
                return {
                    event: "hitl_question",
                    content: {
                        questionType: eventArgs[0] as any,
                        question: eventArgs[1] as string,
                        answer: eventArgs[2]
                    }
                };
            case "hitl_acceptance":
                return {
                    event: "hitl_acceptance",
                    content: {
                        question: eventArgs[0] as string,
                        answer: eventArgs[1] as HITLToolAllowancePossibleAnswer
                    }
                };
            case "memory_action":
                return {
                    event: "memory_action",
                    content: {
                        action: eventArgs[0] as any,
                        memoryName: eventArgs[1] as string,
                        details: eventArgs[2] as Record<string, any>,
                        result: eventArgs[3]
                    }
                };
            case "memory_fetch":
                return {
                    event: "memory_fetch",
                    content: {
                        memoryName: eventArgs[0] as string,
                        params: eventArgs[1] as Record<string, any>,
                        result: eventArgs[2]
                    }
                };
            case "memory_save":
                return {
                    event: "memory_save",
                    content: {
                        memoryName: eventArgs[0] as string,
                        record: eventArgs[1],
                        result: eventArgs[2]
                    }
                };
            case "memory_get_conclusion":
                return {
                    event: "memory_get_conclusion",
                    content: {
                        memoryName: eventArgs[0] as string,
                        conclusion: eventArgs[1] as string
                    }
                };
            case "memory_set_conclusion":
                return {
                    event: "memory_set_conclusion",
                    content: {
                        memoryName: eventArgs[0] as string,
                        content: eventArgs[1] as string,
                        status: eventArgs[2] as boolean
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

    onAnyEvent(eventListener: ReActAgentAnyEventListener): this {
        this.AnyEventListeners.add(eventListener);
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

        // Emit any event
        this.AnyEventListeners.forEach((listener) => {
            void Promise.resolve(listener(eventName, ...eventArgs)).catch((error) => {
                console.warn(`Any event listener failed for event "${String(eventName)}".`, error);
            });
        });

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

    private matchesExecutionWay(pluginWays: PluginExecutionWays | PluginExecutionWays[], targetWay: PluginExecutionWays): boolean {
        const ways = Array.isArray(pluginWays) ? pluginWays : [pluginWays];
        if (ways.includes(targetWay)) return true;
        if (targetWay === "thought" && ways.includes("thoughts")) return true;
        if (targetWay === "thoughts" && ways.includes("thought")) return true;
        if (targetWay === "memory" && ways.includes("memory_position")) return true;
        if (targetWay === "memory_position" && ways.includes("memory")) return true;
        return false;
    }

    /** It's responsible to run agent plugins have the specific execution way
     * 
     * TODO: Add error resistant plugin execution behaviour as default and ignoring as option
    */
    private async runPlugins(executionWay: PluginExecutionWays, executionFrom?: Omit<ExecutionFrom, "way">) {
        const pluginsToRun = this.agentConfig.plugins?.filter(plugin => this.matchesExecutionWay(plugin.executionWay, executionWay));
        if (pluginsToRun?.length) {
            for (const plugin of pluginsToRun) {
                if (this.abortable.isAbortRequested()) {
                    return;
                }

                this.emitEvent("plugin_invoking", plugin.name, executionWay);
                
                const executionFromObjPass: ExecutionFrom = executionFrom ? { ...executionFrom, way: executionWay } : { way: executionWay, nodeType: "aside" };
                const runResult = await plugin.execute(executionFromObjPass, this.agentConfig, this.AgentGraph?.graphState ?? {});

                if (this.abortable.isAbortRequested()) {
                    return;
                }
                
                this.emitEvent("plugin_result", plugin.name, executionWay, runResult);

                if (runResult.status) {
                    if (runResult.result?.agentConfig) this.agentConfig = runResult.result.agentConfig;
                    if (runResult.result?.graphState && this.AgentGraph) this.AgentGraph.graphState = runResult.result.graphState;
                }
            }
        }
    }
    
    /**
     * 
     * @param withGraphState - is the optional parameter with what the graph will start
     * @returns 
     */
    private async runGraph(withGraphState?: Record<string, any>, modelOptions?: InvokeOptions): Promise<ReActAgentInvokeResult> {
        this.abortable.resetForRun();

        // Keep the message history
        if (modelOptions?.messages) {
            this.agentConfig.messages.push(...modelOptions.messages);
            // Delete messages from modelOptions to avoid double-passing/overwriting in main_node
            const { messages, ...restOptions } = modelOptions;
            modelOptions = restOptions;
        }

        // Initialize graph state first so plugins can modify it
        this.AgentGraph.graphState = {
            ...(withGraphState ?? {}),
            modelOptions: modelOptions ?? this.AgentGraph.graphState?.modelOptions
        };

        if (this.AgentGraph.graphState.isAborted || this.abortable.isAbortRequested()) {
            return this.abortable.createAbortedInvokeResult();
        }

        // Runs Plugins
        const beforeAgentPlugins = await this.abortable.runAbortable(() => this.runPlugins("before_agent_run"));

        if (beforeAgentPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
            return this.abortable.createAbortedInvokeResult();
        }
        
        const systemPromptExecution = await this.abortable.runAbortable(() => this.ensureWrappedSystemPrompt());

        if (systemPromptExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
            return this.abortable.createAbortedInvokeResult();
        }

        this.synchronizeModelConfig();

        // Run Agent
        const graphExecution = await this.abortable.runAbortable(() => this.AgentGraph.start());

        if (graphExecution === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
            return this.abortable.createAbortedInvokeResult();
        }

        // Sync
        this.synchronizeModelConfig();

        // Runs plugins
        const afterAgentPlugins = await this.abortable.runAbortable(() => this.runPlugins("after_agent_run"));

        if (afterAgentPlugins === ABORTED_OPERATION || this.abortable.isAbortRequested()) {
            return this.abortable.createAbortedInvokeResult();
        }
        
        return {
            messages: this.agentConfig.messages,
            state: this.AgentGraph.getState()
        };
    }
    
    async invoke(options?: InvokeOptions): Promise<ReActAgentInvokeResult> {
        return await this.runGraph(undefined, options);
    }

    async invokeStream(options?: InvokeOptions): Promise<AsyncIterable<ReActAgentStreamChunk>> {
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

                const execution = self.invoke(options)
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
