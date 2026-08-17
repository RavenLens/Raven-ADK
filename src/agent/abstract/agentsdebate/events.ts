import z from "zod";
import { AgentDebateLogic, ExecutableAgentDebateOptions } from ".";
import { MessagesVariations } from "../../state";
import { InvokeConsultationOptions, InvokeConsultationResult, InvokeCritiqueOptions, InvokeCritiqueResult, InvokeHandoffOptions, InvokeHandoffResult } from "./config";

export interface AgentsDebateLoopEvent {
    loop: number;
    loops_count: number;
    messages: MessagesVariations[];
}

export interface AgentsDebateLoopErrorEvent extends AgentsDebateLoopEvent {
    reason: string;
}

export interface AgentsDebateWorkflowStartEvent<Options, Params extends object = Record<string, unknown>> {
    options: Options;
    messages: MessagesVariations[];
    params: Params;
}

export interface DebateAgentStartParams {
    agentLogic: AgentDebateLogic<any>;
    schema: z.ZodType<any>;
}

export interface ConsultationStartParams {
    executionAgent: string;
    consultationAgents: string[];
    loopsCount: number;
    stages: NonNullable<InvokeConsultationOptions["invokeForStages"]>;
}

export interface CritiqueStartParams {
    executionAgent: string;
    critiqueAgents: string[];
    loopsCount: number;
}

export interface HandoffStartParams {
    conclusionAgent: string;
    candidates: string[];
    handoffToAgentsCount: number;
    executeHandoffParallel: boolean | number | undefined;
}

/** Lifecycle events emitted by the public AgentsDebate workflows. */
export interface AgentsDebateEvents {
    debate_agent_start: (
        agentLogic: AgentDebateLogic<any>,
        schema: z.ZodType<any>,
        options: ExecutableAgentDebateOptions,
        messages: MessagesVariations[],
        params: DebateAgentStartParams
    ) => void | Promise<void>;
    debate_agent_end: (result: unknown) => void | Promise<void>;
    debate_agent_error: (error: Error) => void | Promise<void>;
    debate_loop_start: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    debate_loop_end: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    debate_loop_error: (event: AgentsDebateLoopErrorEvent) => void | Promise<void>;
    consultation_start: (
        options: InvokeConsultationOptions,
        messages: MessagesVariations[],
        params: ConsultationStartParams
    ) => void | Promise<void>;
    consultation_end: (result: InvokeConsultationResult | undefined) => void | Promise<void>;
    consultation_error: (error: Error) => void | Promise<void>;
    consultation_loop_start: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    consultation_loop_end: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    consultation_loop_error: (event: AgentsDebateLoopErrorEvent) => void | Promise<void>;
    critique_start: (
        options: InvokeCritiqueOptions,
        messages: MessagesVariations[],
        params: CritiqueStartParams
    ) => void | Promise<void>;
    critique_end: (result: InvokeCritiqueResult | undefined) => void | Promise<void>;
    critique_error: (error: Error) => void | Promise<void>;
    critique_loop_start: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    critique_loop_end: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    critique_loop_error: (event: AgentsDebateLoopErrorEvent) => void | Promise<void>;
    handoff_start: (
        options: InvokeHandoffOptions,
        messages: MessagesVariations[],
        params: HandoffStartParams
    ) => void | Promise<void>;
    handoff_end: (result: InvokeHandoffResult<any> | undefined) => void | Promise<void>;
    handoff_error: (error: Error) => void | Promise<void>;
    handoff_loop_start: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    handoff_loop_end: (event: AgentsDebateLoopEvent) => void | Promise<void>;
    handoff_loop_error: (event: AgentsDebateLoopErrorEvent) => void | Promise<void>;
    conclusion_start: (messages: MessagesVariations[]) => void | Promise<void>;
    conclusion_end: (messages: MessagesVariations[]) => void | Promise<void>;
    conclusion_error: (error: Error, messages: MessagesVariations[]) => void | Promise<void>;
}
