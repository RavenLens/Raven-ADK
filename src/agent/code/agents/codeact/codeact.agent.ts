import { DeterministicMemorySchema, ToolBasedMemorySchema } from "../../../memory";
import { AgentModel, ConfiguredMemory, ReActAgentEvents, ReActAgentPluginSpec } from "../../../ReAct.agent";
import { SchemaSkillStore } from "../../../skills/stores/schema";
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
    /** Amount of comands used to repair the failure after first command try */
    maxRepairAttempts?: number;
}

export interface CodeActSandboxConfig<Sandbox extends CodeExecutionSandboxSchema> {
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
    /** Specify plan where agent can work */
    plan?: {
        required: boolean;
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
     * 
     * TODO: Configure HITL for the CodeAct and Supervised Code act - allow to apply additional fields - or use mutually when possilbe Hitl can get the config for **validation** additionally TODO: Add Hybrid HITL with configuration
     */
    hitl?: HITL;
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
    // TODO: List with communication protocols for the Agents specify once communication protocols shape is done
    // communicationProtocols: any;
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
    /** Executed once `ReActAgentExecutionStatus` changes */
    execution_status_change: (status: ReActAgentExecutionStatus, codeactStatus: CodeActState) => ReturnType;
    /** Executed once `CodeActExecutionLifecyclePhases` changes */
    lifecylce_phase_change: (phase: CodeActExecutionLifecyclePhases, codeactStatus: CodeActState) => ReturnType;

    // For execution command
    validation_command_start: (command: CodeActValidationCommand) => ReturnType;
    validation_command_end: (command: CodeActValidationCommand) => ReturnType;
}

export class CodeActAgent<Skills extends SchemaSkillStore, Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>, HITL extends HITLTransportSchema, Sandbox extends CodeExecutionSandboxSchema> implements CodeActSchema <CodeActInvokeOptions, Promise<CodeActState>> {
    protected pattern: "codeact" = "codeact";
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    config: CodeActConfig<Skills, Memory, HITL, Sandbox>;

    /** 
     * `null` - for first run
     * 
     * Overriden once `invoke` is executed - persists to the next `invoke` method execution
     */
    state: CodeActState | null = null;

    constructor(config: CodeActConfig<Skills, Memory, HITL, Sandbox>) {
        this.config = config;
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

