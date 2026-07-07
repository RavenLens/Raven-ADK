import { OptionNode, ThoughtNode } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { recordEventWithData } from "../../../telemetry";

export type ReasoningChain = [ThoughtNode[], ReasoningChain[] | undefined | null];

export interface LogicReturnType {
    theBestOption: OptionNode;
    reasoningChains: { rootOption: OptionNode; reasoningChain: ReasoningChain }[];
    /** All options contains ratings from the end */
    allOptions: OptionNode[];
}

export interface StrategySchema {
    /** The name of strategy */
    name: string;
    /** The cartridge to use the telemetry */
    telemetry?: OpenTelemetryTreeOfThoughts;
    logic(totClass: TreeOfThoughts): Promise<LogicReturnType>;
}

export class OpenTelemetryTreeOfThoughts {
    recordStep(stepName: string, data?: any) {
        recordEventWithData(`tot_step_${stepName}`, data || {});
    }

    recordPruning(type: 'options' | 'thoughts', prunedFrom: number, prunedTo: number) {
        recordEventWithData("tot_pruning", { type, prunedFrom, prunedTo });
    }

    recordIteration(iteration: number, metadata?: any) {
        recordEventWithData("tot_iteration", { iteration, ...metadata });
    }
}
