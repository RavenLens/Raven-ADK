import z from "zod";
import { MemoryDefault } from "./default";
import { ReActAgentPluginSpec } from "../../ReAct.agent";
import { AgentMessagesGraphState, MessagesVariations } from "../../state";

interface ToolSpec<ToolArgs extends z.ZodObject> {
    toolName: string;
    fn: (argsObj: z.infer<ToolArgs>, agentState?: AgentMessagesGraphState & { messages: MessagesVariations[]; }) => Promise<string> | string;
    /** Specify instruction how to use this tool */
    instruction: string;
    toolArguments: ToolArgs;
}

export interface ToolBasedMemorySchema<FetchToolArgs extends z.ZodObject, UpdateToolArgs extends z.ZodObject> extends MemoryDefault {
    typeMemory: "toolBased";
    /**
     * Instruction done by tools to fetch the memory
    */
    memoryTools: {
        fetch?: ToolSpec<FetchToolArgs>;
        /**
         * Tool Used to update the memory
         * * Update means:
         *      - Save
         *      - Delete
         *      - Override
        */
        update?: ToolSpec<UpdateToolArgs>;
    };
    /** 
     * Specify plugin to update the conclude the full progress and e.g: save the conclusion file for the specified memory
     * Specify place where it can be leveraged
    */
    conclusionPlugin?: ReActAgentPluginSpec;
}


