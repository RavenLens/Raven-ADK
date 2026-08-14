import { AgentModel, ReActAgent } from "../../ReAct.agent";
import { randomUUID } from "node:crypto";
import { AEvalConfig, AgenticEvaluator, EvaluationResult } from "../aeval";
import { MessagesVariations } from "../../state";

type RunID = `run-id:${string}`;

export interface MultipleAnswersEvents {
    start_run: (id: string) => any;
    end_run: (id: string, output: any) => any;
    evaluate_start: (id: string) => any;
    evaluate_end: (id: string, evaluation: EvaluationResult) => any;
}

type ParallelRun = ReActAgent<any, any, any, any> | AgentModel | ((options: InvokeOptions) => any);

export interface InvokeOptions {
    /** User has to specify the messages history for what Multiple Answers is run */
    messages: MessagesVariations[];
    /** Abort signal is propagated to Runner and aborts the execution */
    abort?: AbortSignal;
}

export class MultipleAnswers {
    parallelRun: [RunID, ParallelRun][];
    results: [RunID, any][] = [];
    private eventsListeners: Record<string, ((...args: any[]) => void)[]> = {};

    constructor(parallelRun: ParallelRun[]) {
        this.parallelRun = parallelRun.map(rune => {
            return [
                `run-id:${randomUUID()}`,
                rune
            ];
        });
    }

    /** Register event listener */
    onEvent<K extends keyof MultipleAnswersEvents>(event: K, listener: MultipleAnswersEvents[K]): void {
        if (!this.eventsListeners[event]) {
            this.eventsListeners[event] = [];
        }
        this.eventsListeners[event].push(listener as any);
    }

    /** Emit event */
    private emit<K extends keyof MultipleAnswersEvents>(event: K, ...args: Parameters<MultipleAnswersEvents[K]>): void {
        const listeners = this.eventsListeners?.[event];
        if (listeners) {
            listeners.forEach(l => l(...args));
        }
    }

    /** Runs all parallel runners and returns all outcomes */
    async invoke(options: InvokeOptions) {
        const runPrepare = this.parallelRun.map(async ([id, run]) => {
            this.emit("start_run", id);

            // Result
            let result: any;
            if (typeof run === "function") {
                result = await run(options);
            }
            else result = await run.invoke(options);

            this.emit("end_run", id, result);

            //
            return [id, result] as [RunID, any];
        });

        this.results = await Promise.all(runPrepare);
        return this.results;
    }

    /** 
     * Evaluates all results using `AgenticEvaluator` class 
     * @param sharedContext - The messages that preceded the AI answers (e.g. the user request)
     * @param evaluatorConfig - Config for the evaluation agent
     */
    async evaluate(sharedContext: MessagesVariations[], evaluatorConfig: AEvalConfig) {
        const evaluations = [];
        for (const [id, result] of this.results) {
            this.emit("evaluate_start", id);

            const aiMessage = result?.messages?.at(-1) || result?.answer?.at(-1);

            if (!aiMessage) {
                throw new Error(`Could not find AI message in result for ${id}`);
            }

            const evaluator = new AgenticEvaluator(
                [...sharedContext, aiMessage],
                evaluatorConfig
            );

            const evaluation = await evaluator.evaluate();
            this.emit("evaluate_end", id, evaluation);

            evaluations.push({
                id,
                evaluation,
                result
            });
        }

        return evaluations;
    }

    /** 
     * Runs invoke and then evaluate, picking the best one
     * Under the hood it launches `this.invoke` and then `this.evaluate` method for each answer, sorts the results next
    */
    async getBest(sharedContext: MessagesVariations[], evaluatorConfig: any) {
        await this.invoke({ messages: sharedContext });
        const evaluations = await this.evaluate(sharedContext, evaluatorConfig);

        // Sort by score descending
        evaluations.sort((a, b) => b.evaluation.result.score - a.evaluation.result.score);

        return evaluations[0];
    }
}
