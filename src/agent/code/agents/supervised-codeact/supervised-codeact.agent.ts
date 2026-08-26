
import type { DeterministicMemorySchema, ToolBasedMemorySchema } from "../../../memory";
import type { AgentModel, ConfiguredMemory, ReActAgentPluginSpec } from "../../../ReAct.agent";
import type { SchemaSkillStore } from "../../../skills/stores/schema";
import type { CodeExecutionSandboxSchema, Tool } from "../../../tools";
import type { HITLTransportSchema } from "../../../tools/hitl/hitlToolSchema";
import type { MCP } from "../../../tools/mcp/mcpTools";
import { ASTUtility } from "../../ast/ast";
import { LSPClient } from "../../lsp/lsp";
import type {
	CodeActInvokeOptions,
	CodeActPlanConfig,
	CodeActSandboxConfig,
	CodeActValidationCommand,
	CodeActWorkspaceConfig
} from "../codeact/codeact.agent";
import { CodeActSchema } from "../schema";
import { CodeActState } from "../shared";

/** A worker that implements a task or coordinates work inside a group. */
export type WorkerSubrole = "worker" | "coordinator-of-group";

/**
 * Worker subrole values accepted by the configuration surface.
 *
 * The array and legacy spellings keep the illustrative Vision configuration
 * source-compatible while `WorkerSubrole` remains the canonical contract.
 */
export type WorkerSubroleInput =
	| WorkerSubrole
	| "coordinator-of-workers"
	| "cooridinator-of-workers"
	| WorkerSubrole[]
	| ("worker" | "coordinator-of-workers" | "cooridinator-of-workers")[];

/** Determines which actors can see messages exchanged inside a group. */
export type GroupPrivacy =
	| "all"
	| "private"
	| "private-with-coordinator"
	| "private-with-coordinator-and-supervisor";

export interface GroupQScore {
	/** Stable identifier of the group whose usefulness is measured. */
	groupId: string;
	/** Learning boundary used with `groupId`, such as a workspace or project. */
	scope: string;
	/** Normalized usefulness score in the inclusive range `[0, 1]`. */
	qScore: number;
	/** Number of validated updates represented by this score. */
	updates: number;
	/** Time of the latest update, represented as epoch milliseconds. */
	updatedAt?: number;
}

export interface GroupQScoreStore {
	/** Loads a score using both the configured scope and stable group identifier. */
	get(scope: string, groupId: string): Promise<GroupQScore | undefined>;
	/** Persists a validated score update for later runs. */
	set(score: GroupQScore): Promise<void>;
}

export interface GroupQScoreConfiguration {
	/**
	 * Score used when no durable score exists yet. Values must be in `[0, 1]`;
	 * the documented default is `0.5`.
	 */
	initialQScore: number;
	/**
	 * Durable persistence boundary for group usefulness. The store is keyed by
	 * `scope` and `groupId` and must not be replaced by process-local state.
	 */
	scoreStore: GroupQScoreStore;
	/** Identifies the learning boundary shared by later runs. */
	scope: string;
}

export interface WorkerWorkspaceAccessBeyondList {
	/** Whether the worker may access workspaces outside the supervisor list. */
	access: boolean;
	/** Requests HITL approval when beyond-list access is used. */
	behaviour?: "HITL";
	/** US spelling of `behaviour`. */
	behavior?: "HITL";
}

export interface WorkerWorkspaceSelection {
	/** Workspace identifier from the supervisor workspace registry. */
	id: string;
	/** Optional file and directory restrictions within the selected workspace. */
	allowedWorkspaceSubspaces?: string[];
}

export interface WorkerWorkspaceConfig {
	/**
	 * Restricts or extends the worker's access beyond the supervisor workspace
	 * list. An object can require HITL approval for the extension.
	 */
	accessBeyondList?: boolean | WorkerWorkspaceAccessBeyondList;
	/**
	 * Workspace IDs or workspace-specific path selections. A string grants
	 * access to the selected workspace; omitted values inherit supervisor access.
	 */
	listIds?: string | (string | WorkerWorkspaceSelection)[];
}

export interface CodingWorkerConfig<
	Skills extends SchemaSkillStore = SchemaSkillStore,
	Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any> = DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
	HITL extends HITLTransportSchema = HITLTransportSchema,
	Sandbox extends CodeExecutionSandboxSchema = CodeExecutionSandboxSchema
> {
	/** Stable identifier used by task assignment and group definitions. */
	id: string;
	/** Worker or group-coordinator role, including Vision compatibility forms. */
	subrole: WorkerSubroleInput;
	/** Model used for this worker's reasoning and implementation. */
	model: AgentModel;
	/** Optional worker-specific system instructions. */
	systemPrompt?: string;
	/** Human-readable role assigned to the worker. */
	roleDescription: string;
	/** Bounded responsibilities used when assigning work to the worker. */
	responsibilities: string[];
	/** Tools available to the worker. */
	tools: Tool<any, any>[];
	/** MCP servers whose tools may be exposed to the worker. */
	mcp?: MCP[];
	/** Optional skill store available to the worker. */
	skills?: Skills;
	/** Optional coding memory available to the worker. */
	memory?: ConfiguredMemory<Memory> | ConfiguredMemory<Memory>[];
	/** ReAct lifecycle plugins available to the worker. */
	plugins?: ReActAgentPluginSpec[];
	/** Human-in-the-loop transport used by the worker. */
	hitl?: HITL;
	/** Language-specific execution sandboxes available to the worker. */
	sandboxes?: CodeActSandboxConfig<Sandbox>;
	/** Canonical path restrictions applied to worker reads and writes. */
	allowedPaths?: string[];
	/** Paths that extend the worker's configured workspace access. */
	allowedPathsBeyondWorkspace?: string[];
	/** Vision example spelling retained for source compatibility. */
	allowedPathsBeyondWorkdpace?: string[];
	/** Prevents the worker from applying mutations. */
	readOnly?: boolean;
	/** Optional worker-specific workspace selection and access policy. */
	workspaces?: WorkerWorkspaceConfig;
}

export interface SupervisedCodeActSupervisorConfig<
	Skills extends SchemaSkillStore = SchemaSkillStore,
	Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any> = DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
	HITL extends HITLTransportSchema = HITLTransportSchema,
	Sandbox extends CodeExecutionSandboxSchema = CodeExecutionSandboxSchema
> {
	/** Model that plans, delegates, reviews, and accepts the run. */
	model: AgentModel;
	/** Optional supervisor-specific system instructions. */
	systemPrompt?: string;
	/** Human-readable authority and responsibility description. */
	roleDescription: string;
	/** Responsibilities owned by the supervisor for the complete run. */
	responsibilities: string[];
	/** Optional tools used by the supervisor for orchestration and review. */
	tools?: Tool<any, any>[];
	/** MCP servers whose tools may be exposed to the supervisor. */
	mcp?: MCP[];
	/** Optional skill store available to the supervisor. */
	skills?: Skills;
	/** Optional coding memory available to the supervisor. */
	memory?: ConfiguredMemory<Memory> | ConfiguredMemory<Memory>[];
	/** ReAct lifecycle plugins available to the supervisor. */
	plugins?: ReActAgentPluginSpec[];
	/** Human-in-the-loop transport used by the supervisor. */
	hitl?: HITL;
	/** Optional execution sandboxes used by supervisor-owned commands. */
	sandboxes?: CodeActSandboxConfig<Sandbox>;
}

export interface GroupDefinition {
	/** Stable identifier used to select the predefined group. */
	id: string;
	/** Workers assigned to the group. */
	workerIds: string[];
	/** Optional plan task IDs assigned to the group. */
	taskIds?: string[];
	/** Optional worker ID that coordinates the group. */
	coordinatorId?: string;
}

export interface GroupReplicationConfig {
	/** Whether the supervisor may run replicated copies of a group. */
	enabled: boolean;
	/** Number of replicas in addition to the original group. */
	maxReplicas: number;
	/** Whether every eligible group must be replicated. */
	force?: boolean;
}

export interface GroupCoordinatorConfig {
	/** Whether groups may have a coordinator. */
	enabled: boolean;
	/** Whether the coordinator may also implement a task. */
	participates: boolean;
	/** Canonical bound for coordinator-driven delegation and repair cycles. */
	maxDelegationCycles?: number;
	/** Vision example name for `maxDelegationCycles`. */
	coordinatorMaxDelegationCycles?: number;
	/** Canonical bound for worker-local retries before escalation. */
	maxIndependentWorkerRetries?: number;
	/** Vision example spelling for `maxIndependentWorkerRetries`. */
	workerMaxIndeoendentRetries?: number;
	/** Whether the coordinator should try to solve issues proactively. */
	proactiveSolver?: boolean;
	/** Whether the coordinator receives remaining delegation-cycle context. */
	bewareRemainingDelegationCycles?: boolean;
}

export interface GroupConfiguration {
	/** Whether the supervisor may create groups beyond configured definitions. */
	allowCreation: boolean;
	/** Maximum number of active groups, including groups waiting to apply. */
	maxParallel: number;
	/** Initial and durable persistence settings for group usefulness scores. */
	qScore: GroupQScoreConfiguration;
	/** Group message visibility and communication policy. */
	communication: {
		/** Whether workers may exchange messages within a group. */
		enabled: boolean;
		/** Actors permitted to view group messages. */
		privacy: GroupPrivacy;
	};
	/** Whether and how groups are replicated for comparison. */
	replication: GroupReplicationConfig;
	/** Coordinator behavior and delegation limits for each group. */
	coordinator: GroupCoordinatorConfig;
	/** Whether predefined group definitions may be selected. */
	usePredefined?: boolean;
	/** Canonical predefined group definitions. */
	definitions?: GroupDefinition[];
	/** Vision example name for `definitions`. */
	preDefinedGroups?: GroupDefinition[];
}

export type SupervisedCodeActAttemptsExceededBehaviour = "result" | "error";

export interface SupervisedCodeActValidationConfig {
	/** Whether the supervisor may compose or adjust validation commands per result. */
	adjustCommandToResult?: boolean;
	/** Validation commands configured in advance for each supervised run. */
	preConfiguredCommands?: CodeActValidationCommand[];
	/** Alternate shared configuration name for preconfigured validation commands. */
	commands?: CodeActValidationCommand[];
	/** Maximum repair attempts after failed validation evidence. */
	maxRepairAttempts?: number;
	/** Outcome when the repair budget is exhausted. Defaults to returning a result. */
	attemptsExceededBehaviour?: SupervisedCodeActAttemptsExceededBehaviour;
}

export interface SupervisedCodeActConfig<
	Skills extends SchemaSkillStore,
	Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
	HITL extends HITLTransportSchema,
	Sandbox extends CodeExecutionSandboxSchema
> {
	/** Identifies this configuration as the supervised multi-agent pattern. */
	pattern: "supervised-codeact";
	/** Supervisor that owns planning, delegation, review, and acceptance. */
	supervisor: SupervisedCodeActSupervisorConfig<Skills, Memory, HITL, Sandbox>;
	/** Registry of workers the supervisor may assign to tasks and groups. */
	workers: CodingWorkerConfig<Skills, Memory, HITL, Sandbox>[];
	/** Runtime group creation, communication, replication, and Q-Score policy. */
	groups: GroupConfiguration;
	/** Supervisor workspace registry and serialized application policy. */
	workspaces: CodeActWorkspaceConfig;
	/** Optional tools shared with or exposed to the supervisor. */
	tools?: Tool<any, any>[];
	/** MCP servers available to the supervised run. */
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
	/** Optional system instructions shared by the supervised run. */
	systemPrompt?: string;
	/** Optional bounded plan settings inherited from the CodeAct contract. */
	plan?: CodeActPlanConfig;
	/** Optional skill store shared by the supervised run. */
	skills?: Skills;
	/** Optional coding memory shared by the supervised run. */
	memory?: ConfiguredMemory<Memory> | ConfiguredMemory<Memory>[];
	/** ReAct lifecycle plugins applied to the supervised run. */
	plugins?: ReActAgentPluginSpec[];
	/** Human-in-the-loop transport used for approvals and additional context. */
	hitl?: HITL;
	/** Sandboxes used for supervisor and worker code execution. */
	sandboxes?: CodeActSandboxConfig<Sandbox>;
	/** Commands and repair policy used to produce validation evidence. */
	validation: SupervisedCodeActValidationConfig;
	/** Signal used to stop the supervised run. */
	abort?: AbortSignal;
}

export class SupervisedCodeActAgent<
	Skills extends SchemaSkillStore,
	Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
	HITL extends HITLTransportSchema,
	Sandbox extends CodeExecutionSandboxSchema
> implements CodeActSchema<CodeActInvokeOptions, Promise<CodeActState>> {
	protected pattern: "supervised-codeact" = "supervised-codeact";
	/** Configuration captured by this agent instance. */
	config: SupervisedCodeActConfig<Skills, Memory, HITL, Sandbox>;

	/** 
     * `null` - for first run
     * 
     * Overriden once `invoke` is executed - persists to the next `invoke` method execution
	*/
	state: CodeActState | null = null;

	constructor(config: SupervisedCodeActConfig<Skills, Memory, HITL, Sandbox>) {
		this.config = config;
	}

	/** TODO: */
	async invoke(options: CodeActInvokeOptions): Promise<CodeActState> {
        void options;
        throw new Error("CodeActAgent.invoke is not implemented yet.");
    }

    /** Perform rollback of agent changes from given state */
    async rollback(state: CodeActState) {
        return false;
    }
}
