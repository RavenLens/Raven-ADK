import { DeterministicMemorySchema, ToolBasedMemorySchema } from "../../memory";
import { ReActAgent, ReActAgentPluginSpec } from "../../ReAct.agent";
import { AIMessage, MessagesVariations } from "../../state";

/** Input supplied to a debate participant for one execution. */
export interface ExecutableAgentDebateOptions {
    /** Message history available to the participant. */
    messages: MessagesVariations[];
    /** Abort signal that finishes the execution. */
    abort?: AbortSignal;
}

/** A user-defined executable agent. */
export type ExecutableAgentDebateFn<Result = unknown> = (
    options: ExecutableAgentDebateOptions
) => PromiseLike<Result> | Result;

/** An object-based executable agent, such as `ReActAgent` or a custom runner. */
export interface InvokableAgentDebate<Result = unknown> {
    invoke(options: ExecutableAgentDebateOptions): PromiseLike<Result> | Result;
}

/** A startable workflow, such as `Graph`, used as a debate participant. */
export interface StartableAgentDebate<Result = unknown> {
    start(): PromiseLike<Result> | Result;
}

/** Supported implementations for a debate participant. */
export type AgentDebateLogic<Result = unknown> =
    | ReActAgent<any, any, any, any>
    | ExecutableAgentDebateFn<Result>
    | InvokableAgentDebate<Result>
    | StartableAgentDebate<Result>;

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
    /** Logic of the agent */
    // TODO: Add CodeAct and SupervisedCodeAct type after these concepts arrival
    agentLogic: AgentDebateLogic<Result>;
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
    mutualBoundaries?: BoundaryObject;
}

export interface BoundaryObject {
    tokens?: number;
    timeMs?: number;
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
    instruction?: string;
}

export type ChoosenTheBestAgents<Result = unknown> = {
    /** List with chosen agents */
    agents: (AgentDebateType<Result> & {
        /** Reason why the specific agent was selected for the task */
        reason: string;
    })[];
} | undefined;

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

    /** Use to invoke some of debate agents */
    async invokeDebateAgent<Result = unknown>(
        agentLogic: AgentDebateLogic<Result>,
        options: ExecutableAgentDebateOptions
    ): Promise<Result> {
        if (typeof agentLogic === "function") {
            return await agentLogic(options);
        }

        if ("invoke" in agentLogic) {
            return await agentLogic.invoke(options) as Result;
        }

        return await agentLogic.start() as Result;
    }
    
    /** 
     * Use to leverage **Debate** to choose the best agent for the given task as the messages list where the primar message is the last one specified on the chat. Agent is choosen from the list of specified agents
     * * Use `result.agents[number].agentLogic` - to execute the specified agent(s)
     * 
     * @returns - returns ordered agents where better agents comes first then these poorer
     * You can use then `MultipleAnswers` class to execute the specified agents for the singular result
     * 
     * ### How does it work?
     * 1. Look on the given task as the `messages` and spawn the debate with the task to choose the besr agents for that task. Use `instruction` when specified
    */
    async chooseBestAgents(options: ChooseTheBestAgentOptions): Promise<ChoosenTheBestAgents> {
        return;
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
