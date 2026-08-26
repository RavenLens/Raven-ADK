import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReActAgent, ReActAgentPluginSpec, SubAgentAsFn } from "../../src/agent/ReAct.agent";
import { OpenAI } from "../../src/models/text-to-text/openai";
import { tool } from "../../src/agent/tools/tools";
import { AIMessage } from "../../src/agent/state";

const openaiApiKey = process.env.OPENAI_API_KEY?.trim();

const makeModel = (structuredOutput: any) => {
    const model = new OpenAI({
        model: "gpt-5-mini",
        apiKey: openaiApiKey!
    });

    vi.spyOn(model, "invoke").mockImplementation(async (options) => {
        const currentMessages = options?.messages || model.config.messages || [];
        const aiMessage = {
            type: "ai" as const,
            content: "I have gathered all the information needed."
        };
        return {
            messages: [...currentMessages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 10, output: 5, reasoning: 0 }
        };
    });

    vi.spyOn(model, "invokeStructuredOutput").mockImplementation(async (_schema: z.ZodTypeAny, _maxRetries?: number) => {
        const aiMessage = {
            type: "ai" as const,
            content: JSON.stringify(structuredOutput),
            structuredOutput
        };
        return {
            messages: [...(model.config.messages ?? []), aiMessage],
            answer: [aiMessage],
            tokens: { input: 8, output: 4, reasoning: 0 }
        };
    });

    return model;
};

describe("ReActAgent subagents", () => {
    it("can call a subagent using [[RAVEN_CALL_SUBAGENT]]", async () => {
        let callCount = 0;
        const mainModel = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });

        vi.spyOn(mainModel, "invoke").mockImplementation(async (options) => {
            const currentMessages = options?.messages || mainModel.config.messages || [];
            callCount++;
            if (callCount === 1) {
                // First invoke, return subagent call
                const aiMessage = {
                    type: "ai" as const,
                    content: "[[RAVEN_CALL_SUBAGENT]] Researcher | Find information about Mars."
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            } else {
                // Third invoke (after subagent returns), conclude
                const aiMessage = {
                    type: "ai" as const,
                    content: "The researcher found the info. Mars is a planet."
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            }
        });

        const subModel = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });

        vi.spyOn(subModel, "invoke").mockImplementation(async (options) => {
            const currentMessages = options?.messages || subModel.config.messages || [];
            // Subagent invoke
            const aiMessage = {
                type: "ai" as const,
                content: "Mars is the fourth planet from the Sun."
            };
            return {
                messages: [...currentMessages, aiMessage],
                answer: [aiMessage],
                tokens: { input: 20, output: 10, reasoning: 0 }
            };
        });

        const agent = new ReActAgent({
            model: mainModel,
            systemPrompt: "You are the main agent.",
            messages: [{ type: "user", content: "Tell me about Mars." }],
            tools: [],
            withConclusion: false,
            subagents: [{
                role: "Researcher",
                roleDescription: "Searches for info",
                model: subModel,
                systemPrompt: "You are a researcher.",
                tools: []
            }]
        });

        const result = await agent.invoke();

        // Ensure main model was called twice (once to decide subagent, once to finalize)
        expect(mainModel.invoke).toHaveBeenCalledTimes(2);
        
        // Ensure sub model was called once since subagent has withConclusion: false
        expect(subModel.invoke).toHaveBeenCalledTimes(1);

        // Verify state traces
        expect(result.messages.some(m => m.type === "user" && m.content === "[CALLING SUBAGENT: Researcher] Task: Find information about Mars.")).toBe(true);
        expect(result.messages.at(-1)?.content).toBe("The researcher found the info. Mars is a planet.");
        
        // Tokens should be accumulated
        // mainModel: 2 invokes = 2 * (10, 5) = (20, 10).
        // subagent: 1 invoke = (20, 10).
        // Total should be 20+20 = 40 input, 10+10 = 20 output.
        expect(agent.usedTokens.input).toBe(40);
        expect(agent.usedTokens.output).toBe(20);
    });
});

describe("ReActAgent structured output", () => {
    it("returns the structured output on the final AI message", async () => {
        const structuredOutput = { city: "Paris", country: "France" };
        const model = makeModel(structuredOutput);

        const agent = new ReActAgent({
            model: model,
            systemPrompt: "You are a structured-output agent.",
            messages: [{ type: "user", content: "Return the target city and country." }],
            tools: [],
            withConclusion: false
        });

        const schema = z.object({ city: z.string(), country: z.string() });
        const result = await agent.invokeStructuredOutput(schema, 2);

        expect(model.invokeStructuredOutput).toHaveBeenCalledWith(schema, 2);
        expect(result.messages.at(-1)).toMatchObject({
            type: "ai",
            content: JSON.stringify(structuredOutput),
            structuredOutput
        });
        expect(result.messages.some((m) => m.type === "system")).toBe(true);
        expect(result.state).toBeDefined();
    });

    it("concludeWithStructuredOutput uses retriesCount from graph state", async () => {
        const structuredOutput = { name: "Alice", age: 30 };
        const model = makeModel(structuredOutput);

        const agent = new ReActAgent({
            model: model,
            systemPrompt: "Extract structured data.",
            messages: [{ type: "user", content: "Who is the person mentioned?" }],
            tools: [],
            withConclusion: false
        });

        const schema = z.object({ name: z.string(), age: z.number() });
        const result = await agent.invokeStructuredOutput(schema, 4);

        // main_node invokes the model first for normal reasoning
        expect(model.invoke).toHaveBeenCalledOnce();

        // concludeWithStructuredOutput calls invokeStructuredOutput with the schema and retriesCount
        expect(model.invokeStructuredOutput).toHaveBeenCalledOnce();
        expect(model.invokeStructuredOutput).toHaveBeenCalledWith(schema, 4);

        // the final message carries structuredOutput
        const lastMessage = result.messages.at(-1);
        expect(lastMessage?.type).toBe("ai");
        expect((lastMessage as AIMessage).structuredOutput).toEqual(structuredOutput);
    });

    it("preserves model config after concludeWithStructuredOutput", async () => {
        const structuredOutput = { status: "done" };
        const model = makeModel(structuredOutput);

        const originalTools = [
            tool(async () => "result", {
                toolName: "my_tool",
                toolDescription: "A test tool",
                toolArguments: z.object({})
            })
        ];
        const agent = new ReActAgent({
            model: model,
            systemPrompt: "Agent with tools.",
            messages: [{ type: "user", content: "Do the thing." }],
            tools: originalTools,
            withConclusion: false
        });

        const schema = z.object({ status: z.string() });
        await agent.invokeStructuredOutput(schema, 3);

        // model config is restored to original tools after concludeWithStructuredOutput
        expect(model.config.tools).toEqual(originalTools);
    });
});

describe("ReActAgent parallel subagents", () => {
    it("can run multiple subagents in parallel", async () => {
        const mainModel = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });

        let mainCallCount = 0;
        vi.spyOn(mainModel, "invoke").mockImplementation(async (options) => {
            const currentMessages = options?.messages || mainModel.config.messages || [];
            mainCallCount++;
            if (mainCallCount === 1) {
                const aiMessage = {
                    type: "ai" as const,
                    content: "[[RAVEN_CALL_SUBAGENT]] Researcher | Mars data\n[[RAVEN_CALL_SUBAGENT]] Analyst | Compare data"
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            } else {
                const aiMessage = {
                    type: "ai" as const,
                    content: "Done processing."
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            }
        });

        const subModel = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });

        vi.spyOn(subModel, "invoke").mockImplementation(async (options) => {
            const currentMessages = options?.messages || subModel.config.messages || [];
            const aiMessage = {
                type: "ai" as const,
                content: "Subagent content."
            };
            return {
                messages: [...currentMessages, aiMessage],
                answer: [aiMessage],
                tokens: { input: 20, output: 10, reasoning: 0 }
            };
        });

        const agent = new ReActAgent({
            model: mainModel,
            systemPrompt: "Main",
            messages: [{ type: "user", content: "Go" }],
            tools: [],
            withConclusion: false,
            parallelizeSubagents: true,
            subagents: [
                {
                    role: "Researcher",
                    roleDescription: "R",
                    model: subModel,
                    systemPrompt: "R Prompt",
                    tools: []
                },
                {
                    role: "Analyst",
                    roleDescription: "A",
                    model: subModel,
                    systemPrompt: "A Prompt",
                    tools: []
                }
            ]
        });

        const result = await agent.invoke();

        // One to spark both parallel subagents, one final pass after both completed
        expect(mainModel.invoke).toHaveBeenCalledTimes(2);
        // Each subagent called model once
        expect(subModel.invoke).toHaveBeenCalledTimes(2);

        // BOTH calling traces must be in messages
        expect(result.messages.some(m => m.type === "user" && m.content === "[CALLING SUBAGENT: Researcher] Task: Mars data")).toBe(true);
        expect(result.messages.some(m => m.type === "user" && m.content === "[CALLING SUBAGENT: Analyst] Task: Compare data")).toBe(true);
        
        // Assert that tokens are aggregated from all runs
        // mainModel: 2 * (10, 5) = (20, 10)
        // subagent: 2 * (20, 10) = (40, 20)
        expect(agent.usedTokens.input).toBe(60);
        expect(agent.usedTokens.output).toBe(30);
    });

    it("can run a function subagent in parallel", async () => {
        const mainModel = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });

        let mainCallCount = 0;
        vi.spyOn(mainModel, "invoke").mockImplementation(async (options) => {
            const currentMessages = options?.messages || mainModel.config.messages || [];
            mainCallCount++;
            if (mainCallCount === 1) {
                const aiMessage = {
                    type: "ai" as const,
                    content: "[[RAVEN_CALL_SUBAGENT]] FunctionWorker | Do custom work"
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            } else {
                const aiMessage = {
                    type: "ai" as const,
                    content: "Done."
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            }
        });

        const pluginCalls: string[] = [];
        const testPlugin: ReActAgentPluginSpec = {
            name: "test-plugin",
            executionWay: ["before_model_call", "after_model_call"],
            execute: async (executionFrom) => {
                pluginCalls.push(`${executionFrom.way}:${executionFrom.nodeType}:${executionFrom.nodeName}`);
                return { status: true };
            }
        };

        let eventEmitted = false;
        const functionSubagent: SubAgentAsFn<"llm_result"> = {
            role: "FunctionWorker",
            roleDescription: "Executes custom logic",
            fn: (state, utils) => {
                const aiMessage = {
                    type: "ai" as const,
                    content: "Custom function result."
                };
                const newMessages = [...state.messages, aiMessage];
                utils?.emitEvent("llm_result", {
                    messages: newMessages,
                    answer: [aiMessage],
                    tokens: { input: 15, output: 8, reasoning: 0 }
                });
                eventEmitted = true;
                return {
                    messages: newMessages,
                    state: {}
                };
            }
        };

        const agent = new ReActAgent({
            model: mainModel,
            systemPrompt: "Main",
            messages: [{ type: "user", content: "Go" }],
            tools: [],
            withConclusion: false,
            parallelizeSubagents: true,
            plugins: [testPlugin],
            subagents: [functionSubagent]
        });

        const result = await agent.invoke();

        expect(mainModel.invoke).toHaveBeenCalledTimes(2);
        expect(eventEmitted).toBe(true);
        expect(result.messages.some(m => m.type === "user" && m.content === "[CALLING SUBAGENT: FunctionWorker] Task: Do custom work")).toBe(true);
        expect(result.messages.some(m => m.type === "ai" && m.content === "Custom function result.")).toBe(true);

        // Plugins should run for the function subagent (before/after model_call)
        expect(pluginCalls).toContain("before_model_call:subagent:FunctionWorker");
        expect(pluginCalls).toContain("after_model_call:subagent:FunctionWorker");

        // Tokens: main model 2 * (10, 5) + function subagent (15, 8)
        expect(agent.usedTokens.input).toBe(35);
        expect(agent.usedTokens.output).toBe(18);
    });
});

describe("ReActAgent parallel tools", () => {
    it("can run tools sequentially when parallelTools is false (default)", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });

        let callCount = 0;
        vi.spyOn(model, "invoke").mockImplementation(async (options) => {
            const currentMessages = options?.messages || model.config.messages || [];
            callCount++;
            if (callCount === 1) {
                const aiMessage = {
                    type: "ai" as const,
                    content: "Calling tools.",
                    calledTools: [
                        { type: "tool", tool_id: "call_t1", tool_name: "tool1", arguments: {}, content: "" },
                        { type: "tool", tool_id: "call_t2", tool_name: "tool2", arguments: {}, content: "" }
                    ]
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            } else {
                const aiMessage = { type: "ai" as const, content: "Done." };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            }
        });

        const timeline: string[] = [];
        const tool1 = tool(async () => {
            timeline.push("t1_start");
            await new Promise(r => setTimeout(() => r(null), 10));
            timeline.push("t1_end");
            return "res1";
        }, {
            toolName: "tool1",
            toolDescription: "T1",
            toolArguments: z.object({})
        });

        const tool2 = tool(async () => {
            timeline.push("t2_start");
            await new Promise(r => setTimeout(() => r(null), 5));
            timeline.push("t2_end");
            return "res2";
        }, {
            toolName: "tool2",
            toolDescription: "T2",
            toolArguments: z.object({})
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "T",
            messages: [{ type: "user", content: "Go" }],
            tools: [tool1, tool2],
            withConclusion: false,
            parallelTools: false // Sequential by default
        });

        await agent.invoke();

        // Must run sequentially: tool1 must start/finish before tool2 starts
        expect(timeline).toEqual(["t1_start", "t1_end", "t2_start", "t2_end"]);
    });

    it("can run tools in parallel when parallelTools is true", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });

        let callCount = 0;
        vi.spyOn(model, "invoke").mockImplementation(async (options) => {
            const currentMessages = options?.messages || model.config.messages || [];
            callCount++;
            if (callCount === 1) {
                const aiMessage = {
                    type: "ai" as const,
                    content: "Calling tools.",
                    calledTools: [
                        { type: "tool", tool_id: "call_t1", tool_name: "tool1", arguments: {}, content: "" },
                        { type: "tool", tool_id: "call_t2", tool_name: "tool2", arguments: {}, content: "" }
                    ]
                };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            } else {
                const aiMessage = { type: "ai" as const, content: "Done." };
                return {
                    messages: [...currentMessages, aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            }
        });

        const timeline: string[] = [];
        const tool1 = tool(async () => {
            timeline.push("t1_start");
            await new Promise(r => setTimeout(() => r(null), 20));
            timeline.push("t1_end");
            return "res1";
        }, {
            toolName: "tool1",
            toolDescription: "T1",
            toolArguments: z.object({})
        });

        const tool2 = tool(async () => {
            timeline.push("t2_start");
            await new Promise(r => setTimeout(() => r(null), 5));
            timeline.push("t2_end");
            return "res2";
        }, {
            toolName: "tool2",
            toolDescription: "T2",
            toolArguments: z.object({})
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "T",
            messages: [{ type: "user", content: "Go" }],
            tools: [tool1, tool2],
            withConclusion: false,
            parallelTools: true // Parallel
        });

        await agent.invoke();

        // Since they run in parallel, tool2 starts BEFORE tool1 ends, and tool2 finishes first
        expect(timeline).toEqual(["t1_start", "t2_start", "t2_end", "t1_end"]);
    });
});

describe("ReActAgent abort", () => {
    it("returns an aborted state without invoking the model when already aborted", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });
        const invoke = vi.spyOn(model, "invoke");
        const abortController = new AbortController();
        abortController.abort();

        const agent = new ReActAgent({
            model,
            systemPrompt: "Abortable agent",
            messages: [{ type: "user", content: "Do not run" }],
            tools: [],
            withConclusion: false,
            abort: abortController.signal
        });
        const abortListener = vi.fn();
        agent.onEvent("abort", abortListener);

        const result = await agent.invoke();

        expect(invoke).not.toHaveBeenCalled();
        expect(result.state.isAborted).toBe(true);
        expect(abortListener).toHaveBeenCalledOnce();
    });

    it("returns immediately when the model is still pending", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });
        let resolveModel: ((value: any) => void) | undefined;
        vi.spyOn(model, "invoke").mockImplementation(() => new Promise((resolve) => {
            resolveModel = resolve;
        }));

        const abortController = new AbortController();
        const agent = new ReActAgent({
            model,
            systemPrompt: "Abortable agent",
            messages: [{ type: "user", content: "Wait for cancellation" }],
            tools: [],
            withConclusion: false,
            abort: abortController.signal
        });
        const abortListener = vi.fn();
        agent.onEvent("abort", abortListener);

        const invocation = agent.invoke();
        await vi.waitFor(() => expect(model.invoke).toHaveBeenCalledOnce());

        abortController.abort();
        const result = await invocation;

        expect(result.state.isAborted).toBe(true);
        expect(abortListener).toHaveBeenCalledOnce();

        resolveModel?.({
            messages: agent.messages,
            answer: [{ type: "ai", content: "Late model result" }],
            tokens: { input: 1, output: 1, reasoning: 0 }
        });
    });

    it("ignores an in-flight tool result and does not start another model turn", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!
        });
        let modelCallCount = 0;
        vi.spyOn(model, "invoke").mockImplementation(async (options) => {
            modelCallCount += 1;
            const currentMessages = options?.messages || model.config.messages || [];
            const aiMessage = modelCallCount === 1
                ? {
                    type: "ai" as const,
                    content: "Calling a tool.",
                    calledTools: [
                        { type: "tool" as const, tool_id: "call_pending", tool_name: "pending_tool", arguments: {}, content: "" }
                    ]
                }
                : { type: "ai" as const, content: "Done." };

            return {
                messages: [...currentMessages, aiMessage],
                answer: [aiMessage],
                tokens: { input: 1, output: 1, reasoning: 0 }
            };
        });

        let resolveTool: ((value: string) => void) | undefined;
        const pendingTool = tool(
            () => new Promise<string>((resolve) => {
                resolveTool = resolve;
            }),
            {
                toolName: "pending_tool",
                toolDescription: "A pending tool",
                toolArguments: z.object({})
            }
        );

        const abortController = new AbortController();
        const agent = new ReActAgent({
            model,
            systemPrompt: "Abortable agent",
            messages: [{ type: "user", content: "Run the pending tool" }],
            tools: [pendingTool],
            withConclusion: false,
            abort: abortController.signal
        });
        const toolInvoked = vi.fn();
        const toolExecuted = vi.fn();
        agent.onEvent("tool_invoked", toolInvoked);
        agent.onEvent("tool_executed", toolExecuted);

        const invocation = agent.invoke();
        await vi.waitFor(() => expect(toolInvoked).toHaveBeenCalledOnce());

        abortController.abort();
        const result = await invocation;

        expect(result.state.isAborted).toBe(true);
        expect(modelCallCount).toBe(1);
        expect(toolExecuted).not.toHaveBeenCalled();

        resolveTool?.("Late tool result");
    });
});