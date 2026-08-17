import { DeterministicMemorySchema, ToolBasedMemorySchema } from "../../memory";
import { ReActAgent, ReActAgentPluginSpec } from "../../ReAct.agent";
import { AIMessage, MessagesVariations } from "../../state";
import { Tool } from "../../tools";
import { AgenticEvaluator } from "../..";
import z from "zod/v4";
import { AgentsDebateEvents, AgentsDebateLoopEvent } from "./events";
import { AgentCommunicationStageRecord, HandoffExecution, InvokeConsultationOptions, InvokeConsultationResult, InvokeCritiqueOptions, InvokeCritiqueResult, InvokeHandoffOptions, InvokeHandoffResult } from "./config";

/** Input supplied to a debate participant for one execution. */
export interface ExecutableAgentDebateOptions {
    /** Message history available to the participant. */
    messages: MessagesVariations[];
    /** Abort signal that finishes the execution. */
    abort?: AbortSignal;
}

/** Structured execution surface required from every debate participant. */
export interface StructuredAgentDebate<Result = unknown> {
    invokeStructuredOutput(
        schema: z.ZodType<Result>,
        options?: ExecutableAgentDebateOptions
    ): PromiseLike<Result> | Result;
}

/** Supported implementations for a debate participant. */
export type AgentDebateLogic<Result = unknown> =
    | ReActAgent<any, any, any, any>
    | StructuredAgentDebate<Result>;

/** Counts model tokens for text sent to or returned by a debate agent. Use tokenizer dedicated for llm drives the agent */
export type DebateTokenizer = (content: string) => number | Promise<number>;

/** Control metadata returned by a debate participant. */
export interface DebateAgentResponse {
    /** Whether the agent wants to enter or remain in the conversation. */
    participate: boolean;
    /** Whether another conversation round should be requested after this response. */
    continueConversation: boolean;
    /** Participant output, commonly a message list or an AI message. */
    messages: MessagesVariations[];
}

const debateAgentResponseSchema = z.object({
    participate: z.boolean(),
    continueConversation: z.boolean(),
    messages: z.array(z.any())
});

/** 
 * Specify the agent paramaters and logic
 * This agent is going to participate in the communication among the agents
 */
export interface AgentDebateType<Result = unknown> {
    /** Name of the agent
     * - Agent name is its unique identifier simulatenously
    */
    name: string;
    /** Description and instructions of the agent */
    description: string;
    /** Internal instruction for the agent - have to the same as these passed to the agent */
    internalInstructions?: string;
    tools?: Tool<any, any>[];
    /** Logic of the agent */
    // TODO: Add CodeAct and SupervisedCodeAct type after these concepts arrival
    agentLogic: AgentDebateLogic<DebateAgentResponse>;
    /** Tokenizer belonging to the model used by this agent. */
    tokenizer: DebateTokenizer;
    /** 
     * Boundary specified for this agent - it cannot be larger than mutualBoundaries
     * Specified for single conversation step
    */
    debateBoundary: BoundaryObject;
}

export interface AgentsDebateConfig<
    Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
    Result = unknown
> {
    /**
     * Agents list will participate in the debate
     * * Download remote agents from remote respotiories/resources to execute the remote agents
     */
    agents: AgentDebateType<Result>[];
    /** 
     * List with plugins will be applied to each agent participates in the debate
     * Subagent from where the logic is executed is mention in the `execute` method from agent parameters
    */
    // plugins?: ReActAgentPluginSpec[];

    /** List with messages base on that `AgentsDebate` methods are going to be invoked */
    messages: MessagesVariations[];

    /** Sginal to finish the logic */
    abort?: AbortSignal;

    /** 
     * Specify memory for debate that will be shared among all agents and use to save the progress and informations from agents debate
     * Because the current memory systems are prepared for the agents - the debate is saved as a agentic session but in essence this is the agentic debate
    */
    memory?: Memory;

    /** 
     * Specify the expanse boundaries agents cannot cross in debate
     * - Cannonical - no of other agents can breake the overall budget specified by this field and params
    */
    debateMutualBoundaries?: BoundaryObject;
}

export interface BoundaryObject {
    tokens?: number;
    timeMs?: number;
    /** 
     * Maximum number of conversation rounds. 
     * @default 1
    */
    maxRounds?: number;
}

export class AgentsDebate<
    Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
    Result = unknown
> {
    config: AgentsDebateConfig<Memory, Result>;
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};

    constructor(config: AgentsDebateConfig<Memory, Result>) {
        this.config = config;
    }

    onEvent<EventName extends keyof AgentsDebateEvents>(
        eventName: EventName,
        eventListener: AgentsDebateEvents[EventName]
    ): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    emitEvent<EventName extends keyof AgentsDebateEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<AgentsDebateEvents[EventName]>
    ): void {
        const eventListener = this.EventsListeners[eventName];
        if (!eventListener) return;

        void Promise.resolve(eventListener(...eventArgs)).catch(error => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    /**
     * Invokes a debate participant through its structured-output interface and validates the response.
     * 
     * @param agentLogic Participant implementation to invoke.
     * @param schema Zod schema used to validate the structured response.
     * @param options Messages and abort signal supplied to the participant.
     * @returns The validated structured response returned by the participant.
     */
    async invokeDebateAgent<Result = unknown>(
        agentLogic: AgentDebateLogic<Result>,
        schema: z.ZodType<Result>,
        options: ExecutableAgentDebateOptions
    ): Promise<Result> {
        this.emitEvent("debate_agent_start", agentLogic, schema, options, options.messages, { agentLogic, schema });
        try {
            const result = await this.invokeDebateAgentInternal(agentLogic, schema, options);
            this.emitEvent("debate_agent_end", result);
            return result;
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this.emitEvent("debate_agent_error", normalizedError);
            throw error;
        }
    }

    private async invokeDebateAgentInternal<Result = unknown>(
        agentLogic: AgentDebateLogic<Result>,
        schema: z.ZodType<Result>,
        options: ExecutableAgentDebateOptions
    ): Promise<Result> {
        if (agentLogic instanceof ReActAgent) {
            const previousMessages = agentLogic.agentConfig.messages;
            agentLogic.agentConfig.messages = options.messages;
            
            try {
                const execution = await agentLogic.invokeStructuredOutput(schema);
                const message = execution.messages.at(-1);
                
                if (message?.type !== "ai") {
                    throw new Error("Structured debate agent did not return an AI message.");
                }
                
                return schema.parse(message.structuredOutput ?? JSON.parse(message.content ?? ""));
            } finally {
                agentLogic.agentConfig.messages = previousMessages;
            }
        }

        const execution = await agentLogic.invokeStructuredOutput(schema, options);
        return schema.parse(execution);
    }

    /**
     * Selects configured debate agents whose names appear in the requested list.
     * 
     * @param agentNames Names of the agents to select.
     * @returns The configured agents matching the requested names.
     */
    private getAgentsWithNames(agentNames: AgentDebateType["name"][]) {
        return this.config.agents.filter(agent => agentNames.includes(agent.name));
    }

    /**
     * Estimates the token usage of a message collection with the participant's tokenizer.
     * 
     * @param messages Messages whose textual and structured content should be counted.
     * @param tokenizer Tokenizer used by the participant's model.
     * @returns The total estimated token count for the supplied messages.
     */
    private async estimateTokens(messages: MessagesVariations[], tokenizer: DebateTokenizer): Promise<number> {
        let tokens = 0;
        for (const message of messages) {
            const content = "content" in message ? message.content ?? "" : "";
            const structured = message.type === "ai" && message.structuredOutput !== undefined
                ? JSON.stringify(message.structuredOutput)
                : "";
            if (content) tokens += await tokenizer(content);
            if (structured) tokens += await tokenizer(structured);
        }
        return tokens;
    }

    /**
     * Resolves an agent's effective debate boundaries and validates them against mutual limits.
     * 
     * @param agent Agent whose configured boundaries should be resolved.
     * @returns The effective token, time, and round limits for the agent.
     */
    private getBoundary(agent: AgentDebateType): BoundaryObject {
        const mutual = this.config.debateMutualBoundaries ?? {};
        const agentBoundary = agent.debateBoundary ?? {};
        
        // Error fallbacks
        if (agentBoundary.tokens !== undefined && mutual.tokens !== undefined && agentBoundary.tokens > mutual.tokens) {
            throw new Error(`Agent "${agent.name}" debateBoundary.tokens cannot exceed debateMutualBoundaries.tokens.`);
        }
        
        if (agentBoundary.timeMs !== undefined && mutual.timeMs !== undefined && agentBoundary.timeMs > mutual.timeMs) {
            throw new Error(`Agent "${agent.name}" debateBoundary.timeMs cannot exceed debateMutualBoundaries.timeMs.`);
        }
        
        if (agentBoundary.maxRounds !== undefined && mutual.maxRounds !== undefined && agentBoundary.maxRounds > mutual.maxRounds) {
            throw new Error(`Agent "${agent.name}" debateBoundary.maxRounds cannot exceed debateMutualBoundaries.maxRounds.`);
        }

        // Result
        return {
            tokens: agentBoundary.tokens ?? mutual.tokens,
            timeMs: agentBoundary.timeMs ?? mutual.timeMs,
            maxRounds: agentBoundary.maxRounds ?? mutual.maxRounds ?? 1
        };
    }

    /**
     * Invokes a debate participant while enforcing an optional execution time limit.
     * 
     * @param logic Participant implementation to invoke.
     * @param schema Zod schema used to validate the participant's structured response.
     * @param options Messages and abort signal supplied to the participant.
     * @param timeMs Maximum execution time in milliseconds, when specified.
     * @returns The validated participant response before the time limit expires.
     */
    private async invokeWithTimeLimit<Result>(
        logic: AgentDebateLogic<Result>,
        schema: z.ZodType<Result>,
        options: ExecutableAgentDebateOptions,
        timeMs?: number
    ): Promise<Result> {
        const execution = this.invokeDebateAgentInternal(logic, schema, options);
        
        if (timeMs === undefined) return execution;
        let timeout: ReturnType<typeof setTimeout> | undefined;

        const limit = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Agent debate time boundary exceeded.")), timeMs);
        });

        try {
            return await Promise.race([execution, limit]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }

    /**
     * Spawns debate among agents in order to execute some action
     * Treat debate as group conversation about specific subject
     * 
     * @param agents - list with agents will participate in the debate
     * @param debateSubject - list with task to perform are debate subject 
     * 
     * ### How does it work?
     * 1. As is shown on the excalidrawning
     * 
     * @returns list with messages are the debatbe messages
    */
    private async spawnDebate(
        agentNames: AgentDebateType["name"][],
        debateSubject: string,
        debateInstructions: string,
        records?: AgentCommunicationStageRecord[],
        initialMessages: MessagesVariations[] = this.config.messages
    ): Promise<MessagesVariations[]> {
        const agents = this.getAgentsWithNames(agentNames);
        if (agents.length === 0) throw new Error("Cannot spawn a debate without at least one known agent.");

        // Trigger errors for exceeded boundaries
        agents.forEach(agent => this.getBoundary(agent));

        const startedAt = Date.now();
        const mutual = this.config.debateMutualBoundaries ?? {};
        
        // Define room for conversation message with specified task
        const room: MessagesVariations[] = [...initialMessages, {
            type: "user",
            content: [`# Debate subject\n${debateSubject}`, `# Instructions\n${debateInstructions}`].join("\n\n")
        }];
        
        // Participation of the agent
        const participation = new Map<string, boolean>();
        /// Whether to continue the conversation
        const continuation = new Map<string, boolean>();
        /// Tokens used by each agent
        const agentTokens = new Map<string, number>();
        let mutualTokensUsed = 0;

        // Executes agent in round
        const runRoundInternal = async (round: number) => {
            // 1. Run agents and return results of agent run
            const results = await Promise.all(agents.map(async agent => {
                const boundary = this.getBoundary(agent);
                
                // Error fallbacks
                if (round >= (boundary.maxRounds ?? 1)) return null;
                if ((round > 0 && !participation.get(agent.name)) || this.config.abort?.aborted) return null;
                if (mutual.timeMs !== undefined && Date.now() - startedAt >= mutual.timeMs) return null;
                if (boundary.timeMs !== undefined && Date.now() - startedAt >= boundary.timeMs) return null;
                if (mutual.tokens !== undefined && mutualTokensUsed >= mutual.tokens) return null;
                if (boundary.tokens !== undefined && (agentTokens.get(agent.name) ?? 0) >= boundary.tokens) return null;

                // 
                const prompt: MessagesVariations = {
                    type: "user",
                    content: [
                        `You are ${agent.name}: ${agent.description}`,
                        `The debate participants are: ${agents.map(participant => `${participant.name} (${participant.description})`).join(", ")}`,
                        "Participate as a member of the multi-agent conversation. Read the preceding messages, consider the other agents' contributions, and add a useful response that advances the debate. You may abstain only when you have no relevant contribution.",
                        "When participating, respond to the existing discussion rather than starting an unrelated answer. Set continueConversation=true only when another round is needed to resolve, improve, or verify the discussion; otherwise set it to false.",
                        agent.internalInstructions ? `## Internal instructions\n${agent.internalInstructions}` : "",
                        `This is conversation round ${round}. Return only a structured object with boolean participate, boolean continueConversation, and a messages array. Set participate=false to abstain.`
                    ].filter(Boolean).join("\n\n")
                };
                
                const input = [...room, prompt];
                const inputTokens = await this.estimateTokens(input, agent.tokenizer);
                const consumedTokens = agentTokens.get(agent.name) ?? 0;
                
                if (boundary.tokens !== undefined && consumedTokens + inputTokens >= boundary.tokens) return null;
                
                const response: DebateAgentResponse = await this.invokeWithTimeLimit<DebateAgentResponse>(
                    agent.agentLogic,
                    debateAgentResponseSchema as z.ZodType<DebateAgentResponse>,
                    {
                        messages: input,
                        abort: this.config.abort
                    },
                    boundary.timeMs === undefined ? undefined : Math.max(1, boundary.timeMs - (Date.now() - startedAt))
                );
                const addedTokens = await this.estimateTokens(response.messages, agent.tokenizer);
                
                if (boundary.tokens !== undefined && consumedTokens + inputTokens + addedTokens > boundary.tokens) {
                    throw new Error(`Agent "${agent.name}" debate token boundary exceeded.`);
                }
                
                return { agent, response, addedTokens, consumedTokens: inputTokens + addedTokens };
            }));

            // Calculate tokens used by each messages in this round
            const roundTokens = results.reduce((total, item) => total + (item?.consumedTokens ?? 0), 0);
            if (mutual.tokens !== undefined && mutualTokensUsed + roundTokens > mutual.tokens) {
                throw new Error("Debate mutual token boundary exceeded.");
            }
            mutualTokensUsed += roundTokens;

            // 3. Add results from different agents to the room messages
            for (const item of results) {
                if (!item) continue;
                
                participation.set(item.agent.name, item.response.participate);
                continuation.set(
                    item.agent.name,
                    item.response.participate && item.response.continueConversation
                );
                agentTokens.set(item.agent.name, (agentTokens.get(item.agent.name) ?? 0) + item.consumedTokens);

                if (item.response.participate) {
                    room.push({ type: "user", content: `## ${item.agent.name}` }, ...item.response.messages);
                    records?.push({
                        agentName: item.agent.name,
                        messages: item.response.messages,
                        timestamp: Date.now()
                    });
                }
            }
        };

        const runRound = async (round: number) => {
            const messagesBefore = room.length;
            const loopEvent = (messages: MessagesVariations[]): AgentsDebateLoopEvent => ({
                loop: round,
                loops_count: Math.max(...agents.map(agent => this.getBoundary(agent).maxRounds ?? 1)),
                messages
            });
            this.emitEvent("debate_loop_start", loopEvent(room.slice()));
            try {
                await runRoundInternal(round);
                this.emitEvent("debate_loop_end", loopEvent(room.slice(messagesBefore)));
            } catch (error) {
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                this.emitEvent("debate_loop_error", {
                    ...loopEvent(room.slice(messagesBefore)),
                    reason: normalizedError.message
                });
                throw error;
            }
        };

        // Tokens rounds
        await runRound(0);

        const maxRounds = Math.max(...agents.map(agent => this.getBoundary(agent).maxRounds ?? 1));
        for (let round = 1; round < maxRounds && [...continuation.values()].some(Boolean); round++) {
            await runRound(round);
        }
        
        return room;
    }

    /**
     * Executes a task agent with advice from explicitly selected consultation agents.
     * An initial consultation runs before execution by default. When
     * `betweenExecutionReasoning` is enabled, a second consultation reviews the
    * first execution and the task agent runs again with that feedback. The
    * complete flow is repeated `loopsCount` times, carrying each prior result
    * into the next consultation and execution stage.
     *
    * @param options Execution agent, task messages, consultation agents, enabled stages, and loop count.
     * @returns The final execution message and consultation records grouped by stage.
     * @throws If an execution or consultation agent is unknown, if the execution
     * agent is also selected for consultation, or if automatic selection is requested.
     */
    async invokeConsultation(options: InvokeConsultationOptions): Promise<InvokeConsultationResult | undefined> {
        this.emitEvent(
            "consultation_start",
            options,
            options.taskMessages ?? this.config.messages,
            {
                executionAgent: options.choosenExecutionAgent,
                consultationAgents: options.choosenConsultationAgents ?? [],
                loopsCount: options.loopsCount ?? 1,
                stages: options.invokeForStages ?? {}
            }
        );
        try {
            const result = await this.invokeConsultationInternal(options);
            this.emitEvent("consultation_end", result);
            return result;
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this.emitEvent("consultation_error", normalizedError);
            throw error;
        }
    }

    private async invokeConsultationInternal(options: InvokeConsultationOptions): Promise<InvokeConsultationResult | undefined> {
        // Resolve and validate the execution agent selected for the consultation workflow.
        const executionAgent = this.config.agents.find(agent => agent.name === options.choosenExecutionAgent);
        if (!executionAgent) {
            throw new Error(`Cannot invoke consultation with unknown execution agent "${options.choosenExecutionAgent}".`);
        }

        // Resolve the explicitly selected consultation agents and reject unsupported automatic selection.
        const consultationAgentNames = options.choosenConsultationAgents;
        if (!consultationAgentNames?.length) {
            throw new Error("Automatic consultation-agent selection is not available until chooseBestAgents is implemented.");
        }

        const consultationAgents = this.getAgentsWithNames(consultationAgentNames);
        if (consultationAgents.length !== consultationAgentNames.length) {
            const knownNames = new Set(consultationAgents.map(agent => agent.name));
            const unknownNames = consultationAgentNames.filter(name => !knownNames.has(name));
            throw new Error(`Cannot invoke consultation with unknown consultation agent(s): ${unknownNames.join(", ")}.`);
        }
        if (consultationAgents.some(agent => agent.name === executionAgent.name)) {
            throw new Error("The execution agent cannot also be a consultation agent.");
        }

        // Validate the task context, enabled stages, and requested consultation loop count.
        const taskMessages = options.taskMessages ?? this.config.messages;
        const stages = options.invokeForStages ?? {};
        const loopsCount = options.loopsCount ?? 1;
        if (!Number.isInteger(loopsCount) || loopsCount < 1) {
            throw new Error("Consultation loopsCount must be a positive integer.");
        }

        // Initialize the consultation records and shared execution history carried across all loops.
        const beginningRecords: AgentCommunicationStageRecord[] = [];
        const betweenRecords: AgentCommunicationStageRecord[] = [];
        let executionMessages = [...taskMessages];

        // Append consultation messages to the execution history for subsequent agent stages.
        const appendConsultation = (records: AgentCommunicationStageRecord[]) => {
            for (const record of records) {
                executionMessages.push(
                    { type: "user", content: `## Consultation from ${record.agentName}` },
                    ...record.messages
                );
            }
        };

        // Execute the task agent for one loop stage and extract its latest AI message.
        const executionSchema = debateAgentResponseSchema as z.ZodType<DebateAgentResponse>;
        const invokeExecutionAgent = async (loop: number, stage: "initial" | "refinement"): Promise<AIMessage> => {
            const response = await this.invokeWithTimeLimit(
                executionAgent.agentLogic,
                executionSchema,
                {
                    messages: [...executionMessages, {
                        type: "user",
                        content: [
                            `Execute loop ${loop + 1} (${stage} stage) using the consultation and prior results above.`,
                            "Return your answer in the messages field with participate=true and continueConversation=false."
                        ].join("\n")
                    }],
                    abort: this.config.abort
                },
                this.getBoundary(executionAgent).timeMs
            );
            
            const finalMessage = [...response.messages].reverse().find(message => message.type === "ai");
            if (!finalMessage || finalMessage.type !== "ai") {
                throw new Error(`Execution agent "${executionAgent.name}" did not return an AI message.`);
            }
            
            executionMessages.push(...response.messages);
            
            return finalMessage;
        };

        // Repeat consultation and execution stages while carrying prior results into each loop.
        let result: AIMessage | undefined;
        for (let loop = 0; loop < loopsCount; loop++) {
            const messagesBefore = executionMessages.length;
            const loopEvent = (loopMessages: MessagesVariations[]): AgentsDebateLoopEvent => ({
                loop,
                loops_count: loopsCount,
                messages: loopMessages
            });
            this.emitEvent("consultation_loop_start", loopEvent(executionMessages.slice()));
            try {
                // Gather advice before the execution agent runs for the current loop.
                if (stages.begining !== false) {
                    const loopBeginningRecords: AgentCommunicationStageRecord[] = [];
                    await this.spawnDebate(
                        consultationAgents.map(agent => agent.name),
                        `Provide consultation for execution loop ${loop + 1}.`,
                        "Review the task and all prior execution results, then give concrete advice to the execution agent.",
                        loopBeginningRecords,
                        executionMessages
                    );
                    beginningRecords.push(...loopBeginningRecords);
                    appendConsultation(loopBeginningRecords);
                }

                // Execute the task agent using the consultation history accumulated so far.
                result = await invokeExecutionAgent(loop, "initial");

                // Gather feedback after the initial execution and optionally run a refinement stage.
                if (stages.betweenExecutionReasoning) {
                    const loopBetweenRecords: AgentCommunicationStageRecord[] = [];
                    await this.spawnDebate(
                        consultationAgents.map(agent => agent.name),
                        `Review the execution result from loop ${loop + 1}.`,
                        "Critique the current result and provide specific improvements for the next execution stage.",
                        loopBetweenRecords,
                        executionMessages
                    );
                    betweenRecords.push(...loopBetweenRecords);
                    appendConsultation(loopBetweenRecords);
                    result = await invokeExecutionAgent(loop, "refinement");
                }
                this.emitEvent("consultation_loop_end", loopEvent(executionMessages.slice(messagesBefore)));
            } catch (error) {
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                this.emitEvent("consultation_loop_error", {
                    ...loopEvent(executionMessages.slice(messagesBefore)),
                    reason: normalizedError.message
                });
                throw error;
            }
        }

        return {
            consultation: {
                begining: beginningRecords,
                betweenExecutionReasoning: betweenRecords
            },
            choosenAgentResult: executionMessages,
            result: result as AIMessage
        };
    }

    /**
     * Invoke critique where other agents criticue the outcomes of the choosen agents and imoroves them in the loop
     * * Uses debate to choose the best agents can participate in the critique to perform the task
     * 
     * 
     * ### How does it work?
     * 1. Generate the actions result by a `executionAgent` 
     * 2. Use the agents debate or preselected critique agents `choosenCriticqueAgents` to choose the agents set competetive to perform the crticique of the goal
     * 3. Use the selected agents set in debate
    */
    async invokeCritique(options: InvokeCritiqueOptions): Promise<InvokeCritiqueResult | undefined> {
        this.emitEvent(
            "critique_start",
            options,
            this.config.messages,
            {
                executionAgent: options.choosenExecutionAgent,
                critiqueAgents: options.choosenCriticqueAgents ?? [],
                loopsCount: options.loopsCount ?? 1
            }
        );
        try {
            const result = await this.invokeCritiqueInternal(options);
            this.emitEvent("critique_end", result);
            return result;
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this.emitEvent("critique_error", normalizedError);
            throw error;
        }
    }

    private async invokeCritiqueInternal(options: InvokeCritiqueOptions): Promise<InvokeCritiqueResult | undefined> {
        // Resolve and validate the execution agent selected for the critique workflow.
        const executionAgent = this.config.agents.find(agent => agent.name === options.choosenExecutionAgent);
        if (!executionAgent) {
            throw new Error(`Cannot invoke critique with unknown execution agent "${options.choosenExecutionAgent}".`);
        }

        // Resolve the explicitly selected critique agents and reject unsupported automatic selection.
        const criticNames = options.choosenCriticqueAgents;
        if (!criticNames?.length) {
            throw new Error("Automatic critique-agent selection is not available until chooseBestAgents is implemented.");
        }

        const criticAgents = this.getAgentsWithNames(criticNames);
        if (criticAgents.length !== criticNames.length) {
            const knownNames = new Set(criticAgents.map(agent => agent.name));
            const unknownNames = criticNames.filter(name => !knownNames.has(name));
            throw new Error(`Cannot invoke critique with unknown critique agent(s): ${unknownNames.join(", ")}.`);
        }
        if (criticAgents.some(agent => agent.name === executionAgent.name)) {
            throw new Error("The execution agent cannot also be a critique agent.");
        }

        // Validate the number of critique and revision cycles requested by the caller.
        const loopsCount = options.loopsCount ?? 1;
        if (!Number.isInteger(loopsCount) || loopsCount < 1) {
            throw new Error("Critique loopsCount must be a positive integer.");
        }

        // Prepare the shared execution history and the structured response schema used by every agent.
        const executionSchema = debateAgentResponseSchema as z.ZodType<DebateAgentResponse>;
        const executionMessages = [...this.config.messages];
        const agentsCritique: InvokeCritiqueResult["agentsCritique"] = [];

        // Execute the task agent and extract its latest AI message for the current workflow stage.
        const invokeExecution = async (stage: "initial" | "revision"): Promise<AIMessage> => {
            const response = await this.invokeWithTimeLimit(
                executionAgent.agentLogic,
                executionSchema,
                {
                    messages: [...executionMessages, {
                        type: "user",
                        content: stage === "initial"
                            ? "Execute the task and return the candidate answer in the messages field."
                            : "Revise the candidate answer using all critique messages above and return the improved answer in the messages field."
                    }],
                    abort: this.config.abort
                },
                this.getBoundary(executionAgent).timeMs
            );
            const finalMessage = [...response.messages].reverse().find(message => message.type === "ai");
            if (!finalMessage || finalMessage.type !== "ai") {
                throw new Error(`Execution agent "${executionAgent.name}" did not return an AI message.`);
            }
            executionMessages.push(...response.messages);
            return finalMessage;
        };

        // Produce the initial candidate answer before requesting external critiques.
        let result = await invokeExecution("initial");
        for (let loop = 0; loop < loopsCount; loop++) {
            const messagesBefore = executionMessages.length;
            const loopEvent = (loopMessages: MessagesVariations[]): AgentsDebateLoopEvent => ({
                loop,
                loops_count: loopsCount,
                messages: loopMessages
            });
            this.emitEvent("critique_loop_start", loopEvent(executionMessages.slice()));
            try {
                // Ask every critique agent to review the current candidate in parallel.
                const loopCritiques = await Promise.all(criticAgents.map(async critic => {
                    const prompt: MessagesVariations = {
                        type: "user",
                        content: [
                            `You are ${critic.name}: ${critic.description}`,
                            "Critique the candidate answer in the preceding messages. Identify concrete problems and specific improvements.",
                            options.criticueAgentsSelectionInstruction
                                ? `## Critique focus\n${options.criticueAgentsSelectionInstruction}`
                                : "",
                            `This is critique loop ${loop + 1} of ${loopsCount}. Return your critique in the messages field.`
                        ].filter(Boolean).join("\n\n")
                    };
                    const response = await this.invokeWithTimeLimit(
                        critic.agentLogic,
                        executionSchema,
                        {
                            messages: [...executionMessages, prompt],
                            abort: this.config.abort
                        },
                        this.getBoundary(critic).timeMs
                    );
                    return {
                        agentName: critic.name,
                        critique: response.messages
                    };
                }));

                // Store the critiques and append them to the execution history for the revision step.
                agentsCritique.push(...loopCritiques);
                for (const critique of loopCritiques) {
                    executionMessages.push(
                        { type: "user", content: `## Critique from ${critique.agentName} (loop ${loop + 1})` },
                        ...critique.critique
                    );
                }

                // Revise the candidate answer using the critiques collected in this loop.
                result = await invokeExecution("revision");
                this.emitEvent("critique_loop_end", loopEvent(executionMessages.slice(messagesBefore)));
            } catch (error) {
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                this.emitEvent("critique_loop_error", {
                    ...loopEvent(executionMessages.slice(messagesBefore)),
                    reason: normalizedError.message
                });
                throw error;
            }
        }

        return { agentsCritique, result, executionMessages };
    }

    /**
     * Invoke the task by delegate the task to the `N` the best agents choosen for task and collect correlated result by the `choosenConslusionAgent`
     * 
     * ### How does it work?
     * 1. Invokes debate in the `agents` to perform the debate what agent(s) where `N` = `handoffToAgentsCount` has to be executed to choose the best agents where tasks can be delegated to
     * 2. Invokes these agents
     * 3. Uses conclusion agent `choosenConclusionAgent` the conclusion of each handoff 
     */
    async invokeHandoff(options: InvokeHandoffOptions): Promise<InvokeHandoffResult<Result> | undefined> {
        this.emitEvent(
            "handoff_start",
            options,
            this.config.messages,
            {
                conclusionAgent: options.choosenConclusionAgent,
                candidates: this.config.agents
                    .filter(agent => agent.name !== options.choosenConclusionAgent)
                    .map(agent => agent.name),
                handoffToAgentsCount: options.handoffToAgentsCount ?? 1,
                executeHandoffParallel: options.executeHandoffParallel
            }
        );
        try {
            const result = await this.invokeHandoffInternal(options);
            this.emitEvent("handoff_end", result);
            return result;
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this.emitEvent("handoff_error", normalizedError);
            throw error;
        }
    }

    private async invokeHandoffInternal(options: InvokeHandoffOptions): Promise<InvokeHandoffResult<Result> | undefined> {
        // Resolve and validate the agent responsible for producing the final conclusion.
        const conclusionAgent = this.config.agents.find(agent => agent.name === options.choosenConclusionAgent);
        if (!conclusionAgent) {
            throw new Error(`Cannot invoke handoff with unknown conclusion agent "${options.choosenConclusionAgent}".`);
        }

        const candidates = this.config.agents.filter(agent => agent.name !== conclusionAgent.name);
        if (candidates.length === 0) {
            throw new Error("Cannot invoke handoff without at least one handoff agent.");
        }

        // Validate the requested number of agents that may receive the handoff.
        const requestedCount = options.handoffToAgentsCount ?? 1;
        if (!Number.isInteger(requestedCount) || requestedCount < 1) {
            throw new Error("handoffToAgentsCount must be a positive integer.");
        }

        // Define schemas for candidate scoring and structured handoff execution responses.
        const executionSchema = debateAgentResponseSchema as z.ZodType<DebateAgentResponse>;
        const selectionSchema = z.object({
            score: z.number().finite(),
            reason: z.string()
        });

        // Ask every eligible candidate to score its suitability for independently completing the task.
        const selections = await Promise.all(candidates.map(async agent => {
            const response = await this.invokeWithTimeLimit<{ score: number; reason: string }>(
                agent.agentLogic as AgentDebateLogic<{ score: number; reason: string }>,
                selectionSchema as z.ZodType<{ score: number; reason: string }>,
                {
                    messages: [...this.config.messages, {
                        type: "user",
                        content: [
                            `You are assessing your suitability for the task as ${agent.name}: ${agent.description}`,
                            options.handoffInstructions ? `## Handoff instructions\n${options.handoffInstructions}` : "",
                            "Return a score from 0 to 100 and a concise reason. Assess your ability to produce the best independent solution.",
                            "Return only the structured object with numeric score and string reason."
                        ].filter(Boolean).join("\n\n")
                    }],
                    abort: this.config.abort
                },
                this.getBoundary(agent).timeMs
            );
            return { agent, score: response.score, reason: response.reason };
        }));

        // Rank candidates by score and retain only the requested number of handoff agents.
        const selectedAgents = selections
            .sort((left, right) => right.score - left.score)
            .slice(0, Math.min(requestedCount, candidates.length))
            .map(({ agent, reason }) => ({ ...agent, reason }));

        // Resolve and validate the maximum number of selected agents that may run concurrently.
        const parallelLimit = options.executeHandoffParallel === true
            ? selectedAgents.length
            : options.executeHandoffParallel === false || options.executeHandoffParallel === undefined
                ? selectedAgents.length
                : options.executeHandoffParallel;
        if (!Number.isInteger(parallelLimit) || parallelLimit < 1) {
            throw new Error("executeHandoffParallel must be true, false, or a positive integer.");
        }

        // Execute selected agents in bounded batches and record each successful, failed, or aborted handoff.
        const handoffExecutions: HandoffExecution<Result>[] = [];
        const handoffLoopsCount = Math.ceil(selectedAgents.length / parallelLimit);
        for (let offset = 0; offset < selectedAgents.length; offset += parallelLimit) {
            const batch = Math.floor(offset / parallelLimit);
            const batchAgents = selectedAgents.slice(offset, offset + parallelLimit);
            const loopEvent = (loopMessages: MessagesVariations[]): AgentsDebateLoopEvent => ({
                loop: batch,
                loops_count: handoffLoopsCount,
                messages: loopMessages
            });
            this.emitEvent("handoff_loop_start", loopEvent(this.config.messages.slice()));
            try {
                const batchResults = await Promise.all(batchAgents.map(async agent => {
                    const execution: HandoffExecution<Result> = { agent: agent.name, batch, status: "completed" };
                    if (this.config.abort?.aborted) {
                        execution.status = "aborted";
                        return execution;
                    }

                    try {
                        const response = await this.invokeWithTimeLimit(
                            agent.agentLogic,
                            executionSchema,
                            {
                                messages: [...this.config.messages, {
                                    type: "user",
                                    content: [
                                        `Execute the task as the handoff agent ${agent.name}.`,
                                        `Your selection reason was: ${agent.reason}`,
                                        options.handoffInstructions ? `## Handoff instructions\n${options.handoffInstructions}` : "",
                                        "Return your answer in the messages field with participate=true and continueConversation=false."
                                    ].filter(Boolean).join("\n\n")
                                }],
                                abort: this.config.abort
                            },
                            this.getBoundary(agent).timeMs
                        );
                        const result = [...response.messages].reverse().find(message => message.type === "ai");
                        if (!result || result.type !== "ai") {
                            throw new Error(`Handoff agent "${agent.name}" did not return an AI message.`);
                        }
                        execution.result = result;
                    } catch (error) {
                        execution.status = this.config.abort?.aborted ? "aborted" : "failed";
                        execution.error = error instanceof Error ? error : new Error(String(error));
                    }
                    return execution;
                }));
                handoffExecutions.push(...batchResults);
                const batchMessages = batchResults.flatMap(execution => execution.result ? [execution.result] : []);
                const failedExecution = batchResults.find(execution => execution.error);
                if (failedExecution?.error) {
                    this.emitEvent("handoff_loop_error", {
                        ...loopEvent(batchMessages),
                        reason: failedExecution.error.message
                    });
                }
                this.emitEvent("handoff_loop_end", loopEvent(batchMessages));
            } catch (error) {
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                this.emitEvent("handoff_loop_error", {
                    ...loopEvent([]),
                    reason: normalizedError.message
                });
                throw error;
            }
        }

        // Build the conclusion agent's context from the original task and all handoff outcomes.
        const conclusionInput: MessagesVariations[] = [
            ...this.config.messages,
            {
                type: "user",
                content: [
                    "Conclude the task using the handoff results below.",
                    options.handoffInstructions ? `## Handoff instructions\n${options.handoffInstructions}` : "",
                    JSON.stringify(handoffExecutions.map(execution => ({
                        agent: execution.agent,
                        batch: execution.batch,
                        status: execution.status,
                        result: execution.result,
                        error: execution.error?.message
                    }))),
                    "Return the final answer in the messages field with participate=true and continueConversation=false."
                ].filter(Boolean).join("\n\n")
            }
        ];

        // Ask the conclusion agent to synthesize the handoff results into the final answer.
        this.emitEvent("conclusion_start", conclusionInput);
        let conclusion: DebateAgentResponse;
        try {
            conclusion = await this.invokeWithTimeLimit(
                conclusionAgent.agentLogic,
                executionSchema,
                { messages: conclusionInput, abort: this.config.abort },
                this.getBoundary(conclusionAgent).timeMs
            );
            this.emitEvent("conclusion_end", conclusion.messages);
        } catch (error) {
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            this.emitEvent("conclusion_error", normalizedError, conclusionInput);
            throw error;
        }
        const result = [...conclusion.messages].reverse().find(message => message.type === "ai");
        if (!result || result.type !== "ai") {
            throw new Error(`Conclusion agent "${conclusionAgent.name}" did not return an AI message.`);
        }

        // Return the selected agents, execution records, conclusion trace, and final answer.
        return { selectedAgents, handoffExecutions, conclusionMessages: conclusion.messages, result };
    }
}
