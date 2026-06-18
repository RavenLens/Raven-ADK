export type CodeExecuteOutput = {
    output: string;
    finalAnswer: string | null | undefined;
    /** When specified as `true` statisifies the error has happen for RLM */
    isError?: boolean;
}

export interface CodeExecutionSandboxSchema {
    execute(code: string, contextData: any, logs: string[], ...args: any[]): Promise<CodeExecuteOutput>;
}
