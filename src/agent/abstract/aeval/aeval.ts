import { AgentModel, ReActAgent, ReActAgentConfig } from "../../ReAct.agent";
import { MessagesVariations } from "../../state";
import { z } from "zod";

export const EvaluationResultSchema = z.object({
    score: z.number().min(0.1).max(1.0),
    verdict: z.enum(['BEST', 'GOOD', 'POOR', 'REJECTED']),
    reasoning: z.string(),
    metrics: z.record(z.string(), z.number()),
    improvements: z.array(z.string()).optional()
});

export type EvaluationResult = {
    /** Evaluation result */
    result: z.infer<typeof EvaluationResultSchema>;
    /** Messages list that are the evaluation agent history */
    messages: MessagesVariations[];
}

abstract class AgenticEvaluatorSchema {
    abstract evaluate(): Promise<EvaluationResult>;
    abstract loop(
        runBy: ReActAgent<any, any, any, any> | AgentModel,
        expected: Pick<EvaluationResult["result"], "score" | "verdict"> & { expectationDescription?: string; },
        maxRetries: number
    ): Promise<{ success: boolean; reasoningMessages: MessagesVariations[] }>;
}


type AEvalConfig = Omit<ReActAgentConfig<any, any, any>, "messages">;

export class AgenticEvaluator implements AgenticEvaluatorSchema {
    messages: MessagesVariations[];
    agentConfig: ReActAgentConfig<any, any, any>;
    
    /**
     * @param messages - List with messages with ai answer as last one to evaluate. The last message has to be ai answer, the last user message is the message base on that we mesure output
     * @param agentConfig - it's the config for Agent will run a evaluation. Without messages since messages are specified as first param in `AgenticEvaluator` constructor
     */
    constructor(
        messages: MessagesVariations[],
        agentConfig: AEvalConfig
    ) {
        this.messages = messages;
        this.agentConfig = {
            ...agentConfig,
            messages: messages
        };
    }

    /** Runs evaluation with ReActAgent with specified config and returns outcome */
    async evaluate(messages?: MessagesVariations[]): Promise<EvaluationResult> {
        const evalAgent = new ReActAgent({
            ...this.agentConfig,
            systemPrompt: [
                this.agentConfig.systemPrompt,
                "\nEvaluation Task:",
                "You are an expert AI evaluator. Your task is to analyze the provided AI response against the conversation history and user expectations.",
                "You must return ONLY a JSON object matching this schema:",
                JSON.stringify(z.toJSONSchema(EvaluationResultSchema), null, 2)
            ].join("\n"),
            withConclusion: false
        });

        const lastAIMessage = this.messages.at(-1);
        if (lastAIMessage?.type !== 'ai' || (!lastAIMessage.content && !lastAIMessage.structuredOutput)) {
            throw new Error("Last message must be an AI message with content to evaluate it.");
        }

        const evaluationPrompt = [
            "### AI Response to Evaluate:",
            lastAIMessage.structuredOutput ? JSON.stringify(lastAIMessage.structuredOutput, null, 4) : lastAIMessage.content,
            "\n### Conversation History:",
            JSON.stringify(this.messages, null, 2)
        ].join("\n");

        evalAgent.agentConfig.messages.push({
            type: "user",
            content: evaluationPrompt
        });

        const result = await evalAgent.invokeStructuredOutput(EvaluationResultSchema);
        const lastMessage = result.messages.at(-1);

        if (lastMessage?.type !== 'ai' || !lastMessage.structuredOutput) {
            throw new Error("Evaluator failed to produce evaluation result.");
        }

        return {
            result: lastMessage.structuredOutput,
            messages: result.messages
        } as EvaluationResult;
    }

    /**
     * Runs `evaluate` method and retrives `maxRetries` times to match the `expected` 
     * @param runBy - it's the agent or model that will be re-run to improve output. Can be just LLM without any loop like ReAct agent to conserve costs
     * @param expected - expected outcome. Where `score` and `verdict` is at least what is acceptable
     * @param maxRetries - it's the number of retries where. Default = 0 (Means: Agent runs loop one time and returns `success: false` if result doesn't match expectance)
     */
    async loop(
        runBy: ReActAgent<any, any, any, any> | AgentModel,
        expected: Pick<EvaluationResult["result"], "score" | "verdict"> & { expectationDescription?: string; }, 
        maxRetries: number = 0
    ): Promise<{ success: boolean; reasoningMessages: MessagesVariations[]; }> {
        let currentRetries = 0;
        const verdicts = ['REJECTED', 'POOR', 'GOOD', 'BEST'];
        
        while (currentRetries <= maxRetries) {
            // `messages` are the trace of evaluation of AI Agent
            const { result, messages } = await this.evaluate();
            
            const scoreMatch = result.score >= expected.score;
            const verdictMatch = verdicts.indexOf(result.verdict) >= verdicts.indexOf(expected.verdict);

            if (scoreMatch && verdictMatch) {
                return {
                    success: true,
                    reasoningMessages: messages
                };
            }

            if (currentRetries < maxRetries) {
                const improvementPointer = [
                    "Your previous response did not meet the quality standards.",
                    expected.expectationDescription ? `Expectation: ${expected.expectationDescription}` : "",
                    "Reasoning: " + result.reasoning,
                    "Please improve based on these points:",
                    ...(result.improvements?.map(i => `- ${i}`) || ["- General improvement of accuracy and detail"])
                ].filter(Boolean).join("\n");

                this.messages.push({
                    type: "user",
                    content: improvementPointer
                });

                this.agentConfig.messages = [...this.messages];
                if (runBy instanceof ReActAgent) {
                    const runResult = await runBy.invoke();
                    this.messages = runResult.messages;
                } else {
                    const modelResult = await runBy.invoke({ messages: this.messages });
                    this.messages = modelResult.messages;
                }
            }

            currentRetries++;
        }

        return {
            success: false,
            reasoningMessages: this.messages
        };
    }
}
