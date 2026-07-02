import z4 from "zod/v4";
import { OptionNode, ThoughtNode, zodOptionSchema, zodRateSchema, zodThoughtNodeSchema } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { LogicReturnType, StrategySchema } from "./strategy";
import { randomUUID } from "node:crypto";

interface BFS_GenerateOptions {
    options: OptionNode[];
}

const zodGenerateOptionsSchema: z4.ZodType<BFS_GenerateOptions> = z4.object({
    options: z4.array(zodOptionSchema).describe("List with generated options")
})

interface BFS_EvaluateTopKOptionsSchema {
    topOptions: OptionNode[];
}

const zodTopKOptions: z4.ZodType<BFS_EvaluateTopKOptionsSchema> = z4.object({
    topOptions: z4.array(zodOptionSchema).describe("List with Top-K options where k is the number")
})

interface BFS_EvaluateTopThoughtsSchema {
    topThoughts: ThoughtNode[];
}

const zodEvaluateTopThoughtsSchema: z4.ZodType<BFS_EvaluateTopThoughtsSchema> = z4.object({
    topThoughts: z4.array(zodThoughtNodeSchema).describe("List with top evaluated thoughts")
})

interface BFS_NewThoughsSchema {
    thoughts: ThoughtNode[]
}

const zodNewThoughtsSchema: z4.ZodType<BFS_NewThoughsSchema> = z4.object({
    thoughts: z4.array(zodThoughtNodeSchema).describe("List with new thoughts")
})

interface BFS_TheBestOption {
    theBestOption: OptionNode[];
}

const zodTheBestOptionSchema: z4.ZodType<BFS_TheBestOption> = z4.object({
    theBestOption: z4.array(zodOptionSchema).describe("The best option selected")
})

interface BFS_RateNodesResponse {
    ratings: { id: string; rate: any }[];
}

const zodRateNodesSchema = z4.object({
    ratings: z4.array(z4.object({
        id: z4.string().describe("Id of node gets the rating"),
        rate: zodRateSchema
    }))
});

export interface BFSConfig {
    /** Cannot be equal or greater than `initialOptionsCount` and `thoughtsCount` */
    topK: number;
    /**
     * Describes when the model can start to evaluate the thoughts
     * If not specified always analyses from edn of first layer
     * Specify to number larger than 1 e.g: 10 to delibaratelly extend the duration
     * IT cannot excess a `maxThoughtsDepth` but can be equal
     */
    evaluateAfterThoughtTreeLevel?: number | undefined;
    /** Whether to continue only for the best options without producing thoughts */
    pruneAtBegining?: boolean;
}

export type ReasoningChain = [ThoughtNode[], ReasoningChain[] | undefined | null]; 

/** Default number of thoughts used to generate prompts */
const DEFAULTS_THOUGHTS_COUNT = 3;

/** DefaulIs the depth of thoughts */
const DEFAULT_THOUGHTS_DEPTH = 10;

export class BFSToT implements StrategySchema {
    static name = "BFS-ToT";
    private ToT: TreeOfThoughts | undefined = undefined;
    private config: BFSConfig;

    constructor(config: BFSConfig) {
        this.config = {
            ...config,
            topK: config.topK ?? 3
        }
    }

    /** Rate nodes individually based on the context - rates all nodes from same layer with one call */
    private async rateNodes(
        context: { rootOption?: OptionNode; path?: (OptionNode | ThoughtNode)[] }, 
        nodes: (OptionNode | ThoughtNode)[],
        rateType: "initial" | "final" | "thought" = "thought"
    ): Promise<void> {
        const systemPrompt = `
# Role & Context
You are a strategic evaluator in a Tree-of-Thoughts (ToT) system.
Your task is to provide objective ratings (score and justification) for a set of candidate nodes.

# Task
Evaluate each candidate node and assign a rate (decision, score, justification).
${rateType === "final" ? "This is a FINAL evaluation based on the complete reasoning chain." : ""}

${context.rootOption && context.path ? "# Context" : ""}
${context.rootOption ? `- Initial Option: ${JSON.stringify(context.rootOption, null, 4)}` : ""}
${context.path ? `- Established Path: ${JSON.stringify(context.path, null, 4)}` : ""}

# Candidates to Rate
${JSON.stringify(nodes, null, 4)}

# Output Requirement
Return the ratings for ALL provided nodes strictly adhering to the schema:
${zodRateNodesSchema.toJSONSchema()}
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodRateNodesSchema, systemPrompt);
        const structured = result.structuredOutput as BFS_RateNodesResponse;

        if (!structured || !Array.isArray(structured.ratings)) {
            const received = JSON.stringify(result.structuredOutput, null, 2);
            throw new Error(`Failed to receive ratings for nodes. Expected array of ratings, but received: ${received}`);
        }

        for (const rating of structured.ratings) {
            const node = nodes.find(n => n.id === rating.id);
            if (node) {
                if (node.type === "option-node") {
                    const opt = node as OptionNode;
                    if (rateType === "initial") opt.initialRate = rating.rate;
                    else opt.finalRate = rating.rate;
                    await this.ToT!.emitEvent("optionEvaluated", opt);
                } else {
                    const thought = node as ThoughtNode;
                    thought.rate = rating.rate;
                    await this.ToT!.emitEvent("thoughtEvaluated", thought);
                }
            }
        }
    }

    /** Get the best thoughts based on the current context and topK limit */
    private async getTheBestOptions(options: OptionNode[]): Promise<OptionNode[]> {
        const genStructuredOutput = async (errorMessage?: string): Promise<OptionNode[]> => {
            const systemPrompt = `
# Role & Context
You are a strategic evaluator within a Tree-of-Thoughts (ToT) reasoning framework. 
The system has generated multiple candidate paths to solve a complex query, and your role is to perform a global pruning step.

# Task
Evaluate the potential of each provided option and select exactly the top-k is: '${this.config.topK}' most promising candidates for further development. 
${errorMessage ? `Note: A previous attempt encountered this error: ${errorMessage}. Please adjust your evaluation accordingly.` : ""}

# Selection Criteria
1. **Feasibility**: How likely is this approach to solve the user's problem?
2. **Breadth**: Does this path provide a distinct and valuable reasoning direction?
3. **Internal Logic**: Is the stated rationale sound and internally consistent?

# Current Candidates
${JSON.stringify(options, null, 4)}

# Output Requirement
Return the selected top-${this.config.topK} options strictly adhering to the following schema:
${zodTopKOptions.toJSONSchema()}
            `
    
    
            const topKOptionsObj = await this.ToT!.callableUnitInvokeStructured("evaluator", zodTopKOptions, systemPrompt);
            const structured = topKOptionsObj.structuredOutput as BFS_EvaluateTopKOptionsSchema;
    
            if (!structured || !Array.isArray(structured.topOptions)) {
                const received = JSON.stringify(topKOptionsObj.structuredOutput, null, 2);
                throw new Error(`Structure message has to be an object with topOptions array. Received: ${received}`);
            } 

            await this.ToT!.emitEvent("optionsPruned", options, structured.topOptions);
            
            return structured.topOptions;
        }

        return await genStructuredOutput();
    }

    /** use to ensure id of node is truelly unique */
    private genUniqueId<T = any>(nodesList: T[]): T[] {
        return (nodesList as any).map((option: any) => {
            option.id = randomUUID();
            return option;
        });
    }
    
    private async generateOptions(): Promise<OptionNode[]> {
        const prompt = `
# Role & Context
You are a strategic reasoning engine operating within a Tree-of-Thoughts (ToT) system uses Breadth-First-Search (BFS). 
Your task is to initiate the search space for a complex problem by generating a set of diverse candidate solutions.

# Objective
Generate exactly ONE distinct, high-quality initial option to solve the user's query. 
This will act as a root node of a reasoning tree. To ensure a diverse search space, this option should explore a specific and unique perspective, methodology, or strategy.

# User Query
${this.ToT!.config.query}

# Requirements
1. **Diversity**: Focus on a single, well-defined approach that differs from common or obvious solutions.
2. **Clarity**: The option must be descriptive enough (in the \`content\` field) to serve as a baseline for deep reasoning.
3. **Structured Format**: Adhere strictly to the requested output schema. Provide a unique ID for this path. 
Note: Do NOT provide ratings (\`rate\` field) at this stage; focus on the ID and the content.
        `
        const promises = Array.from({ length: this.ToT!.config.initialOptionsCount }, () =>
            this.ToT!.callableUnitInvokeStructured("optionGenerator", zodGenerateOptionsSchema, prompt)
        );
        const results = await Promise.all(promises);
        const optionsFlat = results.flatMap(res => (res.structuredOutput as BFS_GenerateOptions).options);

        // Generate Truelly unique id
        const uniqueIdOptions = this.genUniqueId(optionsFlat);

        // Emit events
        for (const option of uniqueIdOptions) {
            await this.ToT!.emitEvent("optionGenerated", option);
        }

        // List with unique options
        return uniqueIdOptions;        
    }
    
    private async generateOptionThoughts(rootOption: OptionNode, path: (OptionNode | ThoughtNode)[], currentDepth: number): Promise<ThoughtNode[]> {
        const node = path[path.length - 1];
        const prompt = `
# Role & Context
You are a strategic reasoning engine operating within a Tree-of-Thoughts (ToT) system using the Breadth-First-Search (BFS) algorithm.
Your role is to expand the reasoning tree by generating new thoughts for a given path.

# Objective
Provide a set of new, logical, and diverse thoughts that extend the following reasoning node.
Each thought should represent a potential next step or a detailed exploration of the path's implications.

# Context
- User Query: ${this.ToT!.config.query}
- Initial Option: ${JSON.stringify(rootOption, null, 4)}
- Established Path: ${JSON.stringify(path, null, 4)}
- Current Depth: ${currentDepth}
- Current Depth Path: ${path[currentDepth]}
- Current node being expanded (for this node you've to generate thoughts): ${JSON.stringify(node, null, 4)}

# Requirements
1. **Consistency**: Ensure thoughts are logically derived from the current node and align with the initial option and established path.
2. **Expansion**: Each thought should add new value or depth (in the \`content\` field) to the reasoning process.
3. **Structure**: Return new thoughts strictly adhering to the schema: ${zodNewThoughtsSchema.toJSONSchema()}. 
Note: Do NOT provide ratings (\`rate\` field) at this stage; focus on the IDs and the content.
        `;

        const promises = Array.from({ length: this.ToT!.config.thoughtsCount ?? DEFAULTS_THOUGHTS_COUNT }, () =>
            this.ToT!.callableUnitInvokeStructured("thoughtGenerator", zodNewThoughtsSchema, prompt)
        );
        const results = await Promise.all(promises);
        const thougthsFlat = results.flatMap(res => (res.structuredOutput as BFS_NewThoughsSchema).thoughts);

        // Generate Truelly unique id
        const uniqueIdThoughts = this.genUniqueId(thougthsFlat);

        await this.ToT!.emitEvent("thoughtsGenerated", node, uniqueIdThoughts);

        // List with unique options
        return uniqueIdThoughts;    
    }

    /** Select the absolute best option based on the full reasoning process */
    private async selectTheBestFinalOption(allReasoningChains: any[]): Promise<OptionNode> {
        const systemPrompt = `
# Role & Context
You are a final judge in a Tree-of-Thoughts (ToT) works with BFS (Breadth-First-Search) reasoning framework.
Multiple reasoning paths (options and their expanded thoughts) have been explored for a given query.
Your task is to review all explored paths and select the single most successful and complete solution.

# Task
Evaluate the provided reasoning chains and select the absolute best initial option that led to the most promising conclusion.
Provide a clear justification for why this specific path was chosen over others in the \`justification\` field of the selected option.

# User Query
${this.ToT!.config.query}

# Reasonings Explored
${JSON.stringify(allReasoningChains, null, 4)}

# Selection Criteria
1. **Completeness**: Which path fully addresses the query?
2. **Accuracy**: Which path maintains the highest logical integrity?
3. **Feasibility**: Which path provides the most actionable or valid solution?

# Output Requirement
Return the best option strictly adhering to the following schema. Ensure the \`justification\` field is populated.
${zodTheBestOptionSchema.toJSONSchema()}
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodTheBestOptionSchema, systemPrompt);
        const structured = result.structuredOutput as BFS_TheBestOption;
        
        if (!structured || !Array.isArray(structured.theBestOption) || structured.theBestOption.length === 0) {
            const received = JSON.stringify(result.structuredOutput, null, 2);
            throw new Error(`Failed to select the best final option. Expected non-empty array 'theBestOption', but received: ${received}`);
        }
        
        const bestOption = structured.theBestOption[0];
        await this.ToT!.emitEvent("finalOptionSelected", bestOption);
        return bestOption;
    }

    /** Get the best thoughts based on the current context and topK limit */
    private async getTheBestThoughts(rootOption: OptionNode, path: (OptionNode | ThoughtNode)[], candidates: ThoughtNode[]): Promise<ThoughtNode[]> {
        const systemPrompt = `
# Role & Context
You are a strategic evaluator within a Tree-of-Thoughts (ToT) reasoning framework using BFS. 
A specific reasoning path has been established, and multiple candidate next-steps (thoughts) have been generated.

# Task
Evaluate the potential of each provided candidate thought and select exactly the top-k is: '${this.config.topK}' most promising candidates for further development. 

# Selection Criteria
1. **Consistency**: Does the thought follow logically from the established path?
2. **Promising Direction**: How likely is this thought to lead to a correct solution?
3. **Clarity & Depth**: Is the inner reasoning sound?

# Initial Option
${JSON.stringify(rootOption, null, 4)}

# Established Path
${JSON.stringify(path, null, 4)}

# New Candidate Thoughts
${JSON.stringify(candidates, null, 4)}

# Output Requirement
Return the selected top-${this.config.topK} thoughts from \`New Candidate Thoughts\` strictly adhering to the following schema:
${zodEvaluateTopThoughtsSchema.toJSONSchema()}
        `;


        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodEvaluateTopThoughtsSchema, systemPrompt);
        const structured = result.structuredOutput as BFS_EvaluateTopThoughtsSchema;

        if (!structured || !Array.isArray(structured.topThoughts)) {
            const received = JSON.stringify(result.structuredOutput, null, 2);
            throw new Error(`Structure message has to be an object with topThoughts array. Received: ${received}`);
        }

        await this.ToT!.emitEvent("thoughtsPruned", rootOption, path, candidates, structured.topThoughts);

        return structured.topThoughts;
    }

    async logic(tot: TreeOfThoughts): Promise<LogicReturnType> {
        // 0.1. Assignes ToT
        this.ToT = tot;

        // 1. Generete Options
        const generatedOptions = await this.generateOptions();
        
        // Rate options separately
        await this.rateNodes({}, generatedOptions, "initial");

        // 2. Prune to get the best Top-K options
        let continueWithOption = generatedOptions;
        if (this.config.pruneAtBegining) {
            continueWithOption = await this.getTheBestOptions(generatedOptions);
        }

        // 3. Parallel expansion for each option up to maxThoughtsDepth constructing ReasoningChain
        const maxDepth = this.ToT.config.maxThoughtsDepth ?? DEFAULT_THOUGHTS_DEPTH;

        const expandBranch = async (rootOption: OptionNode, path: (OptionNode | ThoughtNode)[], currentDepth: number): Promise<ReasoningChain> => {
            const thoughts = await this.generateOptionThoughts(rootOption, path, currentDepth);
            
            // Rate all thoughts from this level together
            if (thoughts.length > 0) {
                await this.rateNodes({ rootOption, path }, thoughts, "thought");
            }

            // Global pruning for this specific branch to maintain topK
            const topKThoughts = await this.getTheBestThoughts(rootOption, path, thoughts);

            let nextLevelChains: ReasoningChain[] | null = null;
            if (currentDepth + 1 < maxDepth && topKThoughts.length > 0) {
                nextLevelChains = await Promise.all(
                    topKThoughts.map(thought => expandBranch(rootOption, [...path, thought], currentDepth + 1))
                );
            }

            return [topKThoughts, nextLevelChains];
        };
        
        const reasoningChains = await Promise.all(continueWithOption.map(async (option) => {
            const chain = await expandBranch(option, [option], 0);

            return {
                rootOption: option,
                reasoningChain: chain
            };
        }));

        // 4. Final scoring based on full reasoning chains
        await Promise.all(reasoningChains.map(async (chain) => {
            await this.rateNodes(
                { rootOption: chain.rootOption, path: this.flattenChain(chain.reasoningChain) },
                [chain.rootOption],
                "final"
            );
        }));

        // 5. Push all options and reasoning to find the best one
        const bestOption = await this.selectTheBestFinalOption(reasoningChains);
        
        return {
            theBestOption: bestOption,
            reasoningChains: reasoningChains,
            allOptions: generatedOptions
        };
    }

    /** Flatten recursive ReasoningChain into a simple path of nodes */
    private flattenChain(chain: ReasoningChain): (OptionNode | ThoughtNode)[] {
        const [thoughts, next] = chain;
        const result: (OptionNode | ThoughtNode)[] = [...thoughts];
        if (next && next.length > 0) {
            // Take the first branch for simplicity in evaluation context
            result.push(...this.flattenChain(next[0]));
        }
        return result;
    }
}