import { OptionNode } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { ReasoningChain } from "./BFS";

export interface LogicReturnType {
    theBestOption: OptionNode;
    reasoningChains: { rootOption: OptionNode; reasoningChain: ReasoningChain }[];
    /** All options contains ratings from the end */
    allOptions: OptionNode[];
}

export interface StrategySchema {
    logic(totClass: TreeOfThoughts): Promise<LogicReturnType>;
}