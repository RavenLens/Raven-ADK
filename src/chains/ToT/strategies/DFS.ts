import z4 from "zod/v4";
import { OptionNode, ThoughtNode, zodRateSchema, zodThoughtNodeSchema } from "../nodes";
import { TreeOfThoughts } from "../ToT";
import { createGenerateOptionsSchema, createTheBestOptionSchema, LogicReturnType, ReasoningChain, StrategySchema } from "./strategy";
import { randomUUID } from "node:crypto";

interface DFS_GenerateOptions {
    options: OptionNode[];
}

interface DFS_NewThoughtsSchema {
    thoughts: ThoughtNode[]
}

const zodNewThoughtsSchema: z4.ZodType<DFS_NewThoughtsSchema> = z4.object({
    thoughts: z4.array(zodThoughtNodeSchema).describe("List with new thoughts")
})

interface DFS_TheBestOption {
    theBestOption: OptionNode[];
}

interface DFS_RateNodesResponse {
    ratings: { id: string; rate: any }[];
}

const zodRateNodesSchema = z4.object({
    ratings: z4.array(z4.object({
        id: z4.string().describe("Id of node gets the rating"),
        rate: zodRateSchema
    }))
});

/**
 * Structured-output notation: every generated root option carries a value
 * validated against the schema supplied to TreeOfThoughts.invokeStructuredOutput.
 */
export class DFSToT implements StrategySchema {
    static name = "DFS-ToT";
    /** Is the floating point number. Determines backpropagation moment */
    treshold: number;
    private ToT: TreeOfThoughts | undefined = undefined;

    private isFloat(n: number) {
        return Number(n) === n && n % 1 !== 0;
    }

    constructor(treshold: number = 0.7) {
        if (!this.isFloat(treshold)) {
            // Allow 0.0 or 1.0 represented as floats or small decimals
            if (typeof treshold !== 'number') throw new Error("Treshold has to be a number");
        }

        this.treshold = treshold;
    }

    private async rateNodes(nodes: (OptionNode | ThoughtNode)[]): Promise<void> {
        if (nodes.length === 0) return;

        const systemPrompt = `
# Role & Context
You are a strategic evaluator in a Tree-of-Thoughts (ToT) system using Depth-First-Search (DFS).
Evaluate the following nodes based on their contribution to the solution.

# Candidates to Rate
${JSON.stringify(nodes, null, 4)}

# Output Requirement
Return the ratings adhering to the schema:
${zodRateNodesSchema.toJSONSchema()}
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodRateNodesSchema, systemPrompt);
        const structured = result.structuredOutput as DFS_RateNodesResponse;

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
You are a reasoning engine in a ToT DFS.
Expand the following node deep into the problem space.

# Current Node
${JSON.stringify(node, null, 4)}

# Task
Generate ${this.ToT!.config.thoughtsCount} thoughts that continue this specific path.
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("thoughtGenerator", zodNewThoughtsSchema, prompt);
        const thoughts = (result.structuredOutput as DFS_NewThoughtsSchema).thoughts;

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
        const allSuccessfulPaths: (OptionNode | ThoughtNode)[][] = [];

        // 1. Initial Options
        const initialPrompt = `Generate ${tot.config.initialOptionsCount} initial options for: ${tot.config.query}`;
        const optResult = await tot.callableUnitInvokeStructured(
            "optionGenerator",
            createGenerateOptionsSchema(tot.getOptionNodeSchema()),
            initialPrompt
        );
        const options = (optResult.structuredOutput as DFS_GenerateOptions).options;
        options.forEach(o => o.id = randomUUID());

        for (const opt of options) await tot.emitEvent("optionGenerated", opt);
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

        // 2. DFS Exploration
        let earlyExitFound = false;

        const explore = async (path: (OptionNode | ThoughtNode)[], depth: number) => {
            if (earlyExitFound) return;
            const lastNode = path[path.length - 1];
            
            // Check threshold for current node (Option or Thought)
            const currentScore = (lastNode.type === "option-node") 
                ? (lastNode as OptionNode).initialRate?.score 
                : (lastNode as ThoughtNode).rate?.score;

            if (currentScore !== undefined && currentScore < this.treshold) {
                // Backtrack trigger
                await this.ToT!.emitEvent("backtrack" as any, path, lastNode);
                return;
            }

            // Check for Early Exit
            if (tot.config.earlyExitThreshold !== undefined && currentScore !== undefined && currentScore >= tot.config.earlyExitThreshold) {
                earlyExitFound = true;
                allSuccessfulPaths.push([...path]);
                return;
            }

            if (depth >= maxDepth) {
                allSuccessfulPaths.push([...path]);
                return;
            }

            const thoughts = await this.expand(lastNode);
            await this.rateNodes(thoughts);

            for (const t of thoughts) {
                // Link graph
                if (lastNode.type === "though-node") {
                    const tn = lastNode as ThoughtNode;
                    tn.dependingThoughNodes = tn.dependingThoughNodes || [];
                    tn.dependingThoughNodes.push(t);
                }
                
                await explore([...path, t], depth + 1);
            }
        };

        for (const opt of options) {
            await explore([opt], 0);
        }

        // 3. Final Selection
        const uniqueRoots = Array.from(new Map(allSuccessfulPaths.map(p => [(p[0] as OptionNode).id, p[0] as OptionNode])).values());
        
        const buildChain = (root: OptionNode, paths: (OptionNode | ThoughtNode)[][]): ReasoningChain => {
            const build = (current: (OptionNode | ThoughtNode)[], d: number): ReasoningChain => {
                const next = Array.from(new Map(
                    paths.filter(p => p.length > d + 1 && p.slice(0, d + 1).every((n, i) => n.id === current[i].id))
                         .map(p => [p[d + 1].id, p[d + 1] as ThoughtNode])
                ).values());
                return [next, next.length > 0 ? next.map(t => build([...current, t], d + 1)) : null];
            };
            return build([root], 0);
        };

        const reasoningChains = uniqueRoots.map(root => ({
            rootOption: root,
            reasoningChain: buildChain(root, allSuccessfulPaths.filter(p => p[0].id === root.id))
        }));

        const selectBest = async (chains: any[]): Promise<OptionNode> => {
            const prompt = `Select the best final option from these deep reasoning chains: ${JSON.stringify(chains, null, 4)}`;
            const res = await this.ToT!.callableUnitInvokeStructured(
                "evaluator",
                createTheBestOptionSchema(this.ToT!.getOptionNodeSchema()),
                prompt
            );
            const best = (res.structuredOutput as DFS_TheBestOption).theBestOption[0];
            await this.ToT!.emitEvent("finalOptionSelected", best);
            return best;
        };

        const finalBest = allSuccessfulPaths.length > 0 
            ? await selectBest(reasoningChains) 
            : options.sort((a,b) => (b.initialRate?.score||0) - (a.initialRate?.score||0))[0];

        return {
            theBestOption: finalBest,
            reasoningChains,
            allOptions: options
        };
    }
}

