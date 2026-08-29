import z from "zod";
import { HITL, Tool } from "../..";
import { ReActAgent } from "../../../ReAct.agent";
import { HITLToolInstanceProbe, HITLEventsSpecType, HITLTransportSchema } from "../hitlToolSchema";
import { DefaultHITLEvents, HITL_ACCEPTANCE_TOOL_NAME, HITLConfig } from "./DefaultHITL";

export type HITLJudgeOutcome = "use-hitl" | "omit";
export type AutoPilotHITLErrorBehaviour = "throw" | "console.error";

export type AutoPilotHITLEvents = HITLEventsSpecType & DefaultHITLEvents & {
    autopilot_judge_started: (tool: HITLToolInstanceProbe) => void;
    autopilot_judge_finished: (tool: HITLToolInstanceProbe, outcome: HITLJudgeOutcome) => void;
};

export interface AutoPilotToolUsageOutcome {
    /** Has to be awaited till user makes the response */
    toolUsageBody?: Promise<HITL.SchemaTypes.EmitToolUsageBody>;
    /** Result of what does AutoPilotHITL Return */
    judgeEffect: HITLJudgeOutcome;
}

export interface AutoPilotHITLConfig extends HITLConfig {
    /**
     * Whether has the judge evaluate whether `emitAccetpance` has to trigger the judge that evaluates the instruction
     */
    engageJudgeInEmittingAccetpance?: boolean | {
        instruction: string;
    };
    
    /** Use to specify additional description for the judge in system prompt */
    hitlJudgeSystemPromptExtension?: string;
    /** Use to replace system prompt given to judge to waht is specified there */
    hitlJudgeSystemPromptReplacement?: string;
    /** Use to extend chat message system prompt given to the judge */
    hitlJudgeUserMessagePromptExtension?: string;
}

/**
 * AutoPilotHITL uses AI Agent to validate the stuff can be passed and pass to human only the stuff ai has assumed as the destructive
 */
export class AutoPilotHITL extends HITL.HITL<AutoPilotHITLEvents, AutoPilotHITLConfig> implements HITLTransportSchema<AutoPilotHITLEvents> {
    hitlAgent: ReActAgent<any, any, any, any>;
    
    constructor(hitlAgent: ReActAgent<any, any, any, any>, hitlConfig: AutoPilotHITLConfig) {
        super(hitlConfig);
        this.hitlAgent = hitlAgent;
    }

    /**
     * Use to judge whether the tool usage can pass without asking for acceptance or should trigger the ask
     * 
     * - Behaviour:
     * 1. Replaces current Agent messages with the preparation for HITL
     * 2. Triggers agent with structured output to validate whether action has to be judged 
     * 
     * @param tool - uses the configuration to evaluate the tool 
     * @param instructionForActionJudegement - Optional instruction passed to Agent is going to evaluate tool
     * @param errorBehaviour - agent can cause error therefore here is specification how error should be handled. `console.error` causes the state to be setup for `omit` once error is catched
     * 
     * @returns state whether the tool has to use HITL
     * @throws - errors when judge Agent thrown internal error (from its logic) or it didn't return the structured output as was demanded by `invokeStructuredOutput` schema
     */
    private async judgeToolUsage(
        tool: HITLToolInstanceProbe,
        errorBehaviour: AutoPilotHITLErrorBehaviour = "console.error",
        instructionForActionJudegement?: string,
    ): Promise<HITLJudgeOutcome> {
        this.emitEvent("autopilot_judge_started", tool);
        try {
            // 1. Prepare the system prompt and question for ReActAgent
            const { toolName, toolDescription, toolArguments, toolOutputSchema } = tool.toolInstance.toolConfig;
            const judgeSystemPromptMessage = (() => {
                let defaultContent = [
                    "You are a safety judge for an AI agent's proposed tool invocation.",
                    "Decide whether a human must approve the action before it runs.",
                    "Return exactly one structured result: \"use-hitl\" when the action is destructive, irreversible, security-sensitive, privacy-sensitive, financially consequential, externally visible, or ambiguous; return \"omit\" only when the action is clearly safe to run without human approval.",
                    "Judge the specific invocation, including its parameters and the tool's documented behavior. Treat uncertainty as a reason to use HITL.",
                    "Do not execute the tool, do not alter its parameters, and do not return any result other than the requested structured output."
                ].join("\n")
                
                if (this.config.hitlJudgeSystemPromptReplacement) {
                    defaultContent = this.config.hitlJudgeSystemPromptReplacement;
                }
                else if (this.config.hitlJudgeSystemPromptExtension) {
                    defaultContent = [
                        defaultContent,
                        `\n\n#### Additional Instruction extensions given from user`,
                        this.config.hitlJudgeSystemPromptExtension
                    ].join("\n");
                }

                return defaultContent;
            })();
            const userMessage = (() => {
                const defaultUserMessage = [
                    "Evaluate this proposed tool invocation:",
                    "",
                    "#tool",
                    JSON.stringify({
                        name: toolName,
                        description: toolDescription,
                        argumentsSchema: z.toJSONSchema(toolArguments),
                        outputSchema: toolOutputSchema ? z.toJSONSchema(toolOutputSchema) : undefined,
                        params: tool.params
                    }, null, 2),
                    "",
                    "#instructionForActionJudegement",
                    "Is additional instruction proposed for you",
                    instructionForActionJudegement?.trim() || "No additional instruction was provided."
                ].join("\n");
                
                if (this.config.hitlJudgeUserMessagePromptExtension) {
                    return defaultUserMessage + `\n\n${this.config.hitlJudgeUserMessagePromptExtension}`;
                }

                return defaultUserMessage;
            })();
            
            this.hitlAgent.agentConfig.messages = [
                {
                    type: "system",
                    content: judgeSystemPromptMessage
                },
                {
                    type: "user",
                    content: userMessage
                }
            ];
    
            // 2. Make structured output
            const outcomeSchema = z.object({
                judgeResult: z.enum(["omit", "use-hitl"] as HITLJudgeOutcome[])
            });
            const structuredOutputResult = await this.hitlAgent.invokeStructuredOutput(outcomeSchema);
            const lastMessage = structuredOutputResult.messages.at(-1);

            // 3. Handle reset of agent messages
            this.hitlAgent.agentConfig.messages = []; 
            
            // 4. Handle retrived judegement
            if (lastMessage?.type === "ai") {
                if (typeof lastMessage.structuredOutput === "object") {
                    const { judgeResult } = lastMessage.structuredOutput as z.infer<typeof outcomeSchema>;

                    this.emitEvent("autopilot_judge_finished", tool, judgeResult);
                    return judgeResult;
                }
                else throw Error(`Judge didn't output trajectory`);
            }
            else throw Error("Judge outcome isn't object");
        }
        catch(err) {
            if (errorBehaviour === "console.error") {
                console.error(`AutoPilotHITL-Judge experienced error:`, err);

                this.emitEvent("autopilot_judge_finished", tool, "omit");

                // Default state return
                return "omit";
            }
            else throw Error(`AutoPilotHITL-Judge experienced error: ` + JSON.stringify(err));
        }
    }

    /**
     * Is a custom method that leverages the Agent Judge to decide whether hitl can be called
     * It calls the DefaultHITL tool and returns the promose from the ask as the `toolUsageBody`
     * 
     * @param tool 
     * @param judgeErrorBehaviour 
     * 
     * @returns object - the tool usage has to be awaited 
     */
    async emitToolUsageAutoPilot(
        tool: HITLToolInstanceProbe,
        judgeErrorBehaviour?: AutoPilotHITLErrorBehaviour,
        instructionForActionJudegement?: string,
    ): Promise<AutoPilotToolUsageOutcome> {
        // 1. Check whether tool can be used with hitl with a `judge`
        const judgeEffect = await this.judgeToolUsage(tool, judgeErrorBehaviour, instructionForActionJudegement);
        
        if (judgeEffect === "use-hitl") {
            return {
                judgeEffect: judgeEffect,
                // Client has to await this by hand
                toolUsageBody: super.emitToolUsage(tool),
            }

        }
        else return {
            judgeEffect: judgeEffect
        };
    }

    /**
     * Common HITL-schema wrapper for AutoPilot tool approval.
     *
     * Under the hood, this method delegates to {@link emitToolUsageAutoPilot}
     * so the AutoPilot judge can decide whether the tool requires human
     * approval. It exists to comply with the RavenADK logic that consumes the
     * common HITL transport contract defined in `hitlToolSchema.ts`.
     * 
     * It's triggered for the tools are on the list of tools have to call the `emitToolUsage`, this method isn't triggered for `question` tools as the `open`, `closed` or `accetpance` meanwhile this last one cattegory (`acceptance`)  is handled by `emitAcceptance` method from `AutoPilotHITL` is monkeypatch for `DefaultHITL` (`HITL`) `emitAcceptance`
     *
     * When the judge accepts the tool for HITL (`use-hitl`), this returns the
     * approval result produced by the regular HITL flow. That result contains
    * the user's or configured delay-pass answer and its reason. When the
    * judge does not allow HITL to be called (`omit`), this returns `{ answer:
    * "deny", reason: "user_answer" }`. In this branch, `user_answer` is a
    * schema-compatible fallback reason, not an answer supplied by the user;
    * the denial prevents the tool from being executed.
    * 
    * `HITL_ACCEPTANCE_TOOL_NAME` is skipped due to: Accetpance tool triggers dedicated method `emitAcceptance` from this class therefore the `emitToolUsage` is skipped delibaratelly
     *
     * @param tool Tool instance and invocation parameters to evaluate.
     * @returns The common RavenADK HITL approval result.
     */
    async emitToolUsage(tool: HITLToolInstanceProbe): Promise<HITL.SchemaTypes.EmitToolUsageBody> {
        // Accetpance tool triggers dedicated method `emitAcceptance` from this class therefore the `emitToolUsage` is skipped delibaratelly
        if (tool.toolInstance.toolConfig.toolName === HITL_ACCEPTANCE_TOOL_NAME) {
            return {
                answer: "deny",
                reason: "accetpance_separate_logic"
            }
        }
        
        const autoPilotHITLResult = await this.emitToolUsageAutoPilot(tool);
        if (autoPilotHITLResult.toolUsageBody) {
            return autoPilotHITLResult.toolUsageBody;
        }
        else return { // Assume in respect to `emitToolUsageAutoPilot` logic that event here is `omit` that's why `toolUsageBody` is missing
            answer: "deny",
            reason: "user_answer" // Default is tool answer
        }
    }


    /**
     * Method given to the
     * @param instruction - isntruction given to judge to evaluate the accetpance request
     * @returns 
     */
    private async invokeAcceptanceJudge(instruction: string): Promise<HITLJudgeOutcome> {
        const previousMessages = this.hitlAgent.agentConfig.messages;
        try {
            this.hitlAgent.agentConfig.messages = [
                {
                    type: "system",
                    content: this.config.hitlJudgeSystemPromptReplacement
                        || "You are a safety judge deciding whether an acceptance request requires human approval."
                },
                {
                    type: "user",
                    content: instruction + (this.config.hitlJudgeUserMessagePromptExtension
                        ? `\n\n${this.config.hitlJudgeUserMessagePromptExtension}`
                        : "")
                }
            ];

            const outcomeSchema = z.object({
                judgeResult: z.enum(["omit", "use-hitl"] as HITLJudgeOutcome[])
            });
            const result = await this.hitlAgent.invokeStructuredOutput(outcomeSchema);
            const lastMessage = result.messages.at(-1);
            if (lastMessage?.type !== "ai" || typeof lastMessage.structuredOutput !== "object") {
                throw new Error("Acceptance judge outcome isn't object");
            }

            return (lastMessage.structuredOutput as z.infer<typeof outcomeSchema>).judgeResult;
        }
        catch (error) {
            console.error("AutoPilotHITL acceptance judge experienced error:", error);
            return "omit";
        }
        finally {
            this.hitlAgent.agentConfig.messages = previousMessages;
        }
    }
    
    /**
     * Evaluate whether the accetpance has to be triggered for the asked question
     * 
     * Monkeypatching for original `emitAccetpance` triggers judge to verify whether is wothy to call hitl when teh command was specified
     * TODO: Whether judge has to be engaged when original emitaccetpance is specified as the tool from its original method - yes and the tool call for accetpance method shouldn't invoke the judge 
     * @param question
     * @param context 
     */
    emitAcceptance(question: string, context?: string | undefined): Promise<HITL.SchemaTypes.HITLToolAllowancePossibleAnswer> {
        const engageJudge = this.config.engageJudgeInEmittingAccetpance;
        if (!engageJudge) {
            return super.emitAcceptance(question, context);
        }

        const acceptanceInstruction = typeof engageJudge === "object"
            ? engageJudge.instruction
            : undefined;
        const judgeInstruction = [
            "Evaluate whether this acceptance request should be shown to a human.",
            "Return \"use-hitl\" when explicit human approval is required or the request is ambiguous.",
            "Return \"omit\" only when the request is clearly safe to deny without asking the human.",
            `Acceptance question: ${question}`,
            context ? `Context: ${context}` : "No additional context was provided.",
            acceptanceInstruction ? `Additional acceptance guidance: ${acceptanceInstruction}` : undefined
        ].filter((part): part is string => Boolean(part)).join("\n");

        return this.invokeAcceptanceJudge(judgeInstruction).then((judgeResult) =>
            judgeResult === "use-hitl"
                ? super.emitAcceptance(question, context)
                : "deny"
        );
    }
}