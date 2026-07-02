export interface Rate {
    /**
     * BFS:
     *  - declined - option/thought is beyond top-k it global prunes the works and chooses the best
     */
    decision: "good" | "the-best" | "declined";
    /** Floating point number describes score for the node: 0.0 - 1.0 */
    score: number;
    justification: string;
}

export interface OptionNode {
    /** Unique id used to track the decision took for node */
    id: string;
    type: "option-node";
    rate: Rate;
}

export interface ThoughtNode {
    id: string;
    type: "though-node";
    rate: Rate;
    /** List with thought backs this thought */
    dependingThoughNodes: ThoughtNode[];
}

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
