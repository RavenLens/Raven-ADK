import { Sandbox } from '@e2b/code-interpreter'
import { CodeExecuteOutput, CodeExecutionSandboxSchema, CommandExecutionOptions, CommandExecutionOutput } from './mutual'

type E2BSandboxConnectionOpts = Parameters<(typeof Sandbox.create)>[1];

export class E2BExecutionSandbox implements CodeExecutionSandboxSchema {
    name: string = "E2B-Sandbox";
    sandboxConnectionOptions?: E2BSandboxConnectionOpts;
    
    constructor(sandboxConnectionOptions?: E2BSandboxConnectionOpts) {
        this.sandboxConnectionOptions = sandboxConnectionOptions;
    }
    
    async execute(code: string, sandboxContextData: any, logs: string[]): Promise<CodeExecuteOutput> {
        const sbx = await Sandbox.create(this.sandboxConnectionOptions);

        try {
            // Setup the global environment matched to RLM expectations
            const setupCode = `
const contextData = ${JSON.stringify(sandboxContextData.contextData || "")};
let finalAnswer = undefined;
const submitFinalAnswer = (answer) => { finalAnswer = answer; };
`;

            const wrappedCode = `
${setupCode}
await (async () => {
    try {
        ${code}
    } catch (err) {
        console.error("Execution Error: " + err.message);
    }
})();
finalAnswer;`;

            const execution = await sbx.runCode(wrappedCode);

            // Forward logs to RLM
            if (execution.logs.stdout) {
                execution.logs.stdout.forEach(msg => logs.push(msg));
            }
            if (execution.logs.stderr) {
                execution.logs.stderr.forEach(msg => logs.push("ERROR: " + msg));
            }

            const finalAnswerResult = execution.results.length > 0 ? execution.results[0].text : undefined;

            return {
                output: logs.join('\n'),
                finalAnswer: finalAnswerResult as string | null | undefined,
                isError: !!execution.error
            };
        } catch (error: any) {
            return {
                output: "E2B Sandbox Error: " + error.message,
                finalAnswer: null,
                isError: true
            };
        } finally {
            await sbx.kill();
        }
    }

    async executeCommand(command: string, args: string[], options: CommandExecutionOptions): Promise<CommandExecutionOutput> {
        const sbx = await Sandbox.create(this.sandboxConnectionOptions);
        const fullCommand = `${command} ${args.join(' ')}`;
        
        try {
            const execution = await sbx.commands.run(fullCommand, {
                cwd: options.workingDirectory,
                timeoutMs: options.timeoutMs
            });

            return {
                success: execution.exitCode === 0,
                command,
                args,
                cwd: options.workingDirectory || "/",
                exitCode: execution.exitCode,
                timedOut: false, // E2B throws or handles timeout
                stdout: execution.stdout,
                stderr: execution.stderr,
                truncatedStdout: false,
                truncatedStderr: false,
                error: execution.error
            };
        } catch (error: any) {
            return {
                success: false,
                command,
                args,
                cwd: options.workingDirectory || "/",
                exitCode: null,
                timedOut: error.message?.toLowerCase().includes("timeout"),
                stdout: "",
                stderr: "",
                truncatedStdout: false,
                truncatedStderr: false,
                error: error.message
            };
        } finally {
            await sbx.kill();
        }
    }
}
