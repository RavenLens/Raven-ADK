import z4 from "zod/v4";
import { ReActAgent } from "../../agent";
import { AgentModel } from "../../agent/ReAct.agent";
import { AIMessage, MessagesVariations, OpenAI } from "../../models";
import { OptionNode, ThoughtNode } from "./nodes";
import { MultiBeamToT } from "./strategies/MultiBeam";
import { BFSToT } from "./strategies/BFS";
import { DFSToT } from "./strategies/DFS";
import { BestFirstToT } from "./strategies/BestFirst";

export interface TreeOfThoughtsEvents {
    /** Triggered when the search returns to a previous state. */
    backtrack: (details: { fromNode: string; toNode: string; reason?: string }) => any | Promise<any>;
    /** Emitted for each generated option */
    optionGenerated: (option: OptionNode) => any | Promise<any>;
    /** Triggered when a new branch/thought is explored. */
    thoughtsGenerated: (forNode: OptionNode | ThoughtNode, thoughts: ThoughtNode[]) => any | Promise<any>;
    /** Triggered when an option is reviewed by the evaluator. */
    optionEvaluated: (option: OptionNode) => any | Promise<any>;
    /** Triggered when a thought is reviewed by the evaluator. */
    thoughtEvaluated: (thought: ThoughtNode) => any | Promise<any>;
    /** Triggered when many options are pruned to Top-K */
    optionsPruned: (allOptions: OptionNode[], topKOptions: OptionNode[]) => any | Promise<any>;
    /** Triggered when many thoughts are pruned to Top-K */
    thoughtsPruned: (rootOption: OptionNode, path: (OptionNode | ThoughtNode)[], allThoughts: ThoughtNode[], topKThoughts: ThoughtNode[]) => any | Promise<any>;
    /** Triggered when the final best option is selected */
    finalOptionSelected: (option: OptionNode) => any | Promise<any>;
}

interface CustomCallUnit {
    type: "custom-callunit";
    invokeStructuredOutput(messages: MessagesVariations[]): Promise<MessagesVariations[]>;
}

type CallUnit = ReActAgent<any, any, any, any> | AgentModel | CustomCallUnit;

export interface TreeOfThoughtsConfig {
    /** User given task */
    query: string;
    /** 
     * Maximum depth of the thoughts tree for the search process. 
     * - **MultiBeam**: Determines the number of iterative parallel expansion steps performed for each active beam. Winner is chosen after reviewing the full path.
     * - **BFS**: Determines the number of global frontier expansion levels (breadth steps) before final selection. Winner is chosen after reviewing the full path.
     * - **DFS**: Determines the maximum recursion depth (length of a single reasoning path) before stopping or backtracking. Winner is chosen after reviewing the full path.
     * - **BestFirst**: Determines the maximum path length for any branch in the priority queue.
     * @default 10
     */
    maxThoughtsDepth?: number;
    /**
     * If any thought or option reaches this score (0.0 - 1.0), the search will terminate immediately 
     * and proceed to final evaluation with the current findings.
     * Use this to save tokens and time when a definitive answer is found early.
     */
    earlyExitThreshold?: number;
    /** 
     * Number of thoughts is generated for each option and next thought. Default: 3. Cannot be smaller neither equal than Multi-Beam SEARCH TopK
     * @default 3
     */
    thoughtsCount?: number;
    /** How many options generates initially. Cannot be 0. Cannot be smaller neither equal than Multi-Beam SEARCH TopK */
    initialOptionsCount: number;
    /** Use to search graph accordingly */
    graphSearchAlgorithm: BFSToT | MultiBeamToT | DFSToT | BestFirstToT;
    /**
     * Generates different options for the 1st step of run
     * 1st param: is user prompt - you can embedd this in whatever wrapper or process directly
    */
    optionGenerator: CallUnit;
    /** Generates thoughts adjacent to option or to other thought creating the tree of decisions */
    thoughtGenerator: CallUnit;
    /** Evaluates a thought and returns a score/verdict. */
    evaluator: CallUnit;
}

/** Default number of thoughts used to generate prompts */
export const DEFAULTS_THOUGHTS_COUNT = 3;

/** DefaulIs the depth of thoughts */
export const DEFAULT_THOUGHTS_DEPTH = 10;

export class TreeOfThoughts {
    /** Events list */
    private EventsListeners: Record<string, (...args: any[]) => void | Promise<void>> = {};
    config: TreeOfThoughtsConfig;
    /** List with nodes */
    nodes: [OptionNode, ThoughtNode[]][] = [];
    
    constructor(config: TreeOfThoughtsConfig) {
        this.config = config;

        config.maxThoughtsDepth = DEFAULT_THOUGHTS_DEPTH;
        config.thoughtsCount = DEFAULTS_THOUGHTS_COUNT;
    }

    public async emitEvent<EventName extends keyof TreeOfThoughtsEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<TreeOfThoughtsEvents[EventName]>
    ) {
        const eventListener = this.EventsListeners[eventName];

        if (!eventListener) {
            return;
        }

        const listener = eventListener as unknown as TreeOfThoughtsEvents[EventName];

        try {
            await Promise.resolve((listener as any)(...eventArgs));
        } catch (error) {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        }
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

    async callableUnitInvokeStructured(unitName: keyof Pick<TreeOfThoughtsConfig, "evaluator" | "thoughtGenerator" | "optionGenerator">, schema: z4.ZodType, instruction: string): Promise<AIMessage> {
        const u = this.config[unitName];
        const systemMessage: MessagesVariations = {
            type: "system",
            content: instruction
        };

        if (u instanceof ReActAgent) {
            u.agentConfig.messages = [systemMessage];
            const result = await u.invokeStructuredOutput(schema, 3);
            const lastMsg = result.messages[result.messages.length - 1] as AIMessage;
            
            if (!result.messages.length || lastMsg.type !== "ai" || !lastMsg.structuredOutput) {
                throw new Error(`Failed to generate structured output for ${unitName} after 3 tries`);
            }

            return lastMsg;
        }
        else if ((u as CustomCallUnit)?.type === "custom-callunit") {
            for (let i = 0; i < 3; i++) {
                try {
                    const lastMessages = await (u as CustomCallUnit).invokeStructuredOutput([systemMessage]);
                    const lastMsg = lastMessages[lastMessages.length - 1] as AIMessage;
                    if (lastMsg?.type === "ai" && lastMsg.structuredOutput) {
                        return lastMsg;
                    }
                } catch (e) {
                    if (i === 2) throw e;
                }
            }
            throw new Error(`Failed to generate structured output for ${unitName} after 3 tries`);
        }
        else if ((u as AgentModel)?.typeAPI === "model") {
            const model = u as OpenAI;
            model.config.messages = [systemMessage];
            const result = await model.invokeStructuredOutput(schema, 3);
            const lastMsg = result.answer[result.answer.length - 1] as AIMessage;
            
            if (!lastMsg || lastMsg.type !== "ai" || !lastMsg.structuredOutput) {
                throw new Error(`Failed to generate structured output for ${unitName} after 3 tries`);
            }

            return lastMsg;
        }
        else throw new Error("Unsupported CallUnit type");
    }

    async invoke() {
        return await this.config.graphSearchAlgorithm.logic(this);
    }
}