import { DeterministicMemorySchema, ToolBasedMemorySchema } from "../../memory";
import { ReActAgent, ReActAgentPluginSpec } from "../../ReAct.agent";
import { AIMessage, MessagesVariations } from "../../state";
import { Tool } from "../../tools";
import { AgenticEvaluator } from "../..";
import z from "zod/v4";

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
export interface DebateAgentResponse<Result = unknown> {
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
    plugins?: ReActAgentPluginSpec[];

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

export interface InvokeAgentsDebateOptions {
    /** 
     * Allow agents to handoff task to the best agent
     * As default agents communication is used barelly as a helper for the main delegated agent
     * @default false
    */
    allowHandoff?: boolean | {
        multiple: number | boolean;
        one?: boolean;
    };
    talkMeanwhile?: boolean | { instructions: string; boundaries?: BoundaryObject; };
    talkBefore?: boolean | { instructions: string; boundaries?: BoundaryObject; };
    // /** TODO: Implement: Protocols used to communicate agents debate with other agents lives in exterior to RavenADK e.g:

    // * * GACP, A2A, ACP implementations or custom protocol implementation by using RavenADK specification schema
    // * TODO: Add once the protocol schema for RavenADK arrives
    //  */
    // protocols: any;
}

export interface AgentCommunicationStageRecord {
    agentName: string;
    messages: MessagesVariations[];
    timestamp: number;
}

export interface ChooseTheBestAgentOptions {
    /**
     * @default 1 - chooses one the best agent for the task
     */
    agentsCount?: number;
    /**
     * Add additional optional instructions why to respect in selection next agents for the task resolution
     * @optional - choose only when required
     */
    debateInstruction?: string;
    /** Agent used to judge order of the best agents - has to return the zod structured output */
    judgeAgent: AgenticEvaluator | AgentDebateType;
}

export type ChoosenTheBestAgents<Result = unknown> = {
    /** List with chosen agents */
    agents: (AgentDebateType<Result> & {
        /** Reason why the specific agent was selected for the task */
        reason: string;
    })[];
};

export interface InvokeConsultationOptions {
    /** 
     * Name of choosen agent to perform the task
     * * Name has to occur on list of agents participates in the conversation
    */
    choosenExecutionAgent: string;
    /** 
     * List with agents participates in the consultation
     * @default undefined - as default debate is used to choose consultation agents
    */
    choosenConsultationAgents?: AgentDebateType["name"][];
    /**
     * Specify the stages for that consultation is going to happen
     * 
     * @default {{ begining: true, betweenExecutionReasoning: true }}
     */
    invokeForStages?: {
        /** 
         * Invoke before any agent execution begining
         * @default {true}
        */
        begining?: boolean;
        /** 
         * Executes consultation for the reasoning or step between choosen agent stages
         * @default {true}
        */
        betweenExecutionReasoning?: boolean;
    }
}

export interface InvokeConsultationResult {
    /**
     * Communication registered records for each specified stage
     */
    consultation: Record<keyof InvokeConsultationOptions["invokeForStages"], AgentCommunicationStageRecord>;
    choosenAgentResult: MessagesVariations;
    /**
     * Is the result of the execution of the agent in `consultation` mode
    */
    result: AIMessage;
}

export interface InvokeCritiqueOptions {
    /** 
     * Name of choosen agent to perform the task
     * * Name has to occur on list of agents participates in the conversation
    */
    choosenExecutionAgent: string;
    /**
     * List with agents user wants to perform the debate without seeking any before
     * This is fixed list
     * Omit to choose agents from the `agents` list
     */
    choosenCriticqueAgents?: AgentDebateType["name"][];
    /**
     * Optional Instructions for debate what is essential to pickup the critique for the agents execution
     */
    criticueAgentsSelectionInstruction?: string;
    /**
     * @default true - whether to use debate to 
     */
    useDebateBeforeExecution: boolean;
}

export interface InvokeCritiqueResult {
    /** List with agents have participied in the critique */
    agentsCritique: {
        /** Name of the agent gave the critique */
        agentName: string
        /** Messages descriobes the critique for the `agentName` */
        critique: MessagesVariations[];
    }[];
    /** Result is the final message comes from the critique of other agents  */
    result: AIMessage;
}

export interface InvokeHandoffOptions {
    /**
     * Additional isntructions how to choose the agent(s) for the handoff
     */
    instructions?: string;
    /** Name of agent from `agents` is used to make the conclusion out of the task */
    choosenConclusionAgent: AgentDebateType["name"];
    /**
     * Specify agents will be able to be handoff simulatenously or in queue when `executeHandoffParallel: false`
     * @default 1 - handoffs task to barelly one agent
     */
    handoffToAgentsCount?: number;
    /**
     * Specify whether execution of handoff is done by number of agents, after specified number of parallel the results of dirst are measured and then executed by another non specified agents
     * - Agents aren't duplicated in the handoff execution
     * @default true
     */
    executeHandoffParallel?: boolean | number;
}

/** A participant selected for a handoff and the output of its execution. */
export interface HandoffExecution<Result = unknown> {
    /** Agent selected for this execution. */
    agent: AgentDebateType<Result>["name"];
    /** Zero-based batch in which this agent was executed. Number represents the number of try  */
    batch: number;
    /** Whether the participant completed, failed, or was aborted. */
    status: "completed" | "failed" | "aborted";
    /** Raw value returned by the participant when execution completed. */
    result?: AIMessage;
    /** Normalized failure when execution did not complete. */
    error?: Error;
}

/** Result of delegating a task to the agents selected for a handoff. */
export interface InvokeHandoffResult<Result = unknown> {
    /** Agents selected for the handoff by debate, ordered from the best match first. */
    selectedAgents: (AgentDebateType<Result> & {
        /** Explanation produced by the selection step. */
        reason: string;
    })[];
    /** List with handoffs. Every attempted execution, including failed and aborted participants. */
    handoffExecutions: HandoffExecution<Result>[];
    /** List with messages generated by conclusion agent - represents full reasoning - the last message is exact `result` field Result */
    conclusionMessages: MessagesVariations[];
    /** Result is selected by `choosenconclusionAgent` */
    result: AIMessage;
}

export class AgentsDebate<
    Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
    Result = unknown
> {
    config: AgentsDebateConfig<Memory, Result>;

    constructor(config: AgentsDebateConfig<Memory, Result>) {
        this.config = config;
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
        const execution = this.invokeDebateAgent(logic, schema, options);
        
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
        debateInstructions: string
    ): Promise<MessagesVariations[]> {
        const agents = this.getAgentsWithNames(agentNames);
        if (agents.length === 0) throw new Error("Cannot spawn a debate without at least one known agent.");

        // Trigger errors for exceeded boundaries
        agents.forEach(agent => this.getBoundary(agent));

        const startedAt = Date.now();
        const mutual = this.config.debateMutualBoundaries ?? {};
        
        // Define room for conversation message with specified task
        const room: MessagesVariations[] = [...this.config.messages, {
            type: "user",
            content: [`# Debate subject\n${debateSubject}`, `# Instructions\n${debateInstructions}`].join("\n\n")
        }];
        
        // Participation of the agent
        const participation = new Map<string, boolean>();
        const continuation = new Map<string, boolean>();
        const agentTokens = new Map<string, number>();
        let mutualTokensUsed = 0;

        // Executes agent in round
        const runRound = async (round: number) => {
            // 1. Run agents and return results of agent run
            const results = await Promise.all(agents.map(async agent => {
                const boundary = this.getBoundary(agent);
                
                // Error fallbacks
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

            // 3. Add results to the room messages
            for (const item of results) {
                if (!item) continue;
                
                participation.set(item.agent.name, item.response.participate);
                continuation.set(item.agent.name, item.response.continueConversation);
                agentTokens.set(item.agent.name, (agentTokens.get(item.agent.name) ?? 0) + item.consumedTokens);

                room.push({ type: "user", content: `## ${item.agent.name}` }, ...item.response.messages);
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
     * Use to invoke consultation to discuss the task among the best agents for the given task
     * Before the execution the debate is used to `chooseBestAgents` that will engage in the communication for each stage 
     * 
     * ### How does it work?
     * 1. Generate the debate before to choose the `choosenConsultationAgents` for the task or uses `choosenConsultationAgents`
     * 2. Generate `consultation` communication among agents and consultation execution agent
     * 3. Use consultation results from the best agents or `choosenConsultationAgents` to use these agents for the task
    */
    async invokeConsultation(options: InvokeConsultationOptions): Promise<InvokeConsultationResult | undefined> {
        return;
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
        return undefined;
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
        return;
    }
}
