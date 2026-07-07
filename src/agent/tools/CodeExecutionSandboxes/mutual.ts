export type CodeExecuteOutput = {
    output: string;
    finalAnswer: string | null | undefined;
    /** When specified as `true` statisifies the error has happen for RLM */
    isError?: boolean;
}

export interface CommandExecutionOptions {
    workingDirectory?: string;
    timeoutMs?: number;
}

export interface CommandExecutionOutput {
    success: boolean;
    command: string;
    args: string[];
    cwd: string;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    truncatedStdout: boolean;
    truncatedStderr: boolean;
    error?: string;
}

export interface CodeExecutionSandboxSchema {
    /** Provide name for sandbox to be known e.g: at telemetry for execution of sandbox */
    name: string;
    execute(code: string, contextData: any, logs: string[], ...args: any[]): Promise<CodeExecuteOutput>;
    executeCommand(command: string, args: string[], options: CommandExecutionOptions): Promise<CommandExecutionOutput>;
}
