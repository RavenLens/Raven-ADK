import z4 from "zod/v4";
import { OptionNode, ThoughtNode } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { recordEventWithData } from "../../../telemetry";

export const createGenerateOptionsSchema = (optionSchema: z4.ZodTypeAny) => z4.object({
    options: z4.array(optionSchema).describe("List with generated options")
});

export const createTopKOptionsSchema = (optionSchema: z4.ZodTypeAny) => z4.object({
    topOptions: z4.array(optionSchema).describe("List with Top-K options where k is the number")
});

export const createTheBestOptionSchema = (optionSchema: z4.ZodTypeAny) => z4.object({
    theBestOption: z4.array(optionSchema).describe("The best option selected")
});

export type ReasoningChain = [ThoughtNode[], ReasoningChain[] | undefined | null];

export interface LogicReturnType<StructuredOutput = unknown> {
    theBestOption: OptionNode<StructuredOutput>;
    reasoningChains: { rootOption: OptionNode<StructuredOutput>; reasoningChain: ReasoningChain }[];
    /** All options contains ratings from the end */
    allOptions: OptionNode<StructuredOutput>[];
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
