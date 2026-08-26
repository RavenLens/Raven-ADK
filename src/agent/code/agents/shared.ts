import { AIMessage, MessagesVariations } from "../../state";
import { SupportedLanguageName } from "../mutual";
import { CodeActExecutionLifecyclePhases, ReActAgentExecutionStatus } from "./codeact/codeact.agent";

/** Each message format has to represent: read, write and each tool usage */
export type CodeActMessage = MessagesVariations & {
    timeStamp: number;
}

interface CodingTask {
    id: string;
    title: string;
    instructions: string;
    dependencies: string[];
    acceptanceCriteria: string[];
    allowedPaths?: string[];
    requiredCapabilities?: string[];
    validationCommandNames?: string[];
}

interface CodingPlan {
    id: string;
    objective: string;
    tasks: CodingTask[];
    createdBy: string;
    rationale?: string;
}

type FileOperation = "create" | "update" | "delete" | "rename";

interface ChangedFile {
    path: string;
    operation: FileOperation;
    previousHash?: string;
    nextHash?: string;
    diff?: string;
    content?: string;
    /** Lines from where to where changes apply */
    lines?: {
        from: number;
        to: number;
    };
}


interface ChangeSet {
    /** Specified for workspace when change is for this workspace */
    workspaceId?: string;
    /** id of changes */
    id: string;
    taskId: string;
    actorId: string;
    baseRevision: string;
    files: ChangedFile[];
    status: "proposed" | "approved" | "applied" | "rejected" | "conflicted";
    rationale?: string;
}

interface ValidationResult {
    name: string;
    command: string;
    args: string[];
    cwd: string;
    success: boolean;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    durationMs: number;
    error?: string;
}

export type CodeActTraceType =
    | "llm_call"
    | "code_execution"
    | "command_execution"
    | "file_operation"
    | "tool_call"
    | "lsp_call"
    | "ast_operation"
    | "validation"
    | "lifecycle_transition"
    | "approval";

export interface BaseCodeActTrace {
    id: string;
    type: CodeActTraceType;
    timestamp: number;
    durationMs?: number;
    taskId?: string;
    lifecyclePhase?: CodeActExecutionLifecyclePhases;
    success?: boolean;
    error?: string;
    metadata?: Record<string, any>;
}

export interface CodeActLLMTrace extends BaseCodeActTrace {
    type: "llm_call";
    promptTokens?: number;
    completionTokens?: number;
    model?: string;
    inputMessages?: MessagesVariations[];
    outputMessage?: AIMessage | string;
}

export interface CodeActCodeExecutionTrace extends BaseCodeActTrace {
    type: "code_execution";
    language?: SupportedLanguageName;
    code: string;
    output?: string;
    finalAnswer?: string | null;
    isError?: boolean;
}

export interface CodeActCommandExecutionTrace extends BaseCodeActTrace {
    type: "command_execution";
    command: string;
    args: string[];
    cwd?: string;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
}

export interface CodeActFileOperationTrace extends BaseCodeActTrace {
    type: "file_operation";
    path: string;
    operation: FileOperation | "read";
    workspaceId?: string;
    diff?: string;
    bytesRead?: number;
    linesAffected?: {
        from: number;
        to: number;
    };
}

export interface CodeActToolTrace extends BaseCodeActTrace {
    type: "tool_call";
    toolId: string;
    toolName?: string;
    isMcp?: boolean;
    arguments: Record<string, any> | null;
    toolOutput?: string;
}

export interface CodeActLSPTrace extends BaseCodeActTrace {
    type: "lsp_call";
    method: string;
    filePath?: string;
    params?: any;
    result?: any;
}

export interface CodeActASTTrace extends BaseCodeActTrace {
    type: "ast_operation";
    operation: string;
    filePath?: string;
    details?: any;
}

export interface CodeActValidationTrace extends BaseCodeActTrace {
    type: "validation";
    validation: ValidationResult;
    repairAttempt?: number;
}

export interface CodeActLifecycleTrace extends BaseCodeActTrace {
    type: "lifecycle_transition";
    fromStatus?: ReActAgentExecutionStatus;
    toStatus?: ReActAgentExecutionStatus;
    fromPhase?: CodeActExecutionLifecyclePhases;
    toPhase?: CodeActExecutionLifecyclePhases;
    reason?: string;
}

export interface CodeActApprovalTrace extends BaseCodeActTrace {
    type: "approval";
    changeSetId?: string;
    approved: boolean;
    reviewedBy?: string;
    feedback?: string;
}

/** Discriminated union of all executable events, tool calls, commands, and operations recorded by CodeAct */
export type CodeActTrace =
    | CodeActLLMTrace
    | CodeActCodeExecutionTrace
    | CodeActCommandExecutionTrace
    | CodeActFileOperationTrace
    | CodeActToolTrace
    | CodeActLSPTrace
    | CodeActASTTrace
    | CodeActValidationTrace
    | CodeActLifecycleTrace
    | CodeActApprovalTrace;


export interface CodeActState {
    /** Id of run action generated at the begining by a `invoke` method call */
    runId: string;
    /** Status for a execution */
    executionStatus: ReActAgentExecutionStatus;
    /** Detailed instruction in phases */
    lifecyclePhase: CodeActExecutionLifecyclePhases;
    /** Plan for execition */
    plan?: CodingPlan;
    activeTaskId?: string;
    /** List with made changes in workspace and files */
    changes: ChangeSet[];
    /** List with everything was executed has the timestamp */
    traces: CodeActTrace[];
    /** List with messages pasted to the chat - each execution delivers new messages */
    messages: CodeActMessage[];
    validations: ValidationResult[];
    repairAttempts: number;
    unresolved: string[];
    isAborted?: boolean;
}
