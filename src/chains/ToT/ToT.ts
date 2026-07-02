import { AIMessage } from "../../models";
import { NodeDecisions, OptionNode, ThoughtNode } from "./nodes";
import { BFSToT } from "./strategies/BFS";
import { DFSToT } from "./strategies/DFS";

export interface TreeOfThoughtsEvents {
    /** Triggered when the search returns to a previous state. */
    backtrack: (details: { fromNode: string; toNode: string; reason?: string }) => any | Promise<any>;
    /** Triggered when a new branch/thought is explored. */
    thoughtGenerated: (thought: any, context: { level: number }) => any | Promise<any>;
    /** Triggered when a thought is reviewed by the evaluator. */
    thoughtEvaluated: (thought: any, evaluation: { score: number; verdict: "sure" | "likely" | "rejected" }) => any | Promise<any>;
}

type LogicUnit<ReturnFormat extends Record<string, any>> = (systemPrompt: string) => Promise<ReturnFormat>

export interface TreeOfThoughtsConfig {
    /** User given task */
    query: string;
    /** Maximum depth of the thoughts tree for full-tree. Default is 10. */
    maxThoughtsDepth?: number;
    /** Number of thoughts is generated for each option and next thought. Default: 3. Cannot be smaller neither equal than BFS TopK */
    thoughtsCount?: number;
    /** How many options generates initially. Cannot be 0. Cannot be smaller neither equal than BFS TopK */
    initialOptionsCount: number;
    /** Use to search graph accordingly */
    graphSearchAlgorithm: BFSToT | DFSToT;
    /** 
     * Generates different options for the 1st step of run
     * 1st param: is user prompt - you can embedd this in whatever wrapper or process directly
    */
    optionGenerator: LogicUnit<OptionNode>;
    /** Generates thoughts adjacent to option or to other thought creating the tree of decisions */
    thoughtGenerator: LogicUnit<AIMessage>;
    /** Evaluates a thought and returns a score/verdict. */
    evaluator: LogicUnit<AIMessage>;
}

export class TreeOfThoughts {
    /** Events list */
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    config: TreeOfThoughtsConfig;
    /** Stores all steps from reasoning process */
    reasoningProcess: NodeDecisions[] = [];
    /** List with nodes */
    nodes: [OptionNode, ThoughtNode[]][] = [];
    
    constructor(config: TreeOfThoughtsConfig) {
        this.config = config;
    }

    protected emitEvent<EventName extends keyof TreeOfThoughtsEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<TreeOfThoughtsEvents[EventName]>
    ) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as TreeOfThoughtsEvents[EventName];

        void Promise.resolve((listener as any)(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    onEvent<EventName extends keyof TreeOfThoughtsEvents>(
        eventName: EventName,
        eventListener: TreeOfThoughtsEvents[EventName]
    ): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${eventName}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }

    async generateOptions(): Promise<OptionNode[]> {
        const promises = Array.from({ length: this.config.initialOptionsCount }, () =>
            this.config.optionGenerator(this.config.query)
        );
        const results = await Promise.all(promises);
        return results.flat();
    }

    generateOptionThoughts() {

    }

    async invoke() {
        return await this.config.graphSearchAlgorithm.logic(this);
    }
}

new TreeOfThoughts({
    evaluator(prompt) {
        return {

        } as AIMessage;
    }
})