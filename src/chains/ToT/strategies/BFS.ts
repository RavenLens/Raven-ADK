import z4 from "zod/v4";
import { OptionNode, ThoughtNode, zodRateSchema, zodThoughtNodeSchema } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { createGenerateOptionsSchema, createTheBestOptionSchema, createTopKOptionsSchema, LogicReturnType, OpenTelemetryTreeOfThoughts, ReasoningChain, StrategySchema } from "./strategy";
import { randomUUID } from "node:crypto";

interface BFS_GenerateOptions {
    options: OptionNode[];
}

interface BFS_EvaluateTopThoughtsSchema {
    topThoughts: ThoughtNode[];
}

const zodEvaluateTopThoughtsSchema: z4.ZodType<BFS_EvaluateTopThoughtsSchema> = z4.object({
    topThoughts: z4.array(zodThoughtNodeSchema).describe("List with top evaluated thoughts")
})

interface BFS_NewThoughtsSchema {
    thoughts: ThoughtNode[]
}

const zodNewThoughtsSchema: z4.ZodType<BFS_NewThoughtsSchema> = z4.object({
    thoughts: z4.array(zodThoughtNodeSchema).describe("List with new thoughts")
})

interface BFS_TheBestOption {
    theBestOption: OptionNode[];
}

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
    /** Number of candidates to kept at each level */
    topK: number;
}

/**
 * Structured-output notation: option generation, pruning, and final selection
 * include the schema supplied to TreeOfThoughts.invokeStructuredOutput.
 */
export class BFSToT implements StrategySchema {
    name = "BFS-ToT";
    telemetry?: OpenTelemetryTreeOfThoughts;
    private ToT: TreeOfThoughts | undefined = undefined;
    private config: BFSConfig;

    constructor(config: BFSConfig) {
        this.config = {
            ...config,
            topK: config.topK ?? 3
        }
    }

    private async rateNodes(nodes: (OptionNode | ThoughtNode)[]): Promise<void> {
        if (nodes.length === 0) return;

        const systemPrompt = `
# Role & Context
You are a strategic evaluator in a Tree-of-Thoughts (ToT) system using Breadth-First-Search (BFS).
Your task is to provide objective ratings (score and justification) for a set of candidate nodes at the current level.

# Task
Evaluate each candidate node and assign a rate (decision, score, justification).

# Candidates to Rate
${JSON.stringify(nodes, null, 4)}

# Output Requirement
Return the ratings for ALL provided nodes strictly adhering to the schema:
${zodRateNodesSchema.toJSONSchema()}
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodRateNodesSchema, systemPrompt);
        const structured = result.structuredOutput as BFS_RateNodesResponse;

        this.telemetry?.recordStep("rate_nodes", { count: nodes.length });

        for (const rating of structured.ratings) {
            const node = nodes.find(n => n.id === rating.id);
            if (node) {
                if (node.type === "option-node") {
                    (node as OptionNode).initialRate = rating.rate;
                    await this.ToT!.emitEvent("optionEvaluated", node as OptionNode);
                } else {
                    (node as ThoughtNode).rate = rating.rate;
                    await this.ToT!.emitEvent("thoughtEvaluated", node as ThoughtNode);
                }
            }
        }
    }

    private async getGlobalTopK<T extends OptionNode | ThoughtNode>(candidates: T[], limit: number): Promise<T[]> {
        if (candidates.length <= limit) return candidates;

        const systemPrompt = `
# Role & Context
You are a strategic evaluator performing global pruning in a ToT BFS search.
You have a set of candidates from the current level. You must select exactly the top-${limit} most promising ones.

# Candidates
${JSON.stringify(candidates, null, 4)}

# Output Requirement
Return the selected top-${limit} candidates.
        `;

        const schema = candidates[0].type === "option-node"
            ? createTopKOptionsSchema(this.ToT!.getOptionNodeSchema())
            : zodEvaluateTopThoughtsSchema;
        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", schema, systemPrompt);
        const structured = result.structuredOutput as any;
        const selected = (structured.topOptions || structured.topThoughts) as T[];

        this.telemetry?.recordPruning(candidates[0].type === "option-node" ? "options" : "thoughts", candidates.length, selected.length);

        return selected;
    }

    private async expand(node: OptionNode | ThoughtNode, depth: number): Promise<ThoughtNode[]> {
        const prompt = `
# Role & Context
You are a reasoning engine in a ToT BFS.
Expand the following node by generating potential next steps.

# Current Node
${JSON.stringify(node, null, 4)}

# Task
Generate thoughts that continue this reasoning path.
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("thoughtGenerator", zodNewThoughtsSchema, prompt);
        const thoughts = (result.structuredOutput as BFS_NewThoughtsSchema).thoughts;
        
        this.telemetry?.recordStep("expand", { parentNodeId: node.id, count: thoughts.length });

        thoughts.forEach(t => {
            t.id = randomUUID();
            delete t.rate;
        });

        await this.ToT!.emitEvent("thoughtsGenerated", node, thoughts);
        return thoughts;
    }

    async logic(tot: TreeOfThoughts): Promise<LogicReturnType> {
        this.ToT = tot;
        const maxDepth = tot.config.maxThoughtsDepth ?? 5;

        // 1. Level 0: Initial Options
        const initialOptionsPrompt = `Generate ${tot.config.initialOptionsCount} initial options for: ${tot.config.query}`;
        const optResult = await tot.callableUnitInvokeStructured(
            "optionGenerator",
            createGenerateOptionsSchema(tot.getOptionNodeSchema()),
            initialOptionsPrompt
        );
        const options = (optResult.structuredOutput as BFS_GenerateOptions).options;
        options.forEach(o => {
            o.id = randomUUID();
            delete o.initialRate;
            delete o.finalRate;
        });

        for (const opt of options) await tot.emitEvent("optionGenerated", opt);

        // Rate and Prune Level 0
        await this.rateNodes(options);

        // Check for Early Exit on Level 0
        if (tot.config.earlyExitThreshold !== undefined) {
            const bestInitial = options.find(o => (o.initialRate?.score ?? 0) >= tot.config.earlyExitThreshold!);
            if (bestInitial) {
                return {
                    theBestOption: bestInitial,
                    reasoningChains: [{ rootOption: bestInitial, reasoningChain: [[], null] }],
                    allOptions: options
                };
            }
        }

        const survivingOptions = await this.getGlobalTopK(options, this.config.topK);
        await tot.emitEvent("optionsPruned", options, survivingOptions);

        // 2. Iterative BFS Levels
        let currentPaths: { root: OptionNode; path: (OptionNode | ThoughtNode)[] }[] = survivingOptions.map(o => ({ root: o, path: [o] }));

        for (let d = 0; d < maxDepth; d++) {
            this.telemetry?.recordIteration(d, { activePaths: currentPaths.length });
            const levelCandidates: { parentPath: { root: OptionNode; path: (OptionNode | ThoughtNode)[] }; thoughts: ThoughtNode[] }[] = [];
            
            await Promise.all(currentPaths.map(async (pathObj) => {
                const node = pathObj.path[pathObj.path.length - 1];
                const thoughts = await this.expand(node, d);
                if (thoughts.length > 0) {
                    levelCandidates.push({ parentPath: pathObj, thoughts });
                }
            }));

            if (levelCandidates.length === 0) break;

            const allThoughts = levelCandidates.flatMap(c => c.thoughts);
            await this.rateNodes(allThoughts);

            // Check for Early Exit
            if (tot.config.earlyExitThreshold !== undefined) {
                const bestThought = allThoughts.find(t => (t.rate?.score ?? 0) >= tot.config.earlyExitThreshold!);
                if (bestThought) {
                    const parent = levelCandidates.find(c => c.thoughts.some(t => t.id === bestThought.id))!;
                    const finalPath = [...parent.parentPath.path, bestThought];
                    
                    const chain = {
                        rootOption: parent.parentPath.root,
                        reasoningChain: this.buildReasoningChain(parent.parentPath.root, [finalPath])
                    };

                    await this.ToT!.emitEvent("finalOptionSelected", parent.parentPath.root);

                    return {
                        theBestOption: parent.parentPath.root,
                        reasoningChains: [chain],
                        allOptions: options
                    };
                }
            }

            // Global Pruning
            const topThoughts = await this.getGlobalTopK(allThoughts, this.config.topK);
            
            // Reconstruct paths for next level
            const nextPaths: { root: OptionNode; path: (OptionNode | ThoughtNode)[] }[] = [];
            for (const tt of topThoughts) {
                const parent = levelCandidates.find(c => c.thoughts.some(t => t.id === tt.id))!;
                nextPaths.push({
                    root: parent.parentPath.root,
                    path: [...parent.parentPath.path, tt]
                });
                
                // Link graph
                const lastNode = parent.parentPath.path[parent.parentPath.path.length - 1];
                if (lastNode.type === "though-node") {
                    (lastNode as ThoughtNode).dependingThoughNodes = (lastNode as ThoughtNode).dependingThoughNodes || [];
                    (lastNode as ThoughtNode).dependingThoughNodes.push(tt);
                }
            }

            // Group events
            for (const c of levelCandidates) {
                const selectedForParent = topThoughts.filter(tt => c.thoughts.some(ct => ct.id === tt.id));
                await tot.emitEvent("thoughtsPruned", c.parentPath.root, c.parentPath.path, c.thoughts, selectedForParent);
            }

            currentPaths = nextPaths;
        }

        // 3. Final selection
        const reasoningChains = survivingOptions.map(root => {
            const rootPaths = currentPaths.filter(p => p.root.id === root.id).map(p => p.path);
            return {
                rootOption: root,
                reasoningChain: this.buildReasoningChain(root, rootPaths)
            };
        });

        const bestOption = await this.selectFinalBest(reasoningChains);

        return {
            theBestOption: bestOption,
            reasoningChains,
            allOptions: options
        };
    }

    private buildReasoningChain(root: OptionNode, paths: (OptionNode | ThoughtNode)[][]): ReasoningChain {
        const buildRecursive = (currentPath: (OptionNode | ThoughtNode)[], depth: number): ReasoningChain => {
            const nextThoughts = Array.from(new Map(
                paths.filter(p => p.length > depth + 1 && p.slice(0, depth + 1).every((n, i) => n.id === currentPath[i].id))
                     .map(p => [p[depth + 1].id, p[depth + 1] as ThoughtNode])
            ).values());

            return [nextThoughts, nextThoughts.length > 0 ? nextThoughts.map(t => buildRecursive([...currentPath, t], depth + 1)) : null];
        };
        return buildRecursive([root], 0);
    }

    private async selectFinalBest(chains: any[]): Promise<OptionNode> {
        const systemPrompt = `Select the best final option from these reasoning chains: ${JSON.stringify(chains, null, 4)}`;
        const result = await this.ToT!.callableUnitInvokeStructured(
            "evaluator",
            createTheBestOptionSchema(this.ToT!.getOptionNodeSchema()),
            systemPrompt
        );
        this.telemetry?.recordStep("select_final_option");
        const best = (result.structuredOutput as BFS_TheBestOption).theBestOption[0];
        await this.ToT!.emitEvent("finalOptionSelected", best);
        return best;
    }
}
