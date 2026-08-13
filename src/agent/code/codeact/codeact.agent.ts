import { DeterministicMemorySchema, ToolBasedMemorySchema } from "../../memory";
import { AgentModel, ConfiguredMemory, ReActAgentPluginSpec } from "../../ReAct.agent";
import { SchemaSkillStore } from "../../skills/stores/schema";
import { CodeExecutionSandboxSchema, Tool } from "../../tools";
import { HITLTransportSchema } from "../../tools/hitl/hitlToolSchema";
import { MCP } from "../../tools/mcp/mcpTools";

export type SupportedLanguageName = string;

export interface CodeActWorkspaceConfig {
    /** Defines whether the agent may access workspaces beyond the configured list. */
    accessBeyondList?: boolean;
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
    commands: CodeActValidationCommand[];
    maxRepairAttempts?: number;
}

export interface CodeActSandboxConfig<Sandbox extends CodeExecutionSandboxSchema> {
    default: Sandbox;
    byLanguage: Record<SupportedLanguageName, Sandbox>;
}

export interface CodeActConfig<Skills extends SchemaSkillStore, Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>, HITL extends HITLTransportSchema, Sandbox extends CodeExecutionSandboxSchema> {
    pattern: "codeact";
    model: AgentModel;
    systemPrompt: string;
    workspaces: CodeActWorkspaceConfig;
    mcp?: MCP[];
    /**
     * Skills is the set of skills the agent can use to perform some action
     * In CASCADE (https://arxiv.org/abs/2512.23880) scenario -> agent can develop his own skills
    */
    skills?: Skills;
    /**
     * Supports ReActAgent plugins full list with optionally additional invoke places and events. List with plugins will be invoked from space
     * Optional. 
     * @default undefined
     * 
     * TODO: Add todo plugin executed before action `Plan-and-Act` pattern
     */
    plugins?: ReActAgentPluginSpec[]; // TODO: Optionally add another execution way unify the schema for plugin
    tools: Tool<any, any>[];
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
     * TODO: Make dedicated memory
    */
    memory: ConfiguredMemory<Memory> | ConfiguredMemory<Memory>[];
    /**
     * Place where code is executed
     */
    sandboxes: CodeActSandboxConfig<Sandbox>;
    validation: CodeActValidationConfig;
}

export class CodeActAgent<Skills extends SchemaSkillStore, Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>, HITL extends HITLTransportSchema, Sandbox extends CodeExecutionSandboxSchema> {
    protected pattern: "codeact" = "codeact";
    config: CodeActConfig<Skills, Memory, HITL, Sandbox>;

    constructor(config: CodeActConfig<Skills, Memory, HITL, Sandbox>) {
        this.config = config;
    }
}

