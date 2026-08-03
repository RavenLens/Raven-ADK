import z from "zod";
import { AgentMessagesGraphState, MessagesVariations } from "../../state";
import { ToolLogic } from "../../tools/tools";
import { MemoryDefault } from "./default";

type FunctonInstruction = {
    contextAgentState: AgentMessagesGraphState & { messages: MessagesVariations[]; };
    /** 
     * List what agent wants - specified always with combined workflow
     * Includes in one array the fetch and combined instructions from tools `fetch` and `update`:
     *  - update
     *  - fetch
    */
    agentWants?: { type: "fetch" | "update"; wants: string; }[];
}

// Memory Outcomes
type MemoryUpdated = {
    updatedInformations: string[];
    attchToAgentAwareness?: boolean;
} 

type MemoryFetched = {
    memoryInformations: string[];
    attchToAgentAwareness?: boolean;
}

type DeterministicMemoryOperationOutcome = (MemoryUpdated | MemoryFetched)[] | null;
type MemoryFunctionReturnType = DeterministicMemoryOperationOutcome | Promise<DeterministicMemoryOperationOutcome>;

/** Tools required to pass with combined workflow */
interface CombinedToolsSpec<ToolLogicArgs extends z.ZodObject> {
    /** 
     * Additional specification for what agent can `fetch`/`update`
     * - TODO: Is attached to Agent system prompt and tool description along basic `systemPrompt` from memory system
    */
    instruction: string;
    /** Arguments for the tool the agent has to fill */
    args: ToolLogicArgs;
    /** Logic of the `fetch`/`update` */
    fn?: (toolLogic: ToolLogic<ToolLogicArgs>) => string | Promise<string>;
}

/**
 * Results of call will be attached to the agent awareness
 * @param async - specify whether operation has to be asynchronous. Default: false
 */
type MemorySchemaFunction<FetchArgs extends z.ZodObject, UpdateArgs extends z.ZodObject> = {
    /**
     * @param instruction 
     * @param async - whether the function has to block the event loop - as default it's `true`
     * @returns Result what has to be set for the function
     */
    deterministicFn: (instruction: FunctonInstruction, async?: boolean) => MemoryFunctionReturnType;
    /**
     * Specify to provide combined workflow
     * Required for Combined workflow - where agent can specify what it needs by explicitly leveraging tools to describe what it wants 
     * 
     * * When specified before the `deterministicFn` call - agent will use the specified tools to fill the `deterministicFn` `instruction.agentWants`
    */
    tools?: {
        fetch?: CombinedToolsSpec<FetchArgs>;
        update?: CombinedToolsSpec<UpdateArgs>;
    };
}

/**
 * Methods for Agent - pass only methods the memory system is about to use
 * Each hook gets its own FetchArgs/UpdateArgs generics so that tools can be typed independently.
*/
interface MemoryAgentMethods<
    AfterConversationEndFetchArgs extends z.ZodObject = z.ZodObject,
    AfterConversationEndUpdateArgs extends z.ZodObject = z.ZodObject,
    BeforeOrchestratorAgentRunFetchArgs extends z.ZodObject = z.ZodObject,
    BeforeOrchestratorAgentRunUpdateArgs extends z.ZodObject = z.ZodObject,
    AfterOrchestratorAgentRunFetchArgs extends z.ZodObject = z.ZodObject,
    AfterOrchestratorAgentRunUpdateArgs extends z.ZodObject = z.ZodObject,
    BeforeSubagentRunFetchArgs extends z.ZodObject = z.ZodObject,
    BeforeSubagentRunUpdateArgs extends z.ZodObject = z.ZodObject,
    AfterSubagentRunFetchArgs extends z.ZodObject = z.ZodObject,
    AfterSubagentRunUpdateArgs extends z.ZodObject = z.ZodObject
> {
    afterConversationEnd?: MemorySchemaFunction<AfterConversationEndFetchArgs, AfterConversationEndUpdateArgs>;
    beforeOrchestratorAgentRun?: MemorySchemaFunction<BeforeOrchestratorAgentRunFetchArgs, BeforeOrchestratorAgentRunUpdateArgs>;
    afterOrchestratorAgentRun?: MemorySchemaFunction<AfterOrchestratorAgentRunFetchArgs, AfterOrchestratorAgentRunUpdateArgs>;
    beforeSubagentRun?: MemorySchemaFunction<BeforeSubagentRunFetchArgs, BeforeSubagentRunUpdateArgs>;
    afterSubagentRun?: MemorySchemaFunction<AfterSubagentRunFetchArgs, AfterSubagentRunUpdateArgs>;
}

/**
 * Memory can be called for these purposes:
 *  - Download the information from database and allocate to agent memory
 *  - Update the memory and return the status
*/
export interface DeterministicMemorySchema<
    AfterConversationEndFetchArgs extends z.ZodObject = z.ZodObject,
    AfterConversationEndUpdateArgs extends z.ZodObject = z.ZodObject,
    BeforeOrchestratorAgentRunFetchArgs extends z.ZodObject = z.ZodObject,
    BeforeOrchestratorAgentRunUpdateArgs extends z.ZodObject = z.ZodObject,
    AfterOrchestratorAgentRunFetchArgs extends z.ZodObject = z.ZodObject,
    AfterOrchestratorAgentRunUpdateArgs extends z.ZodObject = z.ZodObject,
    BeforeSubagentRunFetchArgs extends z.ZodObject = z.ZodObject,
    BeforeSubagentRunUpdateArgs extends z.ZodObject = z.ZodObject,
    AfterSubagentRunFetchArgs extends z.ZodObject = z.ZodObject,
    AfterSubagentRunUpdateArgs extends z.ZodObject = z.ZodObject
> extends MemoryAgentMethods<
    AfterConversationEndFetchArgs,
    AfterConversationEndUpdateArgs,
    BeforeOrchestratorAgentRunFetchArgs,
    BeforeOrchestratorAgentRunUpdateArgs,
    AfterOrchestratorAgentRunFetchArgs,
    AfterOrchestratorAgentRunUpdateArgs,
    BeforeSubagentRunFetchArgs,
    BeforeSubagentRunUpdateArgs,
    AfterSubagentRunFetchArgs,
    AfterSubagentRunUpdateArgs
>, MemoryDefault {
    typeMemory: "deterministic";
    /** Additional instruction can be passed to provide agent information about harness where it moves */
    systemPrompt?: string;
    // Method for obseravability
    /** Emit memory event */
    emitEvent(
        eventName: keyof MemoryAgentMethods,
        params: {
            /** What was passed to the memory function */
            input: FunctonInstruction;
            /** What was return out of that memory function */
            output: DeterministicMemoryOperationOutcome;
        }
    ): void | Promise<void>;
    /** Listen the memory events */
    onEvent(
        /** Memory function name */
        eventName: keyof MemoryAgentMethods,
        params: {
            /** What was passed to the memory function */
            input: FunctonInstruction;
            /** What was return out of that memory function */
            output: DeterministicMemoryOperationOutcome;
        }
    ): void | Promise<void>;
}
