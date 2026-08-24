import { Graph, GraphMarkers } from "../../../../graph";
import { AgentCommunicationProtocolsSchema } from "../../../communication-protocols";
import { DeterministicMemorySchema, ToolBasedMemorySchema } from "../../../memory";
import { AgentModel, ConfiguredMemory, ReActAgentEvents, ReActAgentPluginSpec } from "../../../ReAct.agent";
import { SchemaSkillStore } from "../../../skills/stores/schema";
import { AgentMessagesGraphState } from "../../../state";
import { CodeExecutionSandboxSchema, Tool } from "../../../tools";
import { HITLTransportSchema } from "../../../tools/hitl/hitlToolSchema";
import { MCP } from "../../../tools/mcp/mcpTools";
import { ASTUtility } from "../../ast/ast";
import { LSPClient } from "../../lsp/lsp";
import { SupportedLanguageName } from "../../mutual";
import { CodeActSchema } from "../schema";
import { CodeActMessage, CodeActState } from "../shared";

export interface CodeActWorkspaceConfig {
    /** 
     * Defines whether the agent may access workspaces beyond the configured list
     * 
     * ### Possible values:
     * - true - allows to access with "ask-to-access" . It's alias to "ask-to-access" mode
     * - false - agent can access only to workspace specified by a user 
     * - "ask-to-access" - ask user to access a disk resource aside of a workspace via HITL
     * - "access-without-ask" - as default agent can access whatever disk resource
     * 
     * ## Notice
     * - Lack of HITL specified when mode is `true` or `ask-to-access` causes to omit the access - HITL has to be specified to allow to ask for access
     * 
     * @default false
    */
    accessBeyondList?: boolean | "ask-to-access" | "access-without-ask";
    list?: {
        workspaceId: string;
        root: string;
        workerIsolation: "snapshot";
        applyMode: "serialized";
    }[];

    /**
     * Specification how to handle the error when error occurs. This is additional specification due to ``
     * 
     * - stop - halts further execution and produces `error`
     * - ignore - ignores the error and starts to process other repositiories. Produces the error 
     * 
     * @default "stop"
     */
    listErrorStrategy?: "stop" | "ignore";
}

export interface CodeActPlanConfig {
    required?: boolean;
    maxSteps?: number;
}

export interface CodeActValidationCommand {
    name: string;
    command: string;
    args: string[];
    workingDirectory?: string;
    timeoutMs?: number;
    required?: boolean;
}

export interface CodeActValidationConfig {
    adjustCommandsToResult: boolean;
    /**
     * Whether Agent can make custom command to validate the outcome. When not specified use only the `preConfiguredCommands` or throwError, emit event or return output when config not specified
     * 
     * @default true
    */
    preConfiguredCommands: CodeActValidationCommand[];
}

export interface CodeActSandboxSchema extends CodeExecutionSandboxSchema {
    /** 
     * Amount of comands used to repair the failure after first command try
     * TODO: When corssed agent goes to other step and registers what isn't working
     *  - either in logic of harness
     *  - either in the model - by passing this param to the model
    */
    maxRepairAttempts?: number;
}

export interface CodeActSandboxConfig<Sandbox extends CodeActSandboxSchema> {
    default: Sandbox;
    byLanguage: Record<SupportedLanguageName, Sandbox>;
}

export interface CodeActInvokeOptions {
    /**
     * COntains the user task, tools execution, commands execution and the final message contains the rationale of generated response
     * 
     * Final message is type of `AIMessage` and it concludes the made changes in the code
     */
    messages: CodeActMessage[];
    abort?: AbortSignal;
}

export interface CodeActConfig<Skills extends SchemaSkillStore, Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>, HITL extends HITLTransportSchema, Sandbox extends CodeExecutionSandboxSchema> {
    pattern: "codeact";
    model: AgentModel;
    systemPrompt: string;

    /** Specify Workspaces where agent can work */
    workspaces: CodeActWorkspaceConfig;

    /** Specify plan where agent can work. Planning is executed always at the begining after snapshot of workspace directories */
    plan?: {
        /** Specify optionally as addition to planner system prompt */
        systemPrompt?: string;
        /**
         * Model is used to make plan
         * @default CodeActConfig.model - same model as this to produce the code
         */
        model?: AgentModel;
        // /** Specify whether has to be planning executed at the begining @default true */
        // required?: boolean;
        maxSteps: number;
    };
    
    /**
     * writeMode: "proposal" lets an IDE show the patch before apply it. writeMode: "apply" applies approved changes directly. A future transaction mode may stage all changes and commit them atomically.
    */
    writeMode: "proposal" | "apply";

    /** 
     * List with tools
     * MCP tools can be invoked here but in form
    */
    tools?: Tool<any, any>[];
    
    /** 
     * MCP servers
     */
    mcp?: MCP[];
    
    /**
     * List with LSP utilities
     * is a language-intelligence protocol for operations such as diagnostics, hover, definition lookup, references, rename, and completion
    */
    lsp?: LSPClient[];
    
    /** 
     * List with AST utilities
     * is a syntax-tree capability, usually local and language/parser-specific, for parsing, querying, and optionally transforming source code
    */
    ast?: ASTUtility[];
    
    /**
     * Skills is the set of skills the agent can use to perform some action
     * In CASCADE (https://arxiv.org/abs/2512.23880) scenario -> agent can develop his own skills
    */
    skills?: Skills[] | Skills;

    /** Communication protocols list */
    communicationProtocols?: AgentCommunicationProtocolsSchema.Schema[];
    
    /**
     * Supports ReActAgent plugins full list with optionally additional invoke places and events. List with plugins will be invoked from space
     * Optional. 
     * @default undefined
     * 
     * TODO: Add todo plugin executed before action `Plan-and-Act` pattern
     */
    plugins?: ReActAgentPluginSpec[]; // TODO: Optionally add another execution way unify the schema for plugin
    /**
     * Used to configure the tools asks and for additional informations
     * @default undefined
    */
    hitlConfig?: {
        /** They */
        hitl: HITL;
        /**
         * Specifies how to handle the default operations from the CodeAct logic
         * When not specified you're responsible to setup the tools you want to handle via the HITL by specify in the `hitl` specified handler
        */
        presetHitlStrategy?: "all" | "ignore";
    };
    /**
     * Memory for Coding Agent
     * 
     * TODO: Make dedicated memory has to be accessible there
    */
    memory: ConfiguredMemory<Memory> | ConfiguredMemory<Memory>[];
    /**
     * Place where code is executed
     */
    sandboxes: CodeActSandboxConfig<Sandbox>;

    /** Commands used to verify the code results */
    validationCommands: CodeActValidationConfig;

    /** As default is `false` boolean */
    parallelTools?: boolean;
}

/**
 * Status for CodeAct agent execution - it's less detailed than a `CodeActExecutionLifecyclePhases` due to made to descibe the overall phases
 * -  idle - is a mode when agent didn't start yer because hasn't got the
 * - `invoke` - is method resets the state at the begining to `idle` resolution sttae is kkept till next invokation 
 */
export type ReActAgentExecutionStatus =
    | "idle"
    | "running"
    | "waiting-for-approval"
    | "completed"
    | "blocked"
    | "failed"
    | "aborted";

/** Detailed instruction for agent execution compared to `ReActAgentExecutionStatus` */
export type CodeActExecutionLifecyclePhases =
    | "begining"
    | "inspect" 
    | "plan"
    | "propose"
    | "approval"
    | "apply"
    | "validate"
    | "repair"
    | "review"
    | "conclude";

export interface CodeActEvents<ReturnType = void | Promise<void>> extends ReActAgentEvents {
    /** Thrown each time some kind of error happens */
    error: (error: any, isExecutionStopped?: boolean) => ReturnType;
    /** Executed once `ReActAgentExecutionStatus` changes */
    execution_status_change: (status: ReActAgentExecutionStatus, codeactStatus: CodeActState) => ReturnType;
    /** Executed once `CodeActExecutionLifecyclePhases` changes */
    lifecylce_phase_change: (phase: CodeActExecutionLifecyclePhases, codeactStatus: CodeActState) => ReturnType;
    // For execution command
    validation_command_start: (command: CodeActValidationCommand) => ReturnType;
    validation_command_end: (command: CodeActValidationCommand) => ReturnType;
}

// List with defaults
const DEFAULT_LIST_ERROR_STRATEGY: CodeActConfig<any, any, any, any>["workspaces"]["listErrorStrategy"] = "stop";

// Logic
export class CodeActAgent<Skills extends SchemaSkillStore, Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>, HITL extends HITLTransportSchema, Sandbox extends CodeExecutionSandboxSchema> implements CodeActSchema<CodeActInvokeOptions, Promise<CodeActState>> {
    protected pattern: "codeact" = "codeact";
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    private tools: Tool<any, any>[] = [];
    config: CodeActConfig<Skills, Memory, HITL, Sandbox>;

    /** 
     * `null` - for first run
     * 
     * Overriden once `invoke` is executed - persists to the next `invoke` method execution
     */
    state: CodeActState | null = null;

    constructor(config: CodeActConfig<Skills, Memory, HITL, Sandbox>) {
        this.config = config;

        // Assignes default error handling strategy for workspace list error - it's to be pasted before `validateWorkspaces`
        if (!this.config.workspaces.listErrorStrategy) {
            this.config.workspaces.listErrorStrategy = DEFAULT_LIST_ERROR_STRATEGY;
        }

        // Validates workspaces
        this.validateWorkspaces();

        // Snapshots
        this.snapshotWorkspace();

        // TODO: Define default tools
        // TODO: Define these tools default names
        // TODO: Define events from these tools calling

        // TODO: HITL - define the hitl for these methods regard to `htilConfig.presetHitlStrategy`
        
        // Logic Graph
        const reactAgentGraph = new Graph<AgentMessagesGraphState>({});

        // TODO: Define plugins
        
        /* reactAgentGraph
            .addNode("executor", async state => {
                
            })
            .addNode("sandbox", async state => {

            });

        if (this.config.plan) {
            reactAgentGraph.addNode("plan", async state => {

            })

            reactAgentGraph
                .addEdge(GraphMarkers.START, "plan")
                .addEdge("plan", "executor");
        } */
    }

    onEvent<EventName extends keyof CodeActEvents>(
        eventName: EventName,
        eventListener: CodeActEvents[EventName]
    ): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    protected emitEvent<EventName extends keyof CodeActEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<CodeActEvents[EventName]>
    ) {
        
    }

    /** 
     * Checks whether workspaces are in square with Config and assumptions
     * TODO:
     * 1. Check: Does file exists
     * 2. Produce errors according to `workspaces.listErrorStrategy` when file doesn't exists or the folder
    */
    private async validateWorkspaces() {
        /*  */
    }
    
    /** Takes all files and snapshots its content */
    private async snapshotWorkspace() {
        
    }

    /**
     * Overrrides the messages list
     * 
     * Implementation has to specify:
     * 1. Use and explore the skills
     * 2. Snapshot wotking directories
     * 3. Snapshot the files agent has access from beyond the files to allow them to be rolled back
     * 4. Produce AST for the changes
     * 5. `inspect -> plan -> act -> validate -> repair loop` 
     * 6. Use and explore the tools
     * 7. Emit events from action
     * 8. Update the execution step
     * 9. Use memory and update the memory as required and emit memory events
     * 
     * TODO: Specify result for the action
     * 
     * @param options 
     */
    async invoke(options: CodeActInvokeOptions): Promise<CodeActState> {
        
        void options;
        throw new Error("CodeActAgent.invoke is not implemented yet.");
    }

    /** Perform rollback of agent changes from given state */
    async rollback(state: CodeActState) {
        return false;
    }
}

