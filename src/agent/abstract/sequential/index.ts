import { withTelemetry } from "../../../telemetry/telemetry.js";

/**
 * It has to:
 * - Take the list with actions todo
 * - Run actions in sequence and when one has finished the another is run when success or retries when failure
 */

export type SequentialRunnerOperationalObject = ({ success: true } | { success: false, args: Record<any, any>; }) & { state: any | undefined }
export type SequentialRunnerFn = (prior?: SequentialRunnerOperationalObject | undefined) => SequentialRunnerOperationalObject | Promise<SequentialRunnerOperationalObject>;

type RunnerID = number | string;
export type SequentialRunnerBox = [RunnerID, SequentialRunnerFn];
export interface SequentialRunnerRollback {
    error: number;
    failure: number;
}

/** List with a sequential runner events */
export interface SequentialRunnerEvents {
    start: () => any;
    runStart: (runnerID: RunnerID, priorState: SequentialRunnerOperationalObject | undefined) => any;
    rollback: (runnerID: RunnerID, rollbackType: keyof SequentialRunnerRollback, rollbackNumber: number) => any;
    runEnd: (runnerID: RunnerID, resultState: SequentialRunnerOperationalObject | undefined) => any;
    error: (error: any) => any;
    end: (finishState: SequentialRunnerOperationalObject | undefined) => any;
}

export class SequentialRunner {
    runnes: SequentialRunnerBox[];
    rollback?: SequentialRunnerRollback;
    private eventsListeners: Record<string, ((...args: any[]) => void)[]> = {};
    
    constructor(
        runnes: SequentialRunnerBox[],
        rollback?: SequentialRunnerRollback
    ) {
        this.runnes = runnes;
        this.rollback = rollback;
    }

    /** Register event listener */
    onEvent<K extends keyof SequentialRunnerEvents>(event: K, listener: SequentialRunnerEvents[K]): void {
        if (!this.eventsListeners[event]) {
            this.eventsListeners[event] = [];
        }
        this.eventsListeners[event].push(listener as any);
    }

    /** Emit event */
    private emit<K extends keyof SequentialRunnerEvents>(event: K, ...args: Parameters<SequentialRunnerEvents[K]>): void {
        const listeners = this.eventsListeners[event];
        if (listeners) {
            listeners.forEach(l => l(...args));
        }
    }
    
    async invoke() {
        return withTelemetry("sequential.invoke", { runnersCount: this.runnes.length }, async (span) => {
            this.emit("start");
            
            let priorState: SequentialRunnerOperationalObject | undefined;
            for (const [runnerID, runnerFn] of this.runnes) {
                await withTelemetry("sequential.step", { runnerID }, async (stepSpan) => {
                    this.emit("runStart", runnerID, priorState);

                    //
                    let loopContinue = true;
                    let totalRunFailuresCounter = 0;
                    let totalErrorsCounter = 0;
                    
                    while (loopContinue) {
                        try {
                            const runRunnerResult = await runnerFn(priorState);
                            priorState = runRunnerResult;

                            if (!priorState.success && (this.rollback?.failure && this.rollback.failure > totalRunFailuresCounter)) {
                                totalRunFailuresCounter += 1;
                                this.emit("rollback", runnerID, "failure", totalRunFailuresCounter);
                                stepSpan.addEvent("rollback", { runnerID, type: "failure", count: totalRunFailuresCounter });
                                loopContinue = true;
                                continue;
                            }
                            else loopContinue = false;
                        }
                        catch(err: any) {
                            this.emit("error", err);
                            stepSpan.recordException(err);
                            
                            if (this.rollback?.error && this.rollback.error > totalErrorsCounter) {
                                totalErrorsCounter += 1;
                                this.emit("rollback", runnerID, "error", totalErrorsCounter);
                                stepSpan.addEvent("rollback", { runnerID, type: "error", count: totalErrorsCounter });
                                loopContinue = true;
                                continue;
                            }
                            else loopContinue = false;
                        }
                    }

                    this.emit("runEnd", runnerID, priorState);
                    stepSpan.setAttribute("step.success", priorState?.success ?? false);
                });
            }

            // Outcome producing
            this.emit("end", priorState);
            span.setAttribute("sequential.final_success", priorState?.success ?? false);
            return priorState;
        });
    }
}
