import { Anthropic, OpenAI } from "../../models";
import { AgentModel } from "../ReAct.agent";
import { MessagesVariations } from "../state";
import { ExecuteAgentCodeOutput, RLMEnvironment } from "./context";

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
}

export type SubRLMsDict = Record<number, RLMSubModel>;
export interface RLMAgentEventsBody {
    submodel_call: (model: AgentModel, taskPrompt: string) => any;
    start_iteration: (iterationNumber: number) => any;
    end_iteration: (iterationNumber: number, result: {
        /** Once all iterations were finished */
        isFinish?: boolean;
        /** Occurs once the error was produce because it went out of iteration defaults */
        isError?: boolean;
        /** Result of llm call */
        result: string;
    }) => any;
    execute_code_start: (code: string) => any;
    execute_code_end: (executionCodeOutput: ExecuteAgentCodeOutput) => any;
    orchestrator_model_call: (model: AgentModel, result: string) => any;
    /** Emit once SubRLM iteration finishes successfully */
    finish: (result: string) => any;
}

export class RLMAgent {
    environment: RLMEnvironment;
    maxIterations: number = 10;
    model: AgentModel;
    submodels?: RLMSubModel[];
    subRLMsDict: SubRLMsDict;
    private EventsListeners: Partial<{ [EventName in keyof RLMAgentEventsBody]: RLMAgentEventsBody[EventName] }> = {};
    
    constructor(longContextString: string, config: RLMAgentConfig) {
        this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        this.model = config.model;
        this.submodels = config.submodels;

        this.subRLMsDict = this.constructSubmodelsObj();
        this.environment = new RLMEnvironment(
            longContextString, config.submodels ?? [
                {
                    model: config.model
                }
            ], 
            this.callSubRLM.bind(this),
            this.emit.bind(this)
        );
    }

    private async callSubRLM(
        userPrompt: string,
        modelIndex: number
    ) {
        const submodelFetch = this.subRLMsDict[modelIndex];
        if (!submodelFetch) {
            throw new Error("Model isn't defined");
        }

        const subModelAnswer = await submodelFetch.model.invoke({
            messages: [
                {
                    type: "system",
                    content: `
You are a Specialized Submodel delegated by a Recursive Language Model (RLM) Orchestrator.
The Orchestrator has specified instructuib for this submodel defined as: ${submodelFetch.instruction ?? 'General analysis'}

The orchestrator has asked you to analyze the prompt below:
${userPrompt}
                    `
                }
            ]
        });
        const finalAnswer = subModelAnswer.answer.at(-1);

        return finalAnswer?.content ?? "Analyses by LLM didn't output content";
    }
    
    private constructSubmodelsObj() {
        const models: SubRLMsDict = {};
        
        if (this.submodels?.length) {
            let iterationIndex = 0;
            for (const submodel of this.submodels) {
                models[iterationIndex] = submodel;
                iterationIndex += 1;
            }
        }
        else {
            models[0] = {
                model: this.model,
                instruction: "The model you've to use to delegate subtasks"
            };
        }

        return models;
    }

    private emit<Event extends keyof RLMAgentEventsBody>(
        event: Event,
        ...eventArgs: Parameters<RLMAgentEventsBody[Event]>
    ) {
        const eventListener = this.EventsListeners[event];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as (...args: Parameters<RLMAgentEventsBody[Event]>) => any;

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(event)}" failed during execution.`, error);
        });
    }
    
    onEvent<Event extends keyof RLMAgentEventsBody>(
        event: Event,
        listener: RLMAgentEventsBody[Event]
    ) {
        if (this.EventsListeners[event]) {
            console.warn(`Event listener for "${String(event)}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[event] = listener as RLMAgentEventsBody[Event];
        return this;
    }
    
    async invoke(taskDescription: string) {
        // Build submodels description for the orchestrator
        const submodelsDescription = Object.entries(this.subRLMsDict)
            .map(([subRLMIndex, subRLMObject]) => {
                const modelName = typeof subRLMObject.model === 'string' ? subRLMObject.model : (subRLMObject.model).config.model || 'unknown';
                const instruction = subRLMObject.instruction || 'General analysis';
                return `- Model ${subRLMIndex}: ${modelName}\n  Use when: ${instruction}`;
            })
            .join('\n');

        let messages: MessagesVariations[] = [
            {
                type: "system",
                content: `
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
        `
            }
        ]
        
        for (let i = 0; i < this.maxIterations; i++) {
            this.emit("start_iteration", i + 1);
            
            // 1. Get code from Orchestrator
            // Use your best reasoning model here (e.g., GPT-4o, Claude-3.5-Sonnet)
            const agentResponse = await this.model.invoke(
                {
                    messages
                }
            );
            const agentAnswer = agentResponse.answer.at(-1)!.content ?? "";
            this.emit("orchestrator_model_call", this.model, agentAnswer);
            
            // 2. Extract the JS code block
            const codeMatch = agentAnswer.match(/```javascript\n([\s\S]*?)```/);
            if (!codeMatch) {
                messages.push({
                    type: "ai",
                    content: "System: No javascript block found. Please write code."
                });
                this.emit("end_iteration", i + 1, {
                    isFinish: false,
                    isError: false,
                    result: agentAnswer
                });
                continue;
            }
            
            const agentCode = codeMatch[1];

            // 3. Execute in the RLM Environment
            const executionResult = await this.environment.executeAgentCode(agentCode);

            // 4. Check for completion
            const iterationResult = {
                isFinish: Boolean(executionResult.finalAnswer),
                isError: executionResult.finalAnswer === null,
                result: executionResult.output || agentAnswer
            };

            this.emit("end_iteration", i + 1, iterationResult);

            if (executionResult.finalAnswer) {
                this.emit("finish", executionResult.finalAnswer);
                return executionResult.finalAnswer;
            }

            // 5. Append results to history so the Orchestrator can plan the next step
            const feedback = `\nExecution Console Output:\n${executionResult.output || "No output."}`;
            console.log(feedback);
            messages.push({
                type: "ai",
                content: `\nAgent Code:\n\`\`\`javascript\n${agentCode}\n\`\`\`\n${feedback}\nSystem: What is your next step?`
            });
        }

        throw new Error("Max iterations reached without finding a final answer.");
    }
}

const rlm = new RLMAgent("Load here document", {
    model: new OpenAI({
        model: "gpt-5-mini",
        apiKey: "key"
    }),
    submodels: [
        {
            model: new Anthropic({
                model: "",
                apiKey: ""
            }),
            instruction: "Call this to process basic code"
        }
    ]
})

rlm.invoke("Find for me ")
