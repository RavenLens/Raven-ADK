import { TreeOfThoughts } from "../ToT";
import { StrategySchema } from "./strategy";

export class DFSToT implements StrategySchema {
    static name = "DFS-ToT";
    /** Is the floating point number. Determines backpropagation moment */
    treshold: number;

    private isFloat(n: number){
        return Number(n) === n && n % 1 !== 0;
    }
    
    constructor(treshold: number = 0.7) {
        if (!this.isFloat(treshold)) {
            throw new Error("Treshold has to be floating point number");
        }

        this.treshold = treshold;
    }

    async logic(tot: TreeOfThoughts) {
        
    }
}
