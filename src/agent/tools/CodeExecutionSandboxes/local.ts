import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import vm from 'node:vm';
import { CodeExecuteOutput, CodeExecutionSandboxSchema, CommandExecutionOptions, CommandExecutionOutput } from "./mutual";

export class LocalExecutionSandbox implements CodeExecutionSandboxSchema {
    async execute(code: string, contextData: any, logs: string[], ...args: any[]): Promise<CodeExecuteOutput> {
        const vmContext = vm.createContext({
            ...contextData,
            console: {
                log: (...args: any[]) => logs.push(args.join(' ')),
                error: (...args: any[]) => logs.push("ERROR: " + args.join(' ')),
                warn: (...args: any[]) => logs.push("WARN: " + args.join(' ')),
                info: (...args: any[]) => logs.push("INFO: " + args.join(' '))
            },
            process,
            Buffer,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            setImmediate,
            clearImmediate,
        });

        // Wrap the code in an async IIFE to support top-level await if needed
        const wrappedCode = `
            (async () => {
                try {
                    ${code}
                } catch (err) {
                    console.error(err.message);
                }
            })();
        `;

        try {
            const script = new vm.Script(wrappedCode);
            const result = await script.runInContext(vmContext);

            return {
                output: logs.join('\n'),
                finalAnswer: result,
                isError: false
            };
        } catch (error: any) {
            logs.push("FATAL ERROR: " + error.message);
            return {
                output: logs.join('\n'),
                finalAnswer: null,
                isError: true
            };
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
                // On Windows, use shell: true for some commands if needed, 
                // but Skills uses shell: false, so we stick to it for consistency.
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
                    success: !timedOut && exitCode === 0,
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