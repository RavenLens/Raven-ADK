import { AgentModel, ReActAgent } from "../../ReAct.agent";
import { randomUUID } from "node:crypto";
import { AgenticEvaluator, EvaluationResult } from "../aeval";
import { MessagesVariations } from "../../state";
import { withTelemetry } from "../../../telemetry/telemetry";

type RunID = `run-id:${string}`;

export interface MultipleAnswersEvents {
    start_run: (id: string) => any;
    end_run: (id: string, output: any) => any;
    evaluate_start: (id: string) => any;
    evaluate_end: (id: string, evaluation: EvaluationResult) => any;
}

type ParallelRun = ReActAgent<any, any, any, any> | AgentModel | (() => any);

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
    async invoke() {
        return withTelemetry("multianswers.invoke", { runsCount: this.parallelRun.length }, async (span) => {
            const runPrepare = this.parallelRun.map(async ([id, run]) => {
                return withTelemetry("multianswers.individual_run", { runId: id }, async (childSpan) => {
                    this.emit("start_run", id);

                    // Result
                    let result: any;
                    if (typeof run === "function") {
                        result = await run();
                    }
                    else result = await run.invoke();

                    this.emit("end_run", id, result);
                    
                    childSpan.addEvent("run_completed", { id });

                    //
                    return [id, result] as [RunID, any];
                });
            });

            this.results = await Promise.all(runPrepare);
            
            span.setAttribute("multianswers.results_count", this.results.length);
            
            return this.results;
        });
    }

    /** 
     * Evaluates all results using AgenticEvaluator 
     * @param sharedContext - The messages that preceded the AI answers (e.g. the user request)
     * @param evaluatorConfig - Config for the evaluation agent
     */
    async evaluate(sharedContext: MessagesVariations[], evaluatorConfig: any) {
        return withTelemetry("multianswers.evaluate", { resultsCount: this.results.length }, async (span) => {
            const evaluations = [];
            for (const [id, result] of this.results) {
                const evaluationResult = await withTelemetry("multianswers.individual_evaluation", { runId: id }, async (childSpan) => {
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
                    
                    childSpan.setAttribute("evaluation.score", evaluation.result.score);
                    childSpan.addEvent("evaluation_completed", { id, score: evaluation.result.score });

                    return {
                        id,
                        evaluation,
                        result
                    };
                });
                
                evaluations.push(evaluationResult);
            }

            span.setAttribute("multianswers.evaluations_count", evaluations.length);

            return evaluations;
        });
    }

    /** Runs invoke and then evaluate, picking the best one */
    async getBest(sharedContext: MessagesVariations[], evaluatorConfig: any) {
        return withTelemetry("multianswers.get_best", {}, async (span) => {
            await this.invoke();
            const evaluations = await this.evaluate(sharedContext, evaluatorConfig);

            // Sort by score descending
            evaluations.sort((a, b) => b.evaluation.result.score - a.evaluation.result.score);

            const best = evaluations[0];
            if (best) {
                span.setAttribute("best_run.id", best.id);
                span.setAttribute("best_run.score", best.evaluation.result.score);
            }

            return best;
        });
    }
}
