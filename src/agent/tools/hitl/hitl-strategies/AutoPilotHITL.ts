import z from "zod";
import { HITL, Tool } from "../..";
import { ReActAgent } from "../../../ReAct.agent";
import { HITLToolInstanceProbe, HITLEventsSpecType, HITLTransportSchema } from "../hitlToolSchema";
import { DefaultHITLEvents, HITLConfig } from "./DefaultHITL";

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
     * When the judge accepts the tool for HITL (`use-hitl`), this returns the
     * approval result produced by the regular HITL flow. That result contains
    * the user's or configured delay-pass answer and its reason. When the
    * judge does not allow HITL to be called (`omit`), this returns `{ answer:
    * "deny", reason: "user_answer" }`. In this branch, `user_answer` is a
    * schema-compatible fallback reason, not an answer supplied by the user;
    * the denial prevents the tool from being executed.
     *
     * @param tool Tool instance and invocation parameters to evaluate.
     * @returns The common RavenADK HITL approval result.
     */
    async emitToolUsage(tool: HITLToolInstanceProbe): Promise<HITL.SchemaTypes.EmitToolUsageBody> {
        const autoPilotHITLResult = await this.emitToolUsageAutoPilot(tool);
        if (autoPilotHITLResult.toolUsageBody) {
            return autoPilotHITLResult.toolUsageBody;
        }
        else return { // Assume in respect to `emitToolUsageAutoPilot` logic that event here is `omit` that's why `toolUsageBody` is missing
            answer: "deny",
            reason: "user_answer" // Default is tool answer
        }
    }
}