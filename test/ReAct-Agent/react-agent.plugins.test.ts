import { describe, expect, it, vi } from "vitest";
import { ReActAgent, ReActAgentPluginSpec } from "../../src/agent/ReAct.agent";
import { Google } from "../../src/models/google";

describe("ReActAgent Plugins", () => {
    it("executes plugins in the correct order and preserves state changes", async () => {
        const executionOrder: string[] = [];
        
        const beforePlugin: ReActAgentPluginSpec = {
            name: "before-plugin",
            executionWay: "before_agent_run",
            execute: async (from, config, state) => {
                executionOrder.push("before");
                return {
                    status: true,
                    result: {
                        graphState: { ...state, injectedByBefore: true }
                    }
                };
            }
        };

        const afterPlugin: ReActAgentPluginSpec = {
            name: "after-plugin",
            executionWay: "after_agent_run",
            execute: async (from, config, state) => {
                executionOrder.push("after");
                return {
                    status: true,
                    result: {
                        graphState: { ...state, injectedByAfter: true }
                    }
                };
            }
        };

        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: "test"
        });

        vi.spyOn(model, "invoke").mockResolvedValue({
            messages: [],
            answer: [{ type: "ai", content: "Hello" }],
            tokens: { input: 0, output: 0, reasoning: 0 }
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "test",
            messages: [{ type: "user", content: "test" }],
            tools: [],
            plugins: [beforePlugin, afterPlugin]
        });

        const result = await agent.invoke();

        // Check execution order
        expect(executionOrder).toEqual(["before", "after"]);

        // Check state persistence from "before" plugin
        expect(result.state.injectedByBefore).toBe(true);

        // Check state persistence from "after" plugin
        expect(result.state.injectedByAfter).toBe(true);
    });

    it("executes tool plugins (before_tool_invoked, after_tool_result) with execution place context", async () => {
        const events: { way: string; toolName?: string; toolParams?: any; toolOutput?: string }[] = [];

        const toolPlugin: ReActAgentPluginSpec = {
            name: "tool-plugin",
            executionWay: ["before_tool_invoked", "after_tool_result"],
            execute: async (from) => {
                events.push({
                    way: from.way,
                    toolName: from.toolName,
                    toolParams: from.toolParams,
                    toolOutput: from.toolOutput
                });
                return { status: true };
            }
        };

        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: "test"
        });

        const testTool = {
            toolConfig: { toolName: "get_weather", toolDescription: "Get weather" },
            invoke: vi.fn().mockResolvedValue("Sunny 25C")
        } as any;

        let callCount = 0;
        vi.spyOn(model, "invoke").mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return {
                    messages: [],
                    answer: [{
                        type: "ai",
                        content: "",
                        calledTools: [{ tool_id: "call_1", tool_name: "get_weather", arguments: { city: "London" } }]
                    }],
                    tokens: { input: 0, output: 0, reasoning: 0 }
                };
            }
            return {
                messages: [],
                answer: [{ type: "ai", content: "The weather in London is sunny." }],
                tokens: { input: 0, output: 0, reasoning: 0 }
            };
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "test",
            messages: [{ type: "user", content: "weather in London?" }],
            tools: [testTool],
            plugins: [toolPlugin]
        });

        await agent.invoke();

        expect(events).toEqual([
            {
                way: "before_tool_invoked",
                toolName: "get_weather",
                toolParams: { city: "London" },
                toolOutput: undefined
            },
            {
                way: "after_tool_result",
                toolName: "get_weather",
                toolParams: { city: "London" },
                toolOutput: "Sunny 25C"
            }
        ]);
    });

    it("executes thought plugins with thought context", async () => {
        const thoughtsLogged: { way: string; thought?: string }[] = [];

        const thoughtPlugin: ReActAgentPluginSpec = {
            name: "thought-plugin",
            executionWay: "thought",
            execute: async (from) => {
                thoughtsLogged.push({
                    way: from.way,
                    thought: from.thought
                });
                return { status: true };
            }
        };

        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: "test"
        });

        vi.spyOn(model, "invoke").mockResolvedValue({
            messages: [],
            answer: [
                { type: "thinking", content: "I should analyze the input" },
                { type: "ai", content: "Analyzed." }
            ],
            tokens: { input: 0, output: 0, reasoning: 0 }
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "test",
            messages: [{ type: "user", content: "hello" }],
            tools: [],
            plugins: [thoughtPlugin]
        });

        await agent.invoke();

        expect(thoughtsLogged).toEqual([
            {
                way: "thought",
                thought: "I should analyze the input"
            }
        ]);
    });

    it("executes memory plugins with memory position context", async () => {
        const memoryEvents: { way: string; memoryPosition?: number }[] = [];

        const memoryPlugin: ReActAgentPluginSpec = {
            name: "memory-plugin",
            executionWay: "memory",
            execute: async (from) => {
                memoryEvents.push({
                    way: from.way,
                    memoryPosition: from.memoryPosition
                });
                return { status: true };
            }
        };

        const dummyStore1: any = {
            config: {},
            fetchMemory: async () => [],
            saveMemory: async () => true,
            fetchMemoryConclusionFile: async () => "Conclusion 1"
        };

        const dummyStore2: any = {
            config: {},
            fetchMemory: async () => [],
            saveMemory: async () => true,
            fetchMemoryConclusionFile: async () => "Conclusion 2"
        };

        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: "test"
        });

        vi.spyOn(model, "invoke").mockResolvedValue({
            messages: [],
            answer: [{ type: "ai", content: "Done" }],
            tokens: { input: 0, output: 0, reasoning: 0 }
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "test",
            messages: [{ type: "user", content: "test" }],
            tools: [],
            memory: [
                { memory: dummyStore1, name: "mem1" },
                { memory: dummyStore2, name: "mem2" }
            ],
            plugins: [memoryPlugin]
        });

        await agent.invoke();

        expect(memoryEvents).toEqual([
            { way: "memory", memoryPosition: 0 },
            { way: "memory", memoryPosition: 1 }
        ]);
    });

    it("executes subagent plugins (subagent_invoked, subagent_result, subagent_thought) with execution place context", async () => {
        const subagentEvents: { way: string; subagentRole?: string; subagentInstruction?: string; thought?: string }[] = [];

        const subagentPlugin: ReActAgentPluginSpec = {
            name: "subagent-plugin",
            executionWay: ["subagent_invoked", "subagent_result", "subagent_thought"],
            execute: async (from) => {
                subagentEvents.push({
                    way: from.way,
                    subagentRole: from.subagentRole,
                    subagentInstruction: from.subagentInstruction,
                    thought: from.thought
                });
                return { status: true };
            }
        };

        const masterModel = new Google({
            model: "gemini-3-flash-preview",
            apiKey: "test"
        });

        const subagentModel = new Google({
            model: "gemini-3-flash-preview",
            apiKey: "test"
        });

        let masterCallCount = 0;
        vi.spyOn(masterModel, "invoke").mockImplementation(async () => {
            masterCallCount++;
            if (masterCallCount === 1) {
                return {
                    messages: [],
                    answer: [{ type: "ai", content: "[[RAVEN_CALL_SUBAGENT]] Researcher | Research quantum computing" }],
                    tokens: { input: 0, output: 0, reasoning: 0 }
                };
            }
            return {
                messages: [],
                answer: [{ type: "ai", content: "Final answer based on subagent research." }],
                tokens: { input: 0, output: 0, reasoning: 0 }
            };
        });

        vi.spyOn(subagentModel, "invoke").mockResolvedValue({
            messages: [],
            answer: [
                { type: "thinking", content: "Analyzing quantum topics" },
                { type: "ai", content: "Research completed." }
            ],
            tokens: { input: 0, output: 0, reasoning: 0 }
        });

        const agent = new ReActAgent({
            model: masterModel,
            systemPrompt: "test",
            messages: [{ type: "user", content: "research quantum computing" }],
            tools: [],
            subagents: [
                {
                    role: "Researcher",
                    roleDescription: "Researches topic",
                    model: subagentModel,
                    systemPrompt: "Subagent prompt",
                    tools: []
                }
            ],
            plugins: [subagentPlugin],
            withConclusion: false
        });

        await agent.invoke();

        expect(subagentEvents).toEqual([
            {
                way: "subagent_invoked",
                subagentRole: "Researcher",
                subagentInstruction: "Research quantum computing",
                thought: undefined
            },
            {
                way: "subagent_thought",
                subagentRole: "Researcher",
                subagentInstruction: undefined,
                thought: "Analyzing quantum topics"
            },
            {
                way: "subagent_result",
                subagentRole: "Researcher",
                subagentInstruction: "Research quantum computing",
                thought: undefined
            }
        ]);
    });
});
