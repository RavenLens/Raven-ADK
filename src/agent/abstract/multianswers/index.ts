import { MessagesVariations } from "../../../models";
import { AgentModel, ReActAgent } from "../../ReAct.agent";

export interface MultiAnswersConfig {
    messages: MessagesVariations[];
    /** It overrides the system prompt is at the begining of conversation */
    systemPrompt?: string;
    runners: (InstanceType<typeof ReActAgent> | AgentModel)[];
}

/* TODO: Add to exportable and to package.json exports */
export class MultiAnswers {
    config: MultiAnswersConfig;
    
    constructor(config: MultiAnswersConfig) {
        this.config = config;
    }
}
