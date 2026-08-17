import { AgentDebateType, BoundaryObject } from ".";
import { AIMessage, MessagesVariations } from "../../state";
import { AgenticEvaluator } from "../aeval";

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
    /** Optional task messages supplied to the execution and consultation agents. */
    taskMessages?: MessagesVariations[];
    /** 
     * List with agents participates in the consultation
     * @default undefined - as default debate is used to choose consultation agents
    */
    choosenConsultationAgents?: AgentDebateType["name"][];
    /**
     * How many times to repeat the debate atop of previous values
     * @default 1
     */
    loopsCount?: number;
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
    consultation: {
        begining: AgentCommunicationStageRecord[];
        betweenExecutionReasoning: AgentCommunicationStageRecord[];
    };
    choosenAgentResult: MessagesVariations[];
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
    /**
     * Number of critique and revision cycles to run.
     * @default 1
     */
    loopsCount?: number;
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
    executionMessages: MessagesVariations[];
}

export interface InvokeHandoffOptions {
    /**
     * Additional isntructions how to choose the agent(s) for the handoff
     */
    handoffInstructions?: string;
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