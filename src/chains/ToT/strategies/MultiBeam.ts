import z4 from "zod/v4";
import { OptionNode, ThoughtNode, zodRateSchema, zodThoughtNodeSchema } from "../nodes";
import { DEFAULT_THOUGHTS_DEPTH, DEFAULTS_THOUGHTS_COUNT, TreeOfThoughts } from "../ToT";
import { createGenerateOptionsSchema, createTheBestOptionSchema, createTopKOptionsSchema, LogicReturnType, OpenTelemetryTreeOfThoughts, ReasoningChain, StrategySchema } from "./strategy";
import { randomUUID } from "node:crypto";

interface MultiBeam_GenerateOptions {
    options: OptionNode[];
}

interface MultiBeam_EvaluateTopKOptionsSchema {
    topOptions: OptionNode[];
}

interface MultiBeam_EvaluateTopThoughtsSchema {
    topThoughts: ThoughtNode[];
}

const zodEvaluateTopThoughtsSchema: z4.ZodType<MultiBeam_EvaluateTopThoughtsSchema> = z4.object({
    topThoughts: z4.array(zodThoughtNodeSchema).describe("List with top evaluated thoughts")
})

interface MultiBeam_NewThoughsSchema {
    thoughts: ThoughtNode[]
}

const zodNewThoughtsSchema: z4.ZodType<MultiBeam_NewThoughsSchema> = z4.object({
    thoughts: z4.array(zodThoughtNodeSchema).describe("List with new thoughts")
})

interface MultiBeam_TheBestOption {
    theBestOption: OptionNode[];
}

interface MultiBeam_RateNodesResponse {
    ratings: { id: string; rate: any }[];
}

const zodRateNodesSchema = z4.object({
    ratings: z4.array(z4.object({
        id: z4.string().describe("Id of node gets the rating"),
        rate: zodRateSchema
    }))
});

export interface MultiBeamConfig {
    /** Cannot be equal or greater than `initialOptionsCount` and `thoughtsCount` */
    topK: number;
    /**
     * Describes when the model can start to evaluate the thoughts
     * If not specified always analyses from end of first thoughts layer
     * Specify to number larger than 1 e.g: 10 to delibaratelly extend the duration
     * IT cannot excess a `maxThoughtsDepth` but can be equal
     */
    evaluateAfterThoughtTreeLevel?: number | undefined;
    /** Whether to continue only for the best options without producing thoughts */
    pruneAtBegining?: boolean;
}

/**
 * Structured-output notation: each beam retains a schema-valid option value
 * through global pruning and final beam selection.
 */
export class MultiBeamToT implements StrategySchema {
    name = "MultiBeam-ToT";
    telemetry?: OpenTelemetryTreeOfThoughts;
    private ToT: TreeOfThoughts | undefined = undefined;
    private config: MultiBeamConfig;

    constructor(config: MultiBeamConfig) {
        this.config = {
            ...config,
            topK: config.topK ?? 3
        }

        if (this.config.evaluateAfterThoughtTreeLevel && this.config.evaluateAfterThoughtTreeLevel > (this.ToT?.config.maxThoughtsDepth ?? DEFAULT_THOUGHTS_DEPTH)) {
            throw new Error("`evaluateAfterThoughtTreeLevel` cannot excess a `maxThoughtsDepth` but can be equal");
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
        const structured = result.structuredOutput as MultiBeam_RateNodesResponse;

        this.telemetry?.recordStep("rate_nodes", { count: nodes.length, rateType });

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
            ${createTopKOptionsSchema(this.ToT!.getOptionNodeSchema()).toJSONSchema()}
            `
    
    
            const topKOptionsObj = await this.ToT!.callableUnitInvokeStructured(
                "evaluator",
                createTopKOptionsSchema(this.ToT!.getOptionNodeSchema()),
                systemPrompt
            );
            const structured = topKOptionsObj.structuredOutput as MultiBeam_EvaluateTopKOptionsSchema;
    
            if (!structured || !Array.isArray(structured.topOptions)) {
                const received = JSON.stringify(topKOptionsObj.structuredOutput as any);
                throw new Error(`Structure message has to be an object with topOptions array. Received: ${received}`);
            } 

            this.telemetry?.recordPruning("options", options.length, structured.topOptions.length);
            await this.ToT!.emitEvent("optionsPruned", options, structured.topOptions);
            
            return structured.topOptions;
        }

        return await genStructuredOutput();
    }

    /** use to ensure id of node is truelly unique */
    private genUniqueId<T = any>(nodesList: T[]): T[] {
        return (nodesList as any).map((node: any) => {
            node.id = randomUUID();
            return node;
        });
    }
    
    private async generateOptions(): Promise<OptionNode[]> {
        const prompt = `
# Role & Context
You are a strategic reasoning engine operating within a Tree-of-Thoughts (ToT) system using Multi-Beam Search reasoning. 
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
Note: Do NOT provide ratings (\`initialRate\` field nor \`finalRate\`) at this stage; focus on the ID and the content.
        `
        const promises = Array.from({ length: this.ToT!.config.initialOptionsCount }, () =>
            this.ToT!.callableUnitInvokeStructured(
                "optionGenerator",
                createGenerateOptionsSchema(this.ToT!.getOptionNodeSchema()),
                prompt
            )
        );
        const results = await Promise.all(promises);
        const optionsFlat = results.flatMap(res => (res.structuredOutput as MultiBeam_GenerateOptions).options);

        this.telemetry?.recordStep("generate_options", { count: optionsFlat.length });

        // Generate Truelly unique id
        const uniqueIdOptions = this.genUniqueId(optionsFlat).map(opt => {
            delete opt.initialRate;
            delete opt.finalRate;
            return opt;
        });

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
You are a strategic reasoning engine operating within a Tree-of-Thoughts (ToT) system using the Multi-Beam Search reasoning.
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
        const thougthsFlat = results.flatMap(res => (res.structuredOutput as MultiBeam_NewThoughsSchema).thoughts);

        this.telemetry?.recordStep("generate_thoughts", { rootOptionId: rootOption.id, parentNodeId: node.id, count: thougthsFlat.length });

        // Generate Truelly unique id
        const uniqueIdThoughts = this.genUniqueId(thougthsFlat).map(thought => {
            delete thought.rate;
            return thought;
        });

        await this.ToT!.emitEvent("thoughtsGenerated", node, uniqueIdThoughts);

        // List with unique options
        return uniqueIdThoughts;    
    }

    /** Select the absolute best option based on the full reasoning process */
    private async selectTheBestFinalOption(allReasoningChains: { rootOption: OptionNode; reasoningChain: ReasoningChain }[]): Promise<OptionNode> {
        const chainsSummary = allReasoningChains.map((chain, index) => {
            return `## Path ${index + 1} (Root: ${chain.rootOption.content})\n` +
                   `Reasoning Tree:\n${this.summarizeChain(chain.reasoningChain)}`;
        }).join("\n\n");

        const systemPrompt = `
# Role & Context
You are a final judge in a Tree-of-Thoughts (ToT) system using Multi-Beam Search reasoning.
Multiple reasoning paths (options and their expanded thoughts) have been explored.
Your task is to review all explored paths and select the single most successful and complete solution.

# Task
Evaluate the provided reasoning chains and select the absolute best initial option that led to the most promising conclusion.
Provide a clear justification for why this specific path was chosen in the \`justification\` field.

# User Query
${this.ToT!.config.query}

# Reasonings Explored (Summarized)
${chainsSummary}

# Reasonings Explored (Full Data)
${JSON.stringify(allReasoningChains, null, 4)}

# Selection Criteria
1. **Completeness**: Which path fully addresses the query?
2. **Accuracy**: Which path maintains the highest logical integrity?
3. **Feasibility**: Which path provides the most actionable or valid solution?

# Output Requirement
Return the best option strictly adhering to the following schema. Ensure the \`justification\` field is populated.
${createTheBestOptionSchema(this.ToT!.getOptionNodeSchema()).toJSONSchema()}
        `;

        const result = await this.ToT!.callableUnitInvokeStructured(
            "evaluator",
            createTheBestOptionSchema(this.ToT!.getOptionNodeSchema()),
            systemPrompt
        );
        const structured = result.structuredOutput as MultiBeam_TheBestOption;
        
        this.telemetry?.recordStep("select_final_option");

        if (!structured || !Array.isArray(structured.theBestOption) || structured.theBestOption.length === 0) {
            const received = JSON.stringify(result.structuredOutput, null, 2);
            throw new Error(`Failed to select the best final option. Expected non-empty array 'theBestOption', but received: ${received}`);
        }
        
        const bestOption = structured.theBestOption[0];
        await this.ToT!.emitEvent("finalOptionSelected", bestOption);
        return bestOption;
    }

    async logic(tot: TreeOfThoughts): Promise<LogicReturnType> {
        // 0.1. Assigns ToT
        this.ToT = tot;
        const maxDepth = this.ToT.config.maxThoughtsDepth ?? DEFAULT_THOUGHTS_DEPTH;

        // 1. Generate Options
        const generatedOptions = await this.generateOptions();
        
        // Rate options separately
        await this.rateNodes({}, generatedOptions, "initial");

        // Check for Early Exit on Level 0
        if (tot.config.earlyExitThreshold !== undefined) {
            const bestInitial = generatedOptions.find(o => (o.initialRate?.score ?? 0) >= tot.config.earlyExitThreshold!);
            if (bestInitial) {
                return {
                    theBestOption: bestInitial,
                    reasoningChains: [{ rootOption: bestInitial, reasoningChain: [[], null] }],
                    allOptions: generatedOptions
                };
            }
        }

        // 2. Initial selection of beams
        let currentBeams: { rootOption: OptionNode; path: (OptionNode | ThoughtNode)[] }[] = [];
        
        const topOptions = await this.getTheBestOptions(generatedOptions);
        currentBeams = topOptions.map(opt => ({
            rootOption: opt,
            path: [opt]
        }));

        // 3. Iterative Global Beam expansion
        for (let depth = 0; depth < maxDepth; depth++) {
            this.telemetry?.recordIteration(depth, { activeBeams: currentBeams.length });
            const allCandidates: { beam: { rootOption: OptionNode; path: (OptionNode | ThoughtNode)[] }; thoughts: ThoughtNode[] }[] = [];
            
            // Expand each beam in parallel
            await Promise.all(currentBeams.map(async (beam) => {
                const thoughts = await this.generateOptionThoughts(beam.rootOption, beam.path, depth);
                if (thoughts.length > 0) {
                    allCandidates.push({ beam, thoughts });
                }
            }));

            if (allCandidates.length === 0) break;

            const flatThoughts = allCandidates.flatMap(c => c.thoughts);
            
            // Rate all thoughts from this level together, respecting evaluateAfterThoughtTreeLevel
            const shouldRate = !this.config.evaluateAfterThoughtTreeLevel || depth >= this.config.evaluateAfterThoughtTreeLevel;
            if (flatThoughts.length > 0 && shouldRate) {
                await this.rateNodes({}, flatThoughts, "thought");
            }

            // Check for Early Exit
            if (tot.config.earlyExitThreshold !== undefined && shouldRate) {
                const bestThought = flatThoughts.find(t => (t.rate?.score ?? 0) >= tot.config.earlyExitThreshold!);
                if (bestThought) {
                    const selection = allCandidates.find(c => c.thoughts.some(t => t.id === bestThought.id))!;
                    const finalPath = [...selection.beam.path, bestThought];
                    
                    const chain = {
                        rootOption: selection.beam.rootOption,
                        reasoningChain: this.buildReasoningChain(selection.beam.rootOption, [finalPath])
                    };

                    await this.ToT!.emitEvent("finalOptionSelected", selection.beam.rootOption);

                    return {
                        theBestOption: selection.beam.rootOption,
                        reasoningChains: [chain],
                        allOptions: generatedOptions
                    };
                }
            }

            // Global Pruning step to maintain top-K beams across all branches
            const nextLevelSelections = await this.getTheBestThoughtsGlobal(allCandidates);

            // Populate dependingThoughNodes to maintain the graph structure (Facet 4)
            for (const selection of nextLevelSelections) {
                const parent = selection.beam.path[selection.beam.path.length - 1];
                if (parent.type === "though-node") {
                    const tn = parent as ThoughtNode;
                    tn.dependingThoughNodes = tn.dependingThoughNodes || [];
                    // Avoid duplicates if multiple beams share a parent (though unlikely in this architecture)
                    if (!tn.dependingThoughNodes.find(n => n.id === selection.thought.id)) {
                        tn.dependingThoughNodes.push(selection.thought);
                    }
                }
            }

            // Update beams for next level
            currentBeams = nextLevelSelections.map(s => ({
                rootOption: s.beam.rootOption,
                path: [...s.beam.path, s.thought]
            }));
        }

        // 4. Final scoring based on full reasoning paths
        // We evaluate the root options again with the context of their best paths
        const finalPaths = currentBeams.map(b => b.path);
        const uniqueRoots = Array.from(new Map(currentBeams.map(b => [b.rootOption.id, b.rootOption])).values());

        await Promise.all(uniqueRoots.map(async (root) => {
            // Find paths belonging to this root
            const rootPaths = finalPaths.filter(p => p[0].id === root.id);
            const flatContext = this.flattenPaths(rootPaths);
            
            await this.rateNodes(
                { rootOption: root, path: flatContext },
                [root],
                "final"
            );
        }));

        // 5. Build ReasoningChain structures for the result
        const reasoningChains = uniqueRoots.map(root => {
            return {
                rootOption: root,
                reasoningChain: this.buildReasoningChain(root, finalPaths)
            };
        });

        // 6. Select the absolute best option based on the full reasoning strings
        const bestOption = await this.selectTheBestFinalOption(reasoningChains);
        
        return {
            theBestOption: bestOption,
            reasoningChains: reasoningChains,
            allOptions: generatedOptions
        };
    }

    /** Global competitive selection across all active beams */
    private async getTheBestThoughtsGlobal(
        candidates: { beam: { rootOption: OptionNode; path: (OptionNode | ThoughtNode)[] }; thoughts: ThoughtNode[] }[]
    ): Promise<{ beam: { rootOption: OptionNode; path: (OptionNode | ThoughtNode)[] }; thought: ThoughtNode }[]> {
        const flatCandidates = candidates.flatMap(c => c.thoughts.map(t => ({ beam: c.beam, thought: t })));
        
        const systemPrompt = `
# Role & Context
You are a strategic evaluator within a Tree-of-Thoughts (ToT) reasoning framework using Multi-Beam Search. 
Multiple reasoning paths (beams) have been expanded. Your task is to perform a GLOBAL selection and pick exactly the top-k is: '${this.config.topK}' most promising next-steps across all active beams.

# Task
Review the candidate thoughts from all beams and select the top-${this.config.topK} overall. You are not required to pick one from each beam; you must pick the absolute best ones to continue the search.

# Beams and Candidates
${flatCandidates.map((c, i) => `## Candidate ${i + 1}
- From Root: ${c.beam.rootOption.content}
- Established Path: ${c.beam.path.map(n => n.content).join(" -> ")}
- New Candidate Thought: ${JSON.stringify(c.thought, null, 4)}`).join("\n\n")}

# Output Requirement
Return the selected top-${this.config.topK} thoughts strictly adhering to the following schema. Use the identical objects (including IDs) from the candidates list.
${zodEvaluateTopThoughtsSchema.toJSONSchema()}
        `;

        const result = await this.ToT!.callableUnitInvokeStructured("evaluator", zodEvaluateTopThoughtsSchema, systemPrompt);
        const structured = result.structuredOutput as MultiBeam_EvaluateTopThoughtsSchema;

        if (!structured || !Array.isArray(structured.topThoughts)) {
            const received = JSON.stringify(result.structuredOutput, null, 2);
            throw new Error(`Structure message has to be an object with topThoughts array. Received: ${received}`);
        }

        this.telemetry?.recordPruning("thoughts", flatCandidates.length, structured.topThoughts.length);

        // Emit events for pruning. Since thoughtsPruned event is per-path, we group them.
        // For debugging/logic clarity, we try to match the event signature as best as possible.
        const selections = structured.topThoughts.map(st => {
            const found = flatCandidates.find(c => c.thought.id === st.id);
            if (!found) throw new Error(`Evaluator returned an unknown thought ID: ${st.id}`);
            return found;
        });

        // Group by beam to emit events
        for (const c of candidates) {
            const selectedForThisBeam = selections.filter(s => s.beam === c.beam).map(s => s.thought);
            await this.ToT!.emitEvent("thoughtsPruned", c.beam.rootOption, c.beam.path, c.thoughts, selectedForThisBeam);
        }

        // Stop if we selected more than topK (sanity check)
        return selections.slice(0, this.config.topK);
    }

    /** Helper to reconstruct the recursive ReasoningChain from a set of final paths */
    private buildReasoningChain(root: OptionNode, paths: (OptionNode | ThoughtNode)[][]): ReasoningChain {
        const rootPaths = paths.filter(p => p[0].id === root.id);
        
        const buildRecursive = (currentPath: (OptionNode | ThoughtNode)[], depth: number): ReasoningChain => {
            // Find unique thoughts at next depth that follow the current path prefix
            const uniqueThoughts = Array.from(new Map(
                rootPaths
                    .filter(p => p.length > depth + 1 && p.slice(0, depth + 1).every((n, i) => n.id === currentPath[i].id))
                    .map(p => [p[depth + 1].id, p[depth + 1] as ThoughtNode])
            ).values());

            const nextChains = uniqueThoughts.length > 0
                ? uniqueThoughts.map(t => buildRecursive([...currentPath, t], depth + 1))
                : null;

            return [uniqueThoughts, nextChains];
        };

        return buildRecursive([root], 0);
    }

    /** Flatten a set of paths into a unique list of nodes */
    private flattenPaths(paths: (OptionNode | ThoughtNode)[][]): (OptionNode | ThoughtNode)[] {
        const result: (OptionNode | ThoughtNode)[] = [];
        for (const path of paths) {
            result.push(...path);
        }
        return Array.from(new Map(result.map(node => [node.id, node])).values());
    }

    /** Helper to generate a readable summary of the reasoning tree (Facet 5) */
    private summarizeChain(chain: ReasoningChain, depth: number = 0): string {
        const [thoughts, next] = chain;
        let output = "";
        const indent = "  ".repeat(depth);
        
        thoughts.forEach((thought, i) => {
            const score = thought.rate ? ` [Score: ${thought.rate.score}]` : "";
            output += `${indent}- ${thought.content}${score}\n`;
            if (next && next[i]) {
                output += this.summarizeChain(next[i], depth + 1);
            }
        });
        
        return output;
    }
}