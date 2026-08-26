/* 
 * Represents Dummy Model - USED for test
 * Gives predicatble output
 * 
 * ### Specification
 * * 
*/
import { ZodType } from "zod";
import { InvokeOptions, LLMAnswer, StandardLLMShema } from "../mutual";
import { MessagesVariations } from "../../agent/state";

export type AnswerBaseOnParamsFn = (option: OptionVariance) => LLMAnswer | Promise<LLMAnswer>

export interface DummyModelConfig {
    /** Conversation synchronized by ReActAgent or supplied to invoke. */
    messages?: MessagesVariations[];
    /** 
     * Paste here the messages will be pasted to the agent one by one - guiding its reasoning
    */
    messagesFlow?: (LLMAnswer | AnswerBaseOnParamsFn)[];
    /**
     * When specified will be used when model was called when full list `messagesFlow` was depleted
     */
    handleOverflow?: AnswerBaseOnParamsFn;
    /** 
     * Pass the singular answer is going to be return
     * User function to return the llmanswer base on external events
    */
    invokeOutcome?: LLMAnswer | AnswerBaseOnParamsFn;
    /** 
     * Pass the singular answer is going to be return
     * User function to return the llmanswer base on external events
    */
    invokeStructuredOutcome?: LLMAnswer | AnswerBaseOnParamsFn;
    /** Preserve the input conversation when an outcome contains only new answer messages. */
    preserveMessages?: boolean;
    /** Validate structuredOutput responses against the requested schema when enabled. */
    validateStructuredOutput?: boolean;
}

type OptionVariance = ({
    type: "invoke";
} & InvokeOptions) | ({
    type: "invokeStructuredOutput";
    schema?: ZodType;
    maxRecallTries?: number;
    options?: InvokeOptions;
});

export interface DummyModelEvents {
    output: (answer: LLMAnswer) => Promise<void> | void; 
}

export class DummyModel implements StandardLLMShema<DummyModelConfig> {
    typeAPI: "model" = "model";
    apiName: "Anthropic" | "OpenAI" | "Google" | { custom: string; } = { custom: "DummyModel" };
    config: DummyModelConfig;
    messageFlowLastIndex: number | null = null;
    private EventsListeners: Partial<{ [EventName in keyof DummyModelEvents]: DummyModelEvents[EventName] }> = {};
    
    constructor(config: DummyModelConfig) {
        this.config = config;
    }

    /** Starts a scripted flow from its first response. */
    reset(): void {
        this.messageFlowLastIndex = null;
    }
    
    onEvent<EventName extends keyof DummyModelEvents>(eventName: EventName, eventListener: DummyModelEvents[EventName]): this {
        if (this.EventsListeners[eventName]) {
            console.warn(`Event listener for "${String(eventName)}" is already registered. Only one listener per event name is allowed.`);
            return this;
        }

        this.EventsListeners[eventName] = eventListener;
        return this;
    }
    
    protected emitEvent<EventName extends keyof DummyModelEvents>(eventName: EventName, ...eventArgs: Parameters<DummyModelEvents[EventName]>): void {
        const eventListener = this.EventsListeners[eventName] as any as (...rest: any[]) => void;

        if (!eventListener) return;

        void Promise.resolve(eventListener(...eventArgs)).catch((error) => {
            console.warn(`Event listener for "${String(eventName)}" failed during execution.`, error);
        });
    }

    /**
     * Internal logic to return llm answer
    */
    private async invokeLogic(optionsVariance: OptionVariance, singularOutcome?: LLMAnswer | AnswerBaseOnParamsFn) {
        let outcome: LLMAnswer;

        if (singularOutcome) {
            outcome = typeof singularOutcome === "function" ? await singularOutcome(optionsVariance) : singularOutcome;
        }
        else if (this.config.messagesFlow) {
            const nextMessageFlowIndex = this.messageFlowLastIndex === null ? 0 : this.messageFlowLastIndex + 1;

            if (nextMessageFlowIndex < this.config.messagesFlow.length) {
                const answer = this.config.messagesFlow[nextMessageFlowIndex];
                this.messageFlowLastIndex = nextMessageFlowIndex;

                outcome = typeof answer === "function" ? await answer(optionsVariance) : answer;
            } else {
                outcome = await this.getOverflowOutcome(optionsVariance);
            }
        }
        else if (this.config.handleOverflow) {
            outcome = await this.config.handleOverflow(optionsVariance);
        } else {
            throw new Error("Invoke logic cannot be handled");
        }

        const inputMessages = optionsVariance.type === "invokeStructuredOutput"
            ? optionsVariance.options?.messages ?? this.config.messages
            : optionsVariance.messages ?? this.config.messages;
        const messages = this.config.preserveMessages !== false && inputMessages?.length
            ? this.hasMessagePrefix(outcome.messages, inputMessages)
                ? outcome.messages
                : [...inputMessages, ...outcome.messages]
            : outcome.messages;
        const result = { ...outcome, messages };

        if (optionsVariance.type === "invokeStructuredOutput" && this.config.validateStructuredOutput) {
            const structuredMessage = result.answer.find(
                (message): message is Extract<MessagesVariations, { type: "ai" }> =>
                    message.type === "ai" && message.structuredOutput !== undefined
            );
            const validation = optionsVariance.schema?.safeParse(structuredMessage?.structuredOutput);
            if (validation && !validation.success) {
                throw new Error(`DummyModel structured output does not match schema: ${validation.error.message}`);
            }
        }

        this.emitEvent("output", result);
        return result;
    }

    private async getOverflowOutcome(optionsVariance: OptionVariance): Promise<LLMAnswer> {
        if (!this.config.handleOverflow) {
            throw new Error("Invoke logic cannot be handled");
        }

        return await this.config.handleOverflow(optionsVariance);
    }

    private hasMessagePrefix(messages: LLMAnswer["messages"], prefix: LLMAnswer["messages"]): boolean {
        return prefix.every((message, index) => messages[index] === message);
    }
    
    /**
     * Each time message is used the next message is leveraged to produce the outcome as the `LLMAnswer`
     * @param options
     * 
     * @returns 
     */
    async invoke(options?: InvokeOptions | AnswerBaseOnParamsFn): Promise<LLMAnswer> {
        const invokeOptions = typeof options === "function" ? undefined : options;
        return await this.invokeLogic(
            {
                type: "invoke",
                ...invokeOptions
            },
            typeof options === "function" ? options : this.config.invokeOutcome
        );
    }

    /**
     * Each time message is used the next message is leveraged to produce the outcome as the `LLMAnswer`
     * @param schema - don't pass it - this param aren't used
     * @param maxRecallTries - don't pass it - this param aren't used
     * @param options - don't pass it - this param aren't used
     * 
     * @returns 
     */
    async invokeStructuredOutput(schema: ZodType, maxRecallTries?: number, options?: InvokeOptions): Promise<LLMAnswer> {
        return await this.invokeLogic(
            {
                type: "invokeStructuredOutput",
                schema: schema,
                maxRecallTries,
                options
            },    
            this.config.invokeStructuredOutcome
        );
    }
}
