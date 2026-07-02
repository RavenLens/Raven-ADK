import { OptionNode } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { StrategySchema } from "./strategy";

export class BFSToT implements StrategySchema {
    static name = "BFS-ToT";
    /** Cannot be equal or greater than `initialOptionsCount` and `thoughtsCount` */
    tokK: number;
    /**
     * Describes when the model can start to evaluate the thoughts
     * If not specified always analyses from edn of first layer
     * Specify to number larger than 1 e.g: 10 to delibaratelly extend the duration
     * IT cannot excess a `maxThoughtsDepth` but can be equal
     */
    evaluateAfterThoughtTreeLevel?: number | undefined;
    private ToT: TreeOfThoughts | undefined = undefined;

    constructor(topK: number = 3, evaluateAfterThoughtTreeLevel?: number | undefined) {
        this.tokK = topK;
        this.evaluateAfterThoughtTreeLevel = evaluateAfterThoughtTreeLevel;
    }

    async getTheBestOptions(options: OptionNode[]) {
        const genStructuredOutput = async (errorMessage?: string) => {
            const systemPrompt = `
Instruction: Get the best ${this.tokK} options out of the current options are specified below. 
Return Format: Return these options ids list base on id field
${errorMessage ? `On prior iteration has happen error: ${errorMessage}` : ""}

TODO: Add ZodSchema of OptionNode

Current Options:
${JSON.stringify(options, null, 4)}
            `
    
    
            const topKOptionsObj = await this.ToT!.config.evaluator(systemPrompt);
    
            if (!topKOptionsObj.structuredOutput) {
                throw new Error("Structure message has to be generated");
            }
            else if (typeof topKOptionsObj.structuredOutput !== "object") {
                throw new Error("Structure message has to be object");
            }

        }
        

    }

    async logic(tot: TreeOfThoughts) {
        // 0.1. Assignes ToT
        this.ToT = tot;

        // 1. Generete Options
        const generatedOptions = await tot.generateOptions();

        // 2. Prune to get the best Top-K options
        const topKOptions = this.getTheBestOptions(generatedOptions)

        // 3. Generate thoughts for option & get Top-K & (evaluate for **for best option selection** instanly if `evaluateAfterThoughtTreeLevel` is undefined |OR| `evaluateAfterThoughtTreeLevel` evaluate when reach its level) & if not selected continue till `maxThoughtsDepth` to make the choose
        for (const option of topKOptions) {

        }
    }
}