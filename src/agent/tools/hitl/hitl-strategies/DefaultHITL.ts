import * as z from "zod";
import { tool, Tool } from "../../tools";
import {
    DEFAULT_ABC_ANSWERS_RANGE,
    EmitToolUsageBody,
    HITLConfigSchema,
    HITLToolAllowancePossibleAnswer,
    HITLToolInstanceProbe,
    HITLEventArgs,
    HITLEventsSpecType,
    HITLTransportSchema,
} from "../hitlToolSchema";

export const HITL_ABC_QUESTION_TOOL_NAME = "hitl_ask_abc_question";
export const HITL_OPEN_QUESTION_TOOL_NAME = "hitl_ask_open_question";
export const HITL_ACCEPTANCE_TOOL_NAME = "hitl_ask_acceptance";

export type HITLRequest =
    | { type: "tool-approval"; toolName: string; toolInstance: HITLToolInstanceProbe["toolInstance"]; params: HITLToolInstanceProbe["params"] }
    | { type: "abc-question"; question: string; options: [string, string][] }
    | { type: "open-question"; question: string }
    | { type: "acceptance"; question: string; context?: string };

export type HITLResponse =
    | { type: "tool-approval"; answer: HITLToolAllowancePossibleAnswer }
    | { type: "abc-answer"; option: string; optionLabel: string }
    | { type: "open-answer"; answer: string }
    | { type: "acceptance-answer"; answer: HITLToolAllowancePossibleAnswer };

export type HITLResponseHandler = (correlationId: string | number, response: HITLResponse) => void;

/**
 * Adapters own the communication layer. They receive HITL requests from the
 * singular `HITL` class and must call the handler provided via `onResponse`
 * when the frontend/client answers.
 */
export interface HITLAdapter {
    /**
     * Send a HITL request to the UI/client.
     * Include `correlationId` in the message so the response can be matched.
     */
    send(correlationId: string | number, request: HITLRequest): void;

    /**
     * Register the handler that the adapter must call when a response arrives.
     * The adapter is responsible for wiring its transport events into this handler.
     */
    onResponse(handler: HITLResponseHandler): void;
}

export interface HITLConfig extends HITLConfigSchema {
    /** Communication adapter that wires HITL to your UI/client. */
    adapter: HITLAdapter;
    /** Apply to get register about responses and emissions on events */
    listeners?: {
        /** Emitted before sent the hitl event to the adapter that is supposed to send this to client
         * 
         * Return void / undefined / null - to don't change anything
         * Return new body to change what will be send
        */
        onBeforeSent?: (id: number, request: HITLRequest) => (void | { id: number; request: HITLRequest }) | Promise<void | { id: number; request: HITLRequest }>;
        /** Emitted once HTIL Request was sent from HITL to the adapter */
        onSent?: (id: number, request: HITLRequest) => void | Promise<void>;
        /** Emitted once Response was retrived from the client side */
        onResponse?: (correlationId: string | number, response: HITLResponse) => void | Promise<void>;
        /** Emitted when a tool approval delayMs timeout passes.
         *
         * `defaultAnswerUsed` is `true` when a defaultAnswer was configured and applied.
         * `defaultAnswerUsed` is `false` when the timeout passed without a configured defaultAnswer (the approval will reject).
         */
        onDelayPass?: (
            toolName: string,
            details: { defaultAnswerUsed: boolean; defaultAnswer?: HITLToolAllowancePossibleAnswer }
        ) => void | Promise<void>;
    }
}

export type DefaultHITLEvents = HITLEventsSpecType & {
    hitl_tool_call: (tool: HITLToolInstanceProbe) => void;
    hitl_tool_result: (tool: HITLToolInstanceProbe, answer: HITLToolAllowancePossibleAnswer) => void;
    hitl_request_sent: (id: number, request: HITLRequest) => void;
    hitl_response_received: (correlationId: string | number, response: HITLResponse) => void;
    hitl_delay_passed: (toolName: string, details: { defaultAnswerUsed: boolean; defaultAnswer?: HITLToolAllowancePossibleAnswer }) => void;
    hitl_acceptance_started: (question: string) => void;
    hitl_acceptance_received: (question: string, answer: HITLToolAllowancePossibleAnswer) => void;
};

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
}

/**
 * Singular Human-In-The-Loop implementation.
 *
 * The `HITL` class owns all HITL business logic (tool approvals, questions,
 * prompts, timeouts). Communication details are delegated to the configured
 * `HITLAdapter`, which keeps the core class small and makes it easy to plug in
 * Socket.io, Electron IPC, Tauri sidecars, WebSockets, or any custom channel.
 */
export class HITL<HITLEvents extends DefaultHITLEvents, Config extends HITLConfig = HITLConfig> implements HITLTransportSchema<HITLEvents> {
    config: Config;
    questionHITLPrompt: string;

    private adapter: HITLAdapter;
    private pending = new Map<string | number, PendingRequest>();
    private correlationIdCounter = 0;
    private eventListeners = new Map<keyof HITLEvents, HITLEvents[keyof HITLEvents][]>();
    private anyEventListeners: ((event: keyof HITLEvents, ...args: any[]) => void | Promise<void>)[] = [];

    constructor(config: Config) {
        this.config = config;
        this.adapter = config.adapter;
        this.questionHITLPrompt = this.buildQuestionPrompt();
        this.adapter.onResponse(this.handleResponse.bind(this));
    }

    private buildQuestionPrompt(): string {
        const abcInstruction =
            typeof this.config.questions?.abcQuestion === "object"
                ? this.config.questions.abcQuestion.instruction
                : undefined;
        const openInstruction =
            typeof this.config.questions?.openQuestion === "object"
                ? this.config.questions.openQuestion.instruction
                : undefined;
        const acceptanceInstruction =
            typeof this.config.accetpanceAsTool === "object"
                ? this.config.accetpanceAsTool.instruction
                : undefined;

        return [
            "[HITL Questioning Rules]",
            "Use HITL questioning tools only when it is strictly required to continue the task safely or accurately.",
            "Do not overwhelm the user with questions. Ask only when key information is missing and cannot be inferred from context or tool outputs.",
            "Ask one focused question at a time and keep each question concise.",
            `Use \"${HITL_ABC_QUESTION_TOOL_NAME}\" for constrained choices where options are known in advance.${abcInstruction ? ` Additional abc guidance: ${abcInstruction}` : ""}`,
            `Use \"${HITL_OPEN_QUESTION_TOOL_NAME}\" only when fixed options are not sufficient.${openInstruction ? ` Additional open-question guidance: ${openInstruction}` : ""}`,
            `Use \"${HITL_ACCEPTANCE_TOOL_NAME}\" when an action requires explicit user approval.${acceptanceInstruction ? ` Additional acceptance guidance: ${acceptanceInstruction}` : ""}`
        ].join("\n");
    }

    private generateCorrelationId(): number {
        return ++this.correlationIdCounter;
    }

    emitEvent<E extends keyof HITLEvents>(event: E, ...args: HITLEventArgs<HITLEvents, E>): void;
    emitEvent(event: keyof HITLEvents, ...args: any[]): void {
        this.dispatchEvent(event, ...args);
    }

    private dispatchEvent(event: keyof HITLEvents, ...args: any[]): void {
        for (const listener of this.eventListeners.get(event) ?? []) {
            (listener as (...args: any[]) => void | Promise<void>)(...args);
        }
        for (const listener of this.anyEventListeners) {
            listener(event, ...args);
        }
    }

    onAnyEvent(handler: <E extends keyof HITLEvents>(event: E, ...args: HITLEventArgs<HITLEvents, E>) => void | Promise<void>): void {
        this.anyEventListeners.push(handler);
    }

    onEvent<E extends keyof HITLEvents>(event: E, listener: HITLEvents[E]): void {
        let listeners = this.eventListeners.get(event);
        if (!listeners) {
            listeners = [];
            this.eventListeners.set(event, listeners);
        }
        listeners.push(listener);
    }

    /**
     * Dispatch a HITL request to the adapter, register a pending promise, and
     * notify the `onBeforeSent` / `onSent` listeners. Returns both the
     * correlation id and the promise that resolves when the response arrives.
     */
    private async dispatchRequest<T>(request: HITLRequest): Promise<{ id: number; responsePromise: Promise<T> }> {
        let id = this.generateCorrelationId();

        const onBeforeSent = this.config.listeners?.onBeforeSent;
        const beforeSendResult = onBeforeSent
            ? await onBeforeSent(id, request)
            : undefined;
        if (typeof beforeSendResult === "object" && beforeSendResult) {
            id = beforeSendResult.id;
            request = beforeSendResult.request;
        }

        const responsePromise = new Promise<T>((resolve, reject) => {
            this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        });

        this.adapter.send(id, request);
        this.config.listeners?.onSent?.(id, request);
        this.dispatchEvent("hitl_request_sent", id, request);

        return { id, responsePromise };
    }

    /**
     * Send the hitl event to the adapter that transports this to the client
     * @param request
     * @returns
     */
    private async sendRequest<T>(request: HITLRequest): Promise<T> {
        const { responsePromise } = await this.dispatchRequest<T>(request);
        return responsePromise;
    }

    /**
     * Resolve a pending HITL request with a response from the UI/client.
     * 
     * Use to manually handle the response
     *
     * Adapters registered via `onResponse` do not need to call this directly;
     * they receive a handler from the `HITL` constructor. This method is public
     * so custom adapters that prefer a direct reference can use it.
     */
    handleResponse(correlationId: string | number, response: HITLResponse): void {
        const pending = this.pending.get(correlationId);
        if (!pending) {
            return;
        }

        this.pending.delete(correlationId);
        pending.resolve(response);
        this.config.listeners?.onResponse?.(correlationId, response);
        this.dispatchEvent("hitl_response_received", correlationId, response);
    }

    /**
     * Used by ReActAgent and other agents to handle the `HITL` tools and acceptance emission
     * @param toolName 
     * @returns 
     */
    async emitToolUsage(tool: HITLToolInstanceProbe): Promise<EmitToolUsageBody> {
        this.dispatchEvent("hitl_start");
        this.dispatchEvent("hitl_tool_call", tool);
        
        const toolName = tool.toolInstance.toolConfig.toolName;
        const toolConf = this.config.toolsUsage?.[toolName];
        const delayMs = typeof toolConf === "object" ? toolConf.delayMs : undefined;
        const defaultAnswer = typeof toolConf === "object" ? toolConf.defaultAnswer : undefined;

        const { id, responsePromise } = await this.dispatchRequest<{ answer: HITLToolAllowancePossibleAnswer }>({
            type: "tool-approval",
            toolName,
            toolInstance: tool.toolInstance,
            params: tool.params
        });

        let settled = false;

        return new Promise((resolve, reject) => {
            responsePromise
                .then((response) => {
                    if (settled) return;
                    settled = true;
                    this.pending.delete(id);
                    this.dispatchEvent("hitl_tool_result", tool, response.answer);
                    this.dispatchEvent("hitl_end");
                    resolve({ answer: response.answer, reason: "user_answer" });
                })
                .catch(reject);

            if (delayMs) {
                setTimeout(async () => {
                    if (settled) return;
                    settled = true;
                    this.pending.delete(id);
                    if (defaultAnswer) {
                        await this.config.listeners?.onDelayPass?.(toolName, { defaultAnswerUsed: true, defaultAnswer });
                        this.dispatchEvent("hitl_delay_passed", toolName, { defaultAnswerUsed: true, defaultAnswer });
                        this.dispatchEvent("hitl_tool_result", tool, defaultAnswer);
                        this.dispatchEvent("hitl_end");
                        resolve({ answer: defaultAnswer, reason: "delay_pass" });
                    } else {
                        await this.config.listeners?.onDelayPass?.(toolName, { defaultAnswerUsed: false });
                        this.dispatchEvent("hitl_delay_passed", toolName, { defaultAnswerUsed: false });
                        this.dispatchEvent("hitl_end");
                        reject(new Error(`HITL approval for tool "${toolName}" timed out without a configured defaultAnswer`));
                    }
                }, delayMs);
            }
        });
    }

    async emitAbcQuestion(question: string, abcOptions: [string, string][]): Promise<[string, string]> {
        this.dispatchEvent("hitl_start");
        const allowedOptions =
            typeof this.config.questions?.abcQuestion === "object"
                ? this.config.questions.abcQuestion.maxAnswersRange
                : DEFAULT_ABC_ANSWERS_RANGE;

        const optionLetters = abcOptions.map(([letter]) => letter);
        const areInRange = optionLetters.every((option) =>
            (allowedOptions ?? DEFAULT_ABC_ANSWERS_RANGE).includes(option)
        );

        if (!areInRange) {
            throw new Error("options_not_in_range");
        }

        const response = await this.sendRequest<{ option: string; optionLabel: string }>({
            type: "abc-question",
            question,
            options: abcOptions
        });

        this.dispatchEvent("hitl_end");
        return [response.option, response.optionLabel];
    }

    async emitOpenQuestion(question: string): Promise<string> {
        this.dispatchEvent("hitl_start");
        const response = await this.sendRequest<{ answer: string }>({
            type: "open-question",
            question
        });

        this.dispatchEvent("hitl_end");
        return response.answer;
    }

    /**
     * Emit manually from logic or by an agent when action requires the acceptance (y/N)
     * ## Usecases:
     *  - Accept action like command execution
     *
     * ### EdgeCases
     * - Emitted from the `skills` when the command is planned to be executed
     * @param question 
     * @param context 
     * @returns 
     */
    async emitAcceptance(question: string, context?: string | undefined, ): Promise<HITLToolAllowancePossibleAnswer> {
        this.dispatchEvent("hitl_acceptance_started", question);
        this.dispatchEvent("hitl_start");
        const response = await this.sendRequest<{ answer: HITLToolAllowancePossibleAnswer }>({
            type: "acceptance",
            question,
            context
        });

        this.dispatchEvent("hitl_acceptance_received", question, response.answer);
        this.dispatchEvent("hitl_end");
        return response.answer;
    }

    createQuestionTools(): Tool<any, any>[] {
        const questionTools: Tool<any, any>[] = [];
        const canAskAbcQuestion = !!this.config.questions?.abcQuestion;
        const canAskOpenQuestion = !!this.config.questions?.openQuestion;
        const canUseAcceptanceAsATool = this.config?.accetpanceAsTool;

        if (canAskAbcQuestion) {
            questionTools.push(
                tool(
                    async ({ question, options }) => {
                        const answer = await this.emitAbcQuestion(question, options);
                        return JSON.stringify({
                            option: answer[0],
                            optionLabel: answer[1]
                        });
                    },
                    {
                        toolName: HITL_ABC_QUESTION_TOOL_NAME,
                        toolDescription: "Ask user a single-choice HITL question with predefined options and wait for answer.",
                        toolArguments: z.object({
                            question: z.string().min(1).describe("Question text shown to user. Keep it short and specific to one decision."),
                            options: z.array(
                                z.tuple([
                                    z.string().min(1).describe("Option key used by user selection, usually a single letter like a/b/c."),
                                    z.string().min(1).describe("Option label shown to user as the meaning of the option key.")
                                ]).describe("A single selectable option tuple in format [optionKey, optionLabel].")
                            ).min(2).describe("Available single-select options passed to user.")
                        }),
                        toolOutputSchema: z.object({
                            option: z.string().describe("Selected option key returned by user."),
                            optionLabel: z.string().describe("Selected option label returned by user.")
                        })
                    }
                )
            );
        }

        if (canAskOpenQuestion) {
            questionTools.push(
                tool(
                    async ({ question }) => {
                        const answer = await this.emitOpenQuestion(question);
                        return JSON.stringify({ answer });
                    },
                    {
                        toolName: HITL_OPEN_QUESTION_TOOL_NAME,
                        toolDescription: "Ask user an open HITL question and wait for a free-text answer.",
                        toolArguments: z.object({
                            question: z.string().min(1).describe("Open question text shown to user when predefined options are insufficient.")
                        }),
                        toolOutputSchema: z.object({
                            answer: z.string().describe("Free-text answer returned by user.")
                        })
                    }
                )
            );
        }

        if (canUseAcceptanceAsATool) {
            questionTools.push(
                tool(
                    async ({ question, context }) => {
                        const answer = await this.emitAcceptance(question, context);
                        return JSON.stringify({ answer });
                    },
                    {
                        toolName: HITL_ACCEPTANCE_TOOL_NAME,
                        toolDescription: "Ask the user for approval of an action and wait for an allow or deny answer.",
                        toolArguments: z.object({
                            question: z.string().min(1).describe("Acceptance question shown to the user."),
                            context: z.string().optional().describe("Optional context explaining the action requiring acceptance.")
                        }),
                        toolOutputSchema: z.object({
                            answer: z.enum(["allow", "deny"]).describe("The user's acceptance decision.")
                        })
                    }
                )
            );
        }

        return questionTools;
    }
}
