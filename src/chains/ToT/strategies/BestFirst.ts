
import z4 from "zod/v4";
import { OptionNode, ThoughtNode, zodOptionSchema, zodRateSchema, zodThoughtNodeSchema } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { LogicReturnType, ReasoningChain, StrategySchema } from "./strategy";
import { randomUUID } from "node:crypto";

interface BestFirst_GenerateOptions {
    options: OptionNode[];
}

const zodGenerateOptionsSchema: z4.ZodType<BestFirst_GenerateOptions> = z4.object({
    options: z4.array(zodOptionSchema).describe("List with generated options")
})

interface BestFirst_NewThoughtsSchema {
    thoughts: ThoughtNode[]
}

const zodNewThoughtsSchema: z4.ZodType<BestFirst_NewThoughtsSchema> = z4.object({
    thoughts: z4.array(zodThoughtNodeSchema).describe("List with new thoughts")
})

interface BestFirst_TheBestOption {
    theBestOption: OptionNode[];
}

const zodTheBestOptionSchema: z4.ZodType<BestFirst_TheBestOption> = z4.object({
    theBestOption: z4.array(zodOptionSchema).describe("The best option selected")
})

interface BestFirst_RateNodesResponse {
    ratings: { id: string; rate: any }[];
}

const zodRateNodesSchema = z4.object({
    ratings: z4.array(z4.object({
        id: z4.string().describe("Id of node gets the rating"),
        rate: zodRateSchema
    }))
});

export interface BestFirstConfig {
    /** The threshold score to accept a thought (e.g. 0.5) */
    acceptanceTreshold: number;
}

interface FrontierNode {
    root: OptionNode;
    node: OptionNode | ThoughtNode;
    path: (OptionNode | ThoughtNode)[];
    score: number;
}

export class BestFirstToT implements StrategySchema {
    static name = "BestFirst-ToT";
    private ToT: TreeOfThoughts | undefined = undefined;
    private config: BestFirstConfig;

    constructor(config: BestFirstConfig) {
        this.config = config;
    }

    private async rateNodes(nodes: (OptionNode | ThoughtNode)[]): Promise<void> {
        if (nodes.length === 0) return;

        const systemPrompt = `
# Role & Context
You are a strategic evaluator in a Tree-of-Thoughts (ToT) system using Best-First-Search.
Your task is to provide objective ratings (score and justification) for a set of candidate nodes.

# Task
Evaluate each candidate node and assign a rate (decision, score, justification).

# Candidates to Rate
${JSON.stringify(nodes, null, 4)}

# Output Requirement
Return the ratings for ALL provided nodes strictly adhering to the schema:
${zodRateNodesSchema.toJSONSchema()}
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodRateNodesSchema, systemPrompt);
        const structured = result.structuredOutput as BestFirst_RateNodesResponse;

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

    private async expand(node: OptionNode | ThoughtNode): Promise<ThoughtNode[]> {
        const prompt = `
# Role & Context
You are a reasoning engine in a ToT Best-First-Search.
Expand the following node by generating potential next steps.
Provide ${this.ToT!.config.thoughtsCount ?? 3} thoughts.

# Current Node
${JSON.stringify(node, null, 4)}

# Task
Generate thoughts that continue this reasoning path.
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("thoughtGenerator", zodNewThoughtsSchema, prompt);
        const thoughts = (result.structuredOutput as BestFirst_NewThoughtsSchema).thoughts;
        
        thoughts.forEach(t => {
            t.id = randomUUID();
            delete t.rate;
        });

        await this.ToT!.emitEvent("thoughtsGenerated", node, thoughts);
        return thoughts;
    }

    async logic(totClass: TreeOfThoughts): Promise<LogicReturnType> {
        this.ToT = totClass;
        const maxDepth = totClass.config.maxThoughtsDepth ?? 5;
        const earlyExitThreshold = totClass.config.earlyExitThreshold;

        // 1. Initial Generation
        const initialOptionsPrompt = `Generate ${totClass.config.initialOptionsCount} initial options for: ${totClass.config.query}`;
        const optResult = await totClass.callableUnitInvokeStructured("optionGenerator", zodGenerateOptionsSchema, initialOptionsPrompt);
        const options = (optResult.structuredOutput as BestFirst_GenerateOptions).options;
        options.forEach(o => {
            o.id = randomUUID();
            delete o.initialRate;
            delete o.finalRate;
        });

        for (const opt of options) await totClass.emitEvent("optionGenerated", opt);

        // 2. Initial Rating
        await this.rateNodes(options);

        // 3. Frontier Initialization
        let frontier: FrontierNode[] = options.map(o => ({
            root: o,
            node: o,
            path: [o],
            score: o.initialRate?.score ?? 0
        }));

        const finishedPaths: { root: OptionNode; path: (OptionNode | ThoughtNode)[] }[] = [];

        // 4. Best-First Loop
        while (frontier.length > 0) {
            // Priority Queue simulation: Sort by score descending
            frontier.sort((a, b) => b.score - a.score);
            const best = frontier.shift()!;

            // Early Exit Check
            if (earlyExitThreshold !== undefined && best.score >= earlyExitThreshold) {
                await totClass.emitEvent("finalOptionSelected", best.root);
                return {
                    theBestOption: best.root,
                    reasoningChains: [{ 
                        rootOption: best.root, 
                        reasoningChain: this.buildReasoningChain(best.root, [best.path]) 
                    }],
                    allOptions: options
                };
            }

            // Depth Check
            if (best.path.length < maxDepth) {
                const thoughts = await this.expand(best.node);
                if (thoughts.length > 0) {
                    await this.rateNodes(thoughts);

                    for (const t of thoughts) {
                        const score = t.rate?.score ?? 0;
                        if (score >= this.config.acceptanceTreshold) {
                            const newPath = [...best.path, t];
                            frontier.push({
                                root: best.root,
                                node: t,
                                path: newPath,
                                score: score
                            });

                            // Link graph for tree traversal
                            const lastNode = best.path[best.path.length - 1];
                            if (lastNode.type === "though-node") {
                                (lastNode as ThoughtNode).dependingThoughNodes = (lastNode as ThoughtNode).dependingThoughNodes || [];
                                (lastNode as ThoughtNode).dependingThoughNodes.push(t);
                            }
                        }
                    }
                } else {
                     // Leaf node reached
                     finishedPaths.push({ root: best.root, path: best.path });
                }
            } else {
                // Max depth reached
                finishedPaths.push({ root: best.root, path: best.path });
            }
        }

        // 5. Finalization
        const uniqueRoots = Array.from(new Set(finishedPaths.length > 0 ? finishedPaths.map(p => p.root) : options));
        const reasoningChains = uniqueRoots.map(root => {
            const rootPaths = finishedPaths.filter(p => p.root.id === root.id).map(p => p.path);
            return {
                rootOption: root,
                reasoningChain: this.buildReasoningChain(root, rootPaths.length > 0 ? rootPaths : [[root]])
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
        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodTheBestOptionSchema, systemPrompt);
        const best = (result.structuredOutput as BestFirst_TheBestOption).theBestOption[0];
        await this.ToT!.emitEvent("finalOptionSelected", best);
        return best;
    }
}
