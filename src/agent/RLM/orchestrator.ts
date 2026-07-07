import * as z from 'zod';
import { LLMAnswer } from "../../models/mutual";
import { AgentModel } from "../ReAct.agent";
import { MessagesVariations } from "../state";
import { CodeExecuteOutput, CodeExecutionSandboxSchema } from "../tools/CodeExecutionSandboxes/mutual";
import { RLMEnvironment } from "./context";
import { withTelemetry, RecordTracker, RecordTrackerType, agentRunCounter, recordTokenUsage } from "../../telemetry";

const DEFAULT_MAX_ITERATIONS = 10;

export interface RLMSubModel {
    /** Root Model Specification */
    model: AgentModel;
    /** Optional: Instruction when to use this model given to TOP Level LLM to decide */
    instruction?: string;
}

export interface RLMAgentConfig<CodeSandbox extends CodeExecutionSandboxSchema> {
    model: AgentModel;
    /** Optional list with smaller models will be use to  */
    submodels?: RLMSubModel[];
    maxIterations?: number;
    codeSandbox: CodeSandbox;
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
    execute_code_end: (executionCodeOutput: CodeExecuteOutput) => any;
    orchestrator_model_call: (model: AgentModel, result: string) => any;
    /** Emit once SubRLM iteration finishes successfully */
    finish: (result: string) => any;
}

export interface UsageData {
    orchestrator_llm: LLMAnswer["tokens"];
    submodels: LLMAnswer["tokens"];
}

export class RLMAgent<CodeSandbox extends CodeExecutionSandboxSchema> {
    environment: RLMEnvironment<CodeSandbox>;
    maxIterations: number = 10;
    model: AgentModel;
    submodels?: RLMSubModel[];
    subRLMsDict: SubRLMsDict;
    private EventsListeners: Partial<{ [EventName in keyof RLMAgentEventsBody]: RLMAgentEventsBody[EventName] }> = {};
    usageData: UsageData;
    codeExecutionSandbox: RLMAgentConfig<CodeSandbox>["codeSandbox"];
    
    constructor(longContextString: string, config: RLMAgentConfig<CodeSandbox>) {
        this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
        this.model = config.model;
        this.submodels = config.submodels;
        this.usageData = {
            orchestrator_llm: {
                input: 0,
                output: 0,
                reasoning: 0,
            },
            submodels: {
                input: 0,
                output: 0,
                reasoning: 0,
            }
        };
        this.codeExecutionSandbox = config.codeSandbox;

        this.subRLMsDict = this.constructSubmodelsObj();
        this.environment = new RLMEnvironment(
            longContextString, 
            config.submodels ?? [
                {
                    model: config.model
                }
            ],
            config.codeSandbox,
            this.callSubRLM.bind(this),
            this.emit.bind(this)
        );
    }

    private async callSubRLM(
        userPrompt: string,
        modelIndex: number
    ) {
        return withTelemetry("RLMAgent.callSubRLM", { modelIndex }, async () => {
            const submodelFetch = this.subRLMsDict[modelIndex];
            if (!submodelFetch) {
                throw new Error("Model isn't defined");
            }

            const subModelAnswer = await submodelFetch.model.invoke({
                messages: [
                    {
                        type: "system",
                        content: `You are a Specialized Submodel delegated by a Recursive Language Model (RLM) Orchestrator.
Task: ${submodelFetch.instruction ?? 'General analysis'}
Guidelines:
- Return the direct answer or extraction from the snippet.
- Be concise but complete.
- Do not mention being a submodel or provide metadata unless asked.`
                    },
                    {
                        type: "user",
                        content: userPrompt
                    }
                ]
            });
            const finalAnswer = subModelAnswer.answer.at(-1);

            if (subModelAnswer.tokens) {
                this.addTokens(this.usageData.submodels, subModelAnswer.tokens);
            }

            return finalAnswer?.content ?? "Analyses by LLM didn't output content";
        });
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

    private addTokens(target: LLMAnswer["tokens"], source: LLMAnswer["tokens"]) {
        target.input += source.input ?? 0;
        target.output += source.output ?? 0;
        target.reasoning += source.reasoning ?? 0;
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
    
    getUsage() {
        return this.usageData;
    }
    
    /**
     * Execute the RLM
     * @description 
     * @param taskDescription - user given task to perform 
     * @returns result answer
     */
    async invoke(taskDescription: string) {
        return withTelemetry("RLMAgent.invoke", { taskDescription }, async () => {
            const provider = typeof this.model === 'string' ? this.model : (this.model.config.model || 'unknown');
            const tracker = new RecordTracker(
                { model: this.model, messages: [] } as any, // Initialize with empty messages, will update
                RecordTrackerType.Agent,
                provider
            );

            tracker.registerConfig().setUserQueryActiveSpanAttribute().registerTimeTracker();
            agentRunCounter.add(1);

            try {
                // Build submodels description for the orchestrator
                const submodelsDescription = Object.entries(this.subRLMsDict)
                    .map(([subRLMIndex, subRLMObject]) => {
                        const modelName = typeof subRLMObject.model === 'string' ? subRLMObject.model : (subRLMObject.model).config.model || 'unknown';
                        const instruction = subRLMObject.instruction || 'General analysis';
                        return `- Model ${subRLMIndex}: ${modelName}\n  Use when: ${instruction}`;
                    })
                    .join('\n');

                const RLMSchema = z.object({
                    thought: z.string().describe("Your reasoning about the current state and next steps"),
                    blocks: z.array(z.discriminatedUnion("type", [
                        z.object({
                            type: z.literal("code"),
                            content: z.string().describe("JavaScript code to execute in the sandbox. Access contextData directly.")
                        }),
                        z.object({
                            type: z.literal("llm_query"),
                            instruction: z.string().describe("What you want the sub-model to analyze/extract"),
                            snippet: z.string().describe("The relevant part of contextData to analyze"),
                            modelIndex: z.number().optional().describe("Index of the sub-model to use (0-based)")
                        })
                    ])).describe("A sequence of steps to execute in order."),
                    finalAnswer: z.string().optional().describe("The definitive answer to the user's task. Include relevant details and proof from the context. Only set this when you are 100% sure.")
                });

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

        ## Execution Strategy
        Instead of writing a single large script with async calls, you must provide a sequence of blocks:
        1. **code**: JavaScript code that runs in the sandbox. It can explore \`contextData\` and log findings.
        2. **llm_query**: Instructions for a sub-model to analyze a specific snippet. This is executed by the host, not the sandbox.
        These blocks are executed in sequence. Results from previous blocks (like console output, llms calls) are visible in subsequent iterations.

        ## Available Functions in Sandbox (Code Blocks)
        In your \`code\` blocks, you have access to:
        1. \`contextData\` (String) - The entire dataset to analyze.
        2. \`console.log()\` - Use this to print findings that will be used to plan next steps.

        ## Rules
        - Break down large datasets: Use \`code\` to find line numbers, indexes, or snippets, then use \`llm_query\` to analyze those specific snippets.
        - Be precise: Your \`finalAnswer\` must be derived from the evidence found in \`contextData\`.
        - Complete Answers: When providing the \`finalAnswer\`, include the entity name and the specific value found (e.g., "The status of User Zara is active").
        - Incremental progress: Use iterations to narrow down the search space until you find the exact answer.
        - If you find the answer in a \`code\` block, you can call \`submitFinalAnswer(answer)\` inside the code, or return it in the next iteration's \`finalAnswer\` field.
                `
                    }
                ];
                
                for (let i = 0; i < this.maxIterations; i++) {
                    const iterationNum = i + 1;
                    const potentialFinalAnswer = await withTelemetry(`RLMAgent.iteration`, { iteration: iterationNum }, async () => {
                        this.emit("start_iteration", iterationNum);
                        
                        // 1. Get structured answer from Orchestrator
                        this.model.config.messages = messages;
                        const agentResponse = await this.model.invokeStructuredOutput(RLMSchema);
                        const agentAnswerRaw = agentResponse.answer.at(-1)!;
                        
                        if (agentResponse.tokens) {
                            this.addTokens(this.usageData.orchestrator_llm, agentResponse.tokens);
                        }

                        // Extract structured data from AIMessage (type cast for convenience)
                        const structuredResult = (agentAnswerRaw as any).structuredOutput as z.infer<typeof RLMSchema>;
                        
                        if (!structuredResult) {
                            messages.push({
                                type: "ai",
                                content: "System: Failed to parse structured output. Please follow the schema."
                            });
                            return;
                        }

                        this.emit("orchestrator_model_call", this.model, structuredResult.thought);
                        
                        // Check for immediate finish
                        if (structuredResult.finalAnswer) {
                            this.emit("finish", structuredResult.finalAnswer);
                            return structuredResult.finalAnswer;
                        }

                        // 2. Process blocks in sequence
                        let iterationLogs: string[] = [];

                        for (const block of structuredResult.blocks) {
                            if (block.type === "code") {
                                // Execute in the RLM Environment
                                const executionResult = await this.environment.executeAgentCode(block.content);
                                iterationLogs.push(`[Code Output]:\n${executionResult.output || "No output."}`);
                                
                                if (executionResult.finalAnswer) {
                                    this.emit("finish", executionResult.finalAnswer);
                                    return executionResult.finalAnswer;
                                }
                            } else if (block.type === "llm_query") {
                                this.emit("submodel_call", this.model, block.instruction);
                                const llmResult = await this.environment.llmQuery(block.instruction, block.snippet, block.modelIndex ?? 0);
                                iterationLogs.push(`[LLM Query Result for index ${block.modelIndex ?? 0}]:\n${llmResult}`);
                            }
                        }

                        // 3. Check for completion and feedback
                        const feedback = iterationLogs.join("\n\n");

                        this.emit("end_iteration", iterationNum, {
                            isFinish: false,
                            isError: false,
                            result: feedback
                        });

                        // 4. Update message history properly
                        // Add the AI's actual structured response first
                        messages.push(agentAnswerRaw);
                        
                        // Then add the execution results as a user feedback message
                        messages.push({
                            type: "user",
                            content: `Execution Results for Iteration ${iterationNum}:\n${feedback || "No output produced by blocks."}\n\nPlease analyze these results and decide on the next step.`
                        });
                        
                        return undefined;
                    });

                    if (potentialFinalAnswer) {
                        return potentialFinalAnswer;
                    }
                }

                throw new Error("Max iterations reached without finding a final answer.");
            } finally {
                tracker.finishTimeTracker();
                // Record final usage metrics
                recordTokenUsage(`orchestrator-${provider}`, provider, this.usageData.orchestrator_llm);
                recordTokenUsage("rlm-submodels", "subagent", this.usageData.submodels);
            }
        });
    }
}
