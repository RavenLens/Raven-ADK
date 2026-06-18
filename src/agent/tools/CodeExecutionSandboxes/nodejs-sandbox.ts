import vm from 'node:vm';
import { CodeExecuteOutput, CodeExecutionSandboxSchema } from "./mutual";

export class NodeExecutionSandbox implements CodeExecutionSandboxSchema {
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
}
