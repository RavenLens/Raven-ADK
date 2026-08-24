import { Tool } from "../tools";

export type HITLToolAllowancePossibleAnswer = "allow" | "deny";

export const DEFAULT_ABC_ANSWERS_RANGE = ["a", "b", "c"];

export interface ToolUsageConfObject {
    delayMs: number;
    defaultAnswer: HITLToolAllowancePossibleAnswer;
}

export interface HITLConfigSchema {
    /**
     * Whether agent can ask user a questions
    */
    questions?: {
        /** 
         * Whether agent can ask closed questions
         * If specified object a agent can ask a questions, perhaps when is determined by the `instruction` field of agent
        */
        abcQuestion?: {
            instruction: string;
            /**
             * E.g: [a, b, c, d, e, f]
             * Default: a, b, c
            */
            maxAnswersRange?: string[];
        } | boolean;
        /** 
         * Whwther agent can ask open questions
         * If specified object a agent can ask a questions, perhaps when is determined by the `instruction` field of agent
        */
        openQuestion?: {
            instruction: string; 
        } | boolean;
    };
    /**
     * Determines whether to ask user are the tool(s) (multiple or single) allowed to use.
     * Object is the set with tools and specification according to tool usage.
     * Use a `delayMs` and `defaultAnswer` to specify default answer after time.
    */
    toolsUsage?: Record<string, ToolUsageConfObject | true>;
}

export interface EmitToolUsageBody { answer: HITLToolAllowancePossibleAnswer; reason: "user_answer" | "delay_pass" }

// TODO: Document the HITL in the HITL doc
export interface HITLTransportSchema {
    /** Configuration object */
    config?: any;

    emitAbcQuestion?: (question: string, abcOptions: [string, string][]) => Promise<[string, string]>;
    emitOpenQuestion?: (question: string) => Promise<string>;
    emitToolUsage: (toolName: string) => Promise<EmitToolUsageBody>;
    emitAcceptance?: (question: string, context?: string) => Promise<HITLToolAllowancePossibleAnswer>;
    
    /** 
     * Describe how to use HITL Questioning tools
     * This is passed as `systemPrompt` fragment to the agent is going to leverage this HITL module
    */
    questionHITLPrompt: string;

    /**
     * Create set of Questioning tools for HITL
     */
    createQuestionTools(): Tool<any, any>[];
}
