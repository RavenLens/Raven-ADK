import { AgentModel } from "../ReAct.agent";
import { RLMEnvironment } from "./context";

const DEFAULT_MAX_ITERATIONS = 10;

export interface RLMSubModel {
    /** Root Model Specification */
    model: AgentModel;
    /** Optional: Instruction when to use this model given to TOP Level LLM to decide */
    instruction?: string;
}

export interface RLMAgentConfig {
    model: AgentModel;
    /** Optional list with smaller models will be use to  */
    submodels?: RLMSubModel[];
    maxIterations?: number;
    /** Function to call LLM with a prompt */
    callLLM?: (systemPrompt: string, userPrompt: string, options?: any) => Promise<string>;
}

export class RLMAgent {
    environment: RLMEnvironment;
    maxIterations: number = 10;
    model: AgentModel;
    callLLM?: (systemPrompt: string, userPrompt: string, options?: any) => Promise<string>;
    
    constructor(longContextString: string, config: RLMAgentConfig) {
        this.environment = new RLMEnvironment(longContextString, config.submodels ?? [
            {
                model: config.model
            }
        ], config.callLLM);
        this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        this.model = config.model;
        this.callLLM = config.callLLM;
    }

    async run(taskDescription: string) {
        // Build submodels description for the orchestrator
        const submodelsDescription = this.environment.submodels
            .map((sm, idx) => {
                const modelName = typeof sm.model === 'string' ? sm.model : (sm.model as any).model || 'unknown';
                const instruction = sm.instruction || 'General analysis';
                return `- Model ${idx}: ${modelName}\n  Use when: ${instruction}`;
            })
            .join('\n');

        let conversationHistory = `
You are a Recursive Language Model (RLM) Orchestrator. 
Your task is: "${taskDescription}"

The massive dataset you need to answer this is NOT in your prompt. 
Instead, it is loaded into a secure JavaScript VM in the variable \`contextData\`.
(Note: contextData.length is ${this.environment.hugeContextData.length} characters).

## Available Sub-Models for Delegation (CodeAct Pattern)
You can delegate analysis tasks to these specialized sub-models:
${submodelsDescription}

When you need analysis, call \`await llmQuery(instruction, snippet, modelIndex)\` where:
- \`instruction\`: What you want the model to do
- \`snippet\`: The context snippet to analyze
- \`modelIndex\`: (optional) Index of the sub-model (0-based), defaults to model 0

## Available Functions in Sandbox

You must write JavaScript code to explore \`contextData\`. 
You have access to:
1. \`contextData\` (String) - The entire dataset to analyze
2. \`await llmQuery(instruction, snippet, modelIndex)\` - Recursively delegate analysis to a sub-LLM (CodeAct pattern). Returns the analysis result as a string.
3. \`console.log()\` - Print intermediate findings to the console for debugging.
4. \`submitFinalAnswer(answer)\` - Call this when you have definitively solved the task.

## Code Generation Rules
- Write your JavaScript code inside \`\`\`javascript ... \`\`\` blocks.
- Use top-level await for all async operations.
- Break down large datasets by calling llmQuery() on snippets.
- Log your progress with console.log() for transparency.
- Submit the final answer only when confident.
        `;

        for (let i = 0; i < this.maxIterations; i++) {
            console.log(`\n--- RLM Iteration ${i + 1} ---`);
            
            // 1. Get code from Orchestrator
            // Use your best reasoning model here (e.g., GPT-4o, Claude-3.5-Sonnet)
            if (!this.callLLM) {
                throw new Error("callLLM function not provided in RLMAgentConfig");
            }
            const agentResponse = await this.callLLM(
                "You are a coding agent orchestrator.",
                conversationHistory,
                { model: this.model }
            );
            
            // 2. Extract the JS code block
            const codeMatch = agentResponse.match(/```javascript\n([\s\S]*?)```/);
            if (!codeMatch) {
                conversationHistory += `\nSystem: No javascript block found. Please write code.`;
                continue;
            }
            
            const agentCode = codeMatch[1];
            console.log("Agent is executing code:\n", agentCode);

            // 3. Execute in the RLM Environment
            const executionResult = await this.environment.executeAgentCode(agentCode);

            // 4. Check for completion
            if (executionResult.finalAnswer) {
                console.log("\n✅ Task Complete!");
                return executionResult.finalAnswer;
            }

            // 5. Append results to history so the Orchestrator can plan the next step
            const feedback = `\nExecution Console Output:\n${executionResult.output || "No output."}`;
            console.log(feedback);
            conversationHistory += `\nAgent Code:\n\`\`\`javascript\n${agentCode}\n\`\`\`\n${feedback}\nSystem: What is your next step?`;
        }

        throw new Error("Max iterations reached without finding a final answer.");
    }
}