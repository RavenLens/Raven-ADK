import { OptionNode, ThoughtNode } from "../nodes";
import { TreeOfThoughts } from "../ToT";

export type ReasoningChain = [ThoughtNode[], ReasoningChain[] | undefined | null];

export interface LogicReturnType {
    theBestOption: OptionNode;
    reasoningChains: { rootOption: OptionNode; reasoningChain: ReasoningChain }[];
    /** All options contains ratings from the end */
    allOptions: OptionNode[];
}

export interface StrategySchema {
    logic(totClass: TreeOfThoughts): Promise<LogicReturnType>;
}