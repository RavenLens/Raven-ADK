import z4, { z } from "zod/v4";

export interface Rate {
    /**
     * Multi-Beam:
     *  - declined - option/thought is beyond top-k it global prunes the works and chooses the best
     */
    decision: "good" | "the-best" | "declined";
    /** Floating point number describes score for the node: 0.0 - 1.0 */
    score: number;
    justification: string;
}

export const zodRateSchema = z4.object({
    decision: z4.union([
        z4.literal("good").describe("The option/thought is promising and should be kept"),
        z4.literal("the-best").describe("The single best option/thought identified so far"),
        z4.literal("declined").describe("The option/thought is beyond top-k or insufficient, global pruning recommended")
    ]),
    score: z4.number().describe("Floating point number in range 0.0 to 1.0. Higher is better"),
    justification: z4.string().describe("Justification of your decision")
}).describe("Rate schema")

export interface OptionNode<StructuredOutput = unknown> {
    /** Unique id used to track the decision took for node */
    id: string;
    type: "option-node";
    content: string;
    /** Parsed user-facing structured output associated with this option */
    zodSchema?: StructuredOutput;
    /** Rate is attached in 2nd operation after original generation */
    initialRate?: Rate;
    /** Rate is  */
    finalRate?: Rate;
    /** Justification for the final decision/selection */
    justification?: string;
}

export const zodOptionSchema = z4.object({
    id: z4.string().describe("Identifier of existsing option node from your awareness"),
    type: z4.enum(["option-node"]).describe("type of option node"),
    content: z4.string().describe("Description of the candidate solution/option"),
    zodSchema: z4.unknown().optional().describe("Structured output associated with this option when requested"),
    initialRate: zodRateSchema.optional().describe("Score compoind at the begining to calculate the best option without having thoights present"),
    finalRate: zodRateSchema.optional().describe("Rating floating point 0.0 - 1.0 score generated for the option at the end by comparing all thoughts"),
    justification: z4.string().optional().describe("Justification for the selection if it was picked as the best final option")
});

export interface ThoughtNode {
    id: string;
    type: "though-node";
    content: string;
    /** Rate is attached in 2nd operation after original generation */
    rate?: Rate;
    /** List with thought backs this thought */
    dependingThoughNodes: ThoughtNode[];
}

export const zodThoughtNodeSchema: z4.ZodType<ThoughtNode> = z4.lazy(() => z4.object({
    id: z4.string().describe("Identifier of existsing thought node from your awareness"),
    type: z4.enum(["though-node"]).describe("type of thought node"),
    content: z4.string().describe("The specific thought or reasoning step"),
    rate: zodRateSchema.optional(),
    dependingThoughNodes: z4.array(zodThoughtNodeSchema).describe("List with thought backs this thought")
}));

export type NodeDecisions =  {
    type: "explore-node-thoughts";
    /**  Node name of what decision was taken */
    fromThoughtNodeName: string;
    /** Explores thoughts associated with this thoughtNode or  */
    toThoughtNodeName: string;
    justify: string;
} | {
    type: "generate-thought";
    /**  Node name of what decision was taken */
    fromThoughtNodeName: string;
    /** Thought Node name to where will be assigned the  */
    toThoughtNodeName: string;
    thought: string;
} | {
    type: "generate-option";
    optionName: string;
    optionContent: string;
    /** Why was generated */
    justify: string;
} | {
    /** Decide whether to continue the tree path belong to some node or  */
    type: "thoughts-tree-decision";
    /** Decision was took on node because of model reasoning over the full tree */
    decision: "resigne" | "accept";
    /** Contains node name to that belongs thoughts tree */
    betterThoughtTreeNodeName?: string;
    justify: string;
};
