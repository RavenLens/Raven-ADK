import z4 from "zod/v4";
import { randomUUID } from "node:crypto";
import { OptionNode, ThoughtNode, zodRateSchema, zodThoughtNodeSchema } from "../nodes";
import { DEFAULT_THOUGHTS_DEPTH, TreeOfThoughts } from "../ToT";
import { createGenerateOptionsSchema, LogicReturnType, ReasoningChain, StrategySchema } from "./strategy";

interface MCTS_GenerateOptions {
    options: OptionNode[];
}

interface MCTS_NewThoughtsSchema {
    thoughts: ThoughtNode[];
}

const zodNewThoughtsSchema = z4.object({
    thoughts: z4.array(zodThoughtNodeSchema).describe("List of new reasoning steps/thoughts")
});

interface MCTS_RateNodesResponse {
    ratings: { id: string; rate: any }[];
}

const zodRateNodesSchema = z4.object({
    ratings: z4.array(z4.object({
        id: z4.string().describe("Id of the node being rated"),
        rate: zodRateSchema
    }))
});

export interface MCTSConfig {
    /** Number of simulations (Selection -> Expansion -> Simulation -> Backpropagation) */
    iterations?: number;
    /** Exploration constant (C) for UCT. Default is sqrt(2) */
    explorationConstant?: number;
    /** Optional penalty for depth to encourage shorter paths
     * @default 0.01
    */
    depthPenalty?: number;
}

interface NodeStats {
    visits: number;
    value: number;
    node: OptionNode | ThoughtNode;
}

/**
 * Structured-output notation: candidate options are generated with and
 * returned with the schema supplied to TreeOfThoughts.invokeStructuredOutput.
 */
export class MCTSToT implements StrategySchema {
    static name = "MCTS-ToT";
    private ToT!: TreeOfThoughts;
    private config: Required<MCTSConfig>;
    
    private stats = new Map<string, NodeStats>();
    private childrenMap = new Map<string, string[]>(); // parentId -> childIds
    private nodeMap = new Map<string, OptionNode | ThoughtNode>();

    constructor(config: MCTSConfig = {}) {
        this.config = {
            iterations: config.iterations ?? 30,
            explorationConstant: config.explorationConstant ?? 1.414,
            depthPenalty: config.depthPenalty ?? 0.01
        };
    }

    /** Calculate the `Upper Control Bound for Trees` to balance exploration (nodes with fewer visits) and exploitation (high average scores from evaluator) */
    private calculateUCT(nodeId: string, parentVisits: number): number {
        const stat = this.stats.get(nodeId);
        if (!stat || stat.visits === 0) return Infinity;

        const exploitation = stat.value / stat.visits;
        const exploration = this.config.explorationConstant * Math.sqrt(Math.log(parentVisits) / stat.visits);
        
        return exploitation + exploration;
    }

    /** Rates each node in separate calls */
    private async rateNode(node: OptionNode | ThoughtNode): Promise<number> {
        const systemPrompt = `
# Role & Context
You are a strategic evaluator in a Tree-of-Thoughts (ToT) system using MCTS (Monte Carlo Tree Search).
Rate the quality and potential of the following reasoning step.

# Node to Rate
${JSON.stringify(node, null, 4)}

# Output Requirement
Provide a rating strictly adhering to the schema:
${zodRateNodesSchema.toJSONSchema()}
        `;

        const result = await this.ToT.callableUnitInvokeStructured("evaluator", zodRateNodesSchema, systemPrompt);
        const structured = result.structuredOutput as MCTS_RateNodesResponse;
        const rating = structured.ratings.find(r => r.id === node.id);
        
        const score = rating?.rate?.score ?? 0;
        
        if (node.type === "option-node") {
            node.initialRate = rating?.rate;
            await this.ToT.emitEvent("optionEvaluated", node);
        } else {
            node.rate = rating?.rate;
            await this.ToT.emitEvent("thoughtEvaluated", node);
        }

        return score;
    }

    /** Generates new thoughts for specified node */
    private async expand(node: OptionNode | ThoughtNode): Promise<ThoughtNode[]> {
        const prompt = `
# Role & Context
You are a reasoning engine in a ToT MCTS simulation. 
Generate the next logical steps for the following reasoning path.

# Current Node
${JSON.stringify(node, null, 4)}

# Task
Generate ${this.ToT.config.thoughtsCount || 3} thoughts that continue this path.
        `;

        const result = await this.ToT.callableUnitInvokeStructured("thoughtGenerator", zodNewThoughtsSchema, prompt);
        const thoughts = (result.structuredOutput as MCTS_NewThoughtsSchema).thoughts;
        
        thoughts.forEach(t => {
            t.id = randomUUID();
            this.nodeMap.set(t.id, t);
        });

        await this.ToT.emitEvent("thoughtsGenerated", node as any, thoughts);
        return thoughts;
    }

    private backpropagate(path: string[], score: number, depth: number = 0) {
        // Apply depth penalty to the value being backpropagated
        const penalizedScore = Math.max(0, score - (depth * this.config.depthPenalty));
        
        for (const id of path) {
            const stat = this.stats.get(id);
            if (stat) {
                stat.visits += 1;
                stat.value += penalizedScore;
            }
        }
    }

    public async logic(tot: TreeOfThoughts): Promise<LogicReturnType> {
        this.ToT = tot;
        const rootId = "root_query";
        this.stats.set(rootId, { visits: 0, value: 0, node: { id: rootId } as any });

        // 1. Initial Options Generation
        const initialPrompt = `Generate ${tot.config.initialOptionsCount} candidate solutions for: ${tot.config.query}`;
        const optResult = await tot.callableUnitInvokeStructured(
            "optionGenerator",
            createGenerateOptionsSchema(tot.getOptionNodeSchema()),
            initialPrompt
        );
        const options = (optResult.structuredOutput as MCTS_GenerateOptions).options;
        
        options.forEach(o => {
            o.id = randomUUID();
            o.type = "option-node";
            this.nodeMap.set(o.id, o);
            this.stats.set(o.id, { visits: 0, value: 0, node: o });
        });
        this.childrenMap.set(rootId, options.map(o => o.id));

        for (const opt of options) {
            await tot.emitEvent("optionGenerated", opt);
            // Initial rating for children of root
            const score = await this.rateNode(opt);
            this.backpropagate([rootId, opt.id], score, 1);
        }

        // 2. MCTS Iterations
        for (let i = 0; i < this.config.iterations; i++) {
            // Selection
            let path = [rootId];
            let currentId = rootId;
            let depth = 0;

            while (this.childrenMap.has(currentId) && this.childrenMap.get(currentId)!.length > 0) {
                const children = this.childrenMap.get(currentId)!;
                const parentVisits = this.stats.get(currentId)!.visits;
                
                currentId = children.reduce((best, child) => 
                    this.calculateUCT(child, parentVisits) > this.calculateUCT(best, parentVisits) ? child : best
                );
                path.push(currentId);
                depth++;
            }

            // Expansion
            const currentNode = this.nodeMap.get(currentId)!;
            if (depth < (tot.config.maxThoughtsDepth ?? DEFAULT_THOUGHTS_DEPTH)) {
                const newThoughts = await this.expand(currentNode);
                if (newThoughts.length > 0) {
                    this.childrenMap.set(currentId, newThoughts.map(t => t.id));
                    
                    // Evaluate new thought nodes and backpropagate from the highest performing one
                    const rolloutthoughtScores = await Promise.all(newThoughts.map(async t => {
                        this.stats.set(t.id, { visits: 0, value: 0, node: t });
                        const scoreThought = await this.rateNode(t);
                        return scoreThought;
                    }));

                    const bestRolloutScoreThought = Math.max(...rolloutthoughtScores);
                    this.backpropagate(path, bestRolloutScoreThought, depth + 1);
                } else {
                    // Terminal or no thoughts
                    const score = currentNode.type === "option-node" ? (currentNode.initialRate?.score || 0) : (currentNode.rate?.score || 0);
                    this.backpropagate(path, score, depth);
                }
            } else {
                // Max depth
                const score = currentNode.type === "option-node" ? (currentNode.initialRate?.score || 0) : (currentNode.rate?.score || 0);
                this.backpropagate(path, score, depth);
            }
        }

        // 3. Finalization
        // Select child of root (option) with highest visits (robustness indicator in MCTS)
        const rootChildren = this.childrenMap.get(rootId)!;
        const bestOptionId = rootChildren.reduce((best, child) => 
            (this.stats.get(child)!.visits > this.stats.get(best)!.visits) ? child : best
        );
        const theBestOption = this.nodeMap.get(bestOptionId) as OptionNode;

        return {
            theBestOption,
            reasoningChains: options.map(opt => ({
                rootOption: opt,
                reasoningChain: this.buildChain(opt.id)
            })),
            allOptions: options
        };
    }

    private buildChain(nodeId: string): ReasoningChain {
        const childrenIds = this.childrenMap.get(nodeId) || [];
        const thoughts = childrenIds.map(id => this.nodeMap.get(id) as ThoughtNode);
        
        if (thoughts.length === 0) return [[], null];

        return [
            thoughts,
            thoughts.map(t => this.buildChain(t.id))
        ];
    }
}

