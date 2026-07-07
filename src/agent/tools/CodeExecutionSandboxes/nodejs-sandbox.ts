import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import vm from 'node:vm';
import { CodeExecuteOutput, CodeExecutionSandboxSchema, CommandExecutionOptions, CommandExecutionOutput } from "./mutual";

export class NodeExecutionSandbox implements CodeExecutionSandboxSchema {
    name: string = "NodeSandbox";
    
    async execute(code: string, sandboxContextData: vm.Context, logs?: string[]): Promise<CodeExecuteOutput> {
        const vmContext = vm.createContext(sandboxContextData);

        // Wrap the agent's code in an async IIFE to support top-level await
        const wrappedCode = `
            (async () => {
                try {
                    ${code}
                } catch (err) {
                    console.error(err.message);
                }
            })();
        `;

        const script = new vm.Script(wrappedCode);

        try {
            await script.runInContext(vmContext);
            const result = {
                output: logs?.join('\n') ?? "",
                finalAnswer: vmContext.finalAnswer
            };
            return result;
        } catch (error: any) {
            const result = { output: `Execution Error: ${error.message}`, finalAnswer: null, isError: true };
            return result;
        }
    }

    async executeCommand(command: string, args: string[], options: CommandExecutionOptions): Promise<CommandExecutionOutput> {
        const trimmedCommand = command.trim();
        const cwd = options.workingDirectory?.trim().length
            ? path.resolve(options.workingDirectory)
            : process.cwd();

        if (!trimmedCommand.length) {
            return {
                success: false,
                command: trimmedCommand,
                args,
                cwd,
                exitCode: null,
                timedOut: false,
                stdout: "",
                stderr: "",
                truncatedStdout: false,
                truncatedStderr: false,
                error: "Command cannot be empty."
            };
        }

        if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
            return {
                success: false,
                command: trimmedCommand,
                args,
                cwd,
                exitCode: null,
                timedOut: false,
                stdout: "",
                stderr: "",
                truncatedStdout: false,
                truncatedStderr: false,
                error: `Working directory does not exist or is not a directory: "${cwd}"`
            };
        }

        const timeout = this.getExecutionTimeout(options.timeoutMs);

        return new Promise<CommandExecutionOutput>((resolve) => {
            let stdout = "";
            let stderr = "";
            let truncatedStdout = false;
            let truncatedStderr = false;
            let timedOut = false;

            const child = spawn(trimmedCommand, args, {
                cwd,
                shell: false,
                windowsHide: true,
            });

            const timeoutHandle = setTimeout(() => {
                timedOut = true;
                child.kill();
            }, timeout);

            child.stdout?.on("data", (chunk) => {
                const appendResult = this.appendProcessOutput(stdout, String(chunk));
                stdout = appendResult.value;
                truncatedStdout = truncatedStdout || appendResult.truncated;
            });

            child.stderr?.on("data", (chunk) => {
                const appendResult = this.appendProcessOutput(stderr, String(chunk));
                stderr = appendResult.value;
                truncatedStderr = truncatedStderr || appendResult.truncated;
            });

            child.on("error", (error) => {
                clearTimeout(timeoutHandle);

                resolve({
                    success: false,
                    command: trimmedCommand,
                    args,
                    cwd,
                    exitCode: null,
                    timedOut,
                    stdout,
                    stderr,
                    truncatedStdout,
                    truncatedStderr,
                    error: error.message
                });
            });

            child.on("close", (exitCode) => {
                clearTimeout(timeoutHandle);

                resolve({
                    success: !timedOut && (exitCode === 0 || exitCode === null),
                    command: trimmedCommand,
                    args,
                    cwd,
                    exitCode,
                    timedOut,
                    stdout,
                    stderr,
                    truncatedStdout,
                    truncatedStderr,
                    error: timedOut ? `Command timed out after ${timeout}ms.` : undefined
                });
            });
        });
    }

    private getExecutionTimeout(timeoutMs?: number): number {
        if (!Number.isFinite(timeoutMs)) {
            return 45_000;
        }

        const numericTimeout = Number(timeoutMs);

        return Math.min(300_000, Math.max(1_000, Math.floor(numericTimeout)));
    }

    private appendProcessOutput(
        currentValue: string,
        chunk: string,
        maxLength = 24_000
    ): { value: string; truncated: boolean } {
        if (currentValue.length >= maxLength) {
            return { value: currentValue, truncated: true };
        }

        const allowedChunkLength = maxLength - currentValue.length;
        const clippedChunk = chunk.slice(0, allowedChunkLength);
        const nextValue = `${currentValue}${clippedChunk}`;

        return {
            value: nextValue,
            truncated: clippedChunk.length < chunk.length
        };
    }
}
