import { TreeOfThoughts } from "../ToT";

export interface StrategySchema {
    logic(totClass: TreeOfThoughts): Promise<any>;
}