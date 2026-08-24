import z from "zod";
import { HITL, Tool } from "../..";
import { ReActAgent } from "../../../ReAct.agent";
import { HITLTransportSchema } from "../hitlToolSchema";
import { HITLConfig } from "./DefaultHITL";

export type HITLJudgeOutcome = "use-hitl" | "omit";
export type AutoPilotHITLToolInstanceProbe = { toolInstance: Tool<any, any>, params: Record<string, any>; };
export type AutoPilotHITLErrorBehaviour = "throw" | "console.error";

export interface AutoPilotToolUsageOutcome {
    /** Has to be awaited till user makes the response */
    toolUsageBody?: Promise<HITL.SchemaTypes.EmitToolUsageBody>;
    /** Result of what does AutoPilotHITL Return */
    judgeEffect: HITLJudgeOutcome;
}

/**
 * AutoPilotHITL uses AI Agent to validate the stuff can be passed and pass to human only the stuff ai has assumed as the destructive
 */
export class AutoPilotHITL extends HITL.HITL implements HITLTransportSchema {
    hitlAgent: ReActAgent<any, any, any, any>;
    
    constructor(hitlAgent: ReActAgent<any, any, any, any>, hitlConfig: HITLConfig) {
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
        tool: AutoPilotHITLToolInstanceProbe,
        errorBehaviour: AutoPilotHITLErrorBehaviour = "console.error",
        instructionForActionJudegement?: string,
    ): Promise<HITLJudgeOutcome> {
        try {
            // 1. TODO: Prepare the system prompt and question for ReActAgent
            this.hitlAgent.agentConfig.messages = [
                {
                    type: "system",
                    content: "" // TODO: Instruct how to judge it
                },
                {
                    type: "user",
                    content: "" // TODO: USe `tool` and `instructionForActionJudegement`
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

                    return judgeResult;
                }
                else throw Error(`Judge didn't output trajectory`);
            }
            else throw Error("Judge outcome isn't object");
        }
        catch(err) {
            if (errorBehaviour === "console.error") {
                console.error(`AutoPilotHITL-Judge experienced error:`, err);

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
    async emitToolUsageAutoPilot(tool: AutoPilotHITLToolInstanceProbe, judgeErrorBehaviour?: AutoPilotHITLErrorBehaviour | undefined): Promise<AutoPilotToolUsageOutcome> {
        // 1. Check whether tool can be used with hitl with a `judge`
        const judgeEffect = await this.judgeToolUsage(tool, judgeErrorBehaviour);
        
        if (judgeEffect === "use-hitl") {
            return {
                judgeEffect: judgeEffect,
                // Client has to await this by hand
                toolUsageBody: super.emitToolUsage(tool.toolInstance.toolConfig.toolName), // TODO: Modify tool schema and Default HITL and here to send to client the tool params - to show more details to user about params and tool Definition
            }

        }
        else return {
            judgeEffect: judgeEffect
        };
    }
}