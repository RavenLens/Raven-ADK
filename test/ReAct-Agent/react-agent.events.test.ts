import { describe, expect, it, vi } from "vitest";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { OpenAI } from "../../src/models/openai";
import { tool } from "../../src/agent/tools/tools";
import { Memory } from "../../src/agent/memory/memory";
import { SchemaMemoryStore } from "../../src/agent/memory/stores/schema";
import { HITLTransportSchema, EmitToolUsageBody, HITLToolAllowancePossibleAnswer } from "../../src/agent/tools/hitl/hitlToolSchema";

describe("ReActAgent events", () => {
    describe("Subagent events", () => {
        it("emits subagent_called, subagent_reasoning, subagent_tool_invoked, subagent_tool_executed, and subagent_result", async () => {
            let mainCallCount = 0;
            const mainModel = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });

            vi.spyOn(mainModel, "invoke").mockImplementation(async (options) => {
                const currentMessages = options?.messages || mainModel.config.messages || [];
                mainCallCount++;
                if (mainCallCount === 1) {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "[[RAVEN_CALL_SUBAGENT]] Researcher | Find Mars facts"
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                } else {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "Subagent finished job."
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                }
            });

            const dummyTool = tool(
                async ({ query }) => `Info for ${query}`,
                {
                    toolName: "sub_search",
                    toolDescription: "Search tool for subagent"
                }
            );

            let subCallCount = 0;
            const subModel = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });

            vi.spyOn(subModel, "invoke").mockImplementation(async (options) => {
                const currentMessages = options?.messages || subModel.config.messages || [];
                subCallCount++;
                if (subCallCount === 1) {
                    const thinkingMsg = { type: "thinking" as const, content: "Subagent thinking process" };
                    const toolMsg = {
                        type: "ai" as const,
                        content: "",
                        calledTools: [{
                            tool_id: "call_1",
                            tool_name: "sub_search",
                            arguments: { query: "Mars" }
                        }]
                    };
                    return {
                        messages: [...currentMessages, thinkingMsg, toolMsg],
                        answer: [thinkingMsg, toolMsg],
                        tokens: { input: 5, output: 5, reasoning: 10 }
                    };
                } else {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "Mars is cold."
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 5, output: 5, reasoning: 0 }
                    };
                }
            });

            const subagentCalledEvents: any[] = [];
            const subagentResultEvents: any[] = [];
            const subagentReasoningEvents: any[] = [];
            const subagentToolInvokedEvents: any[] = [];
            const subagentToolExecutedEvents: any[] = [];

            const agent = new ReActAgent({
                model: mainModel,
                systemPrompt: "Main prompt",
                messages: [{ type: "user", content: "Tell me about Mars" }],
                tools: [],
                withConclusion: false,
                subagents: [{
                    role: "Researcher",
                    roleDescription: "Searches stuff",
                    model: subModel,
                    systemPrompt: "Sub prompt",
                    tools: [dummyTool]
                }]
            });

            agent.onEvent("subagent_called", (role, instruction) => {
                subagentCalledEvents.push({ role, instruction });
            });
            agent.onEvent("subagent_result", (role, instruction, result) => {
                subagentResultEvents.push({ role, instruction, result });
            });
            agent.onEvent("subagent_reasoning", (role, content) => {
                subagentReasoningEvents.push({ role, content });
            });
            agent.onEvent("subagent_tool_invoked", (role, toolName, toolParams) => {
                subagentToolInvokedEvents.push({ role, toolName, toolParams });
            });
            agent.onEvent("subagent_tool_executed", (role, toolName, toolParams, output) => {
                subagentToolExecutedEvents.push({ role, toolName, toolParams, output });
            });

            await agent.invoke();

            expect(subagentCalledEvents).toHaveLength(1);
            expect(subagentCalledEvents[0].role).toBe("Researcher");
            expect(subagentCalledEvents[0].instruction).toBe("Find Mars facts");

            expect(subagentReasoningEvents.length).toBeGreaterThan(0);
            expect(subagentReasoningEvents[0].role).toBe("Researcher");
            expect(subagentReasoningEvents[0].content).toContain("Subagent thinking process");

            expect(subagentToolInvokedEvents).toHaveLength(1);
            expect(subagentToolInvokedEvents[0]).toEqual({
                role: "Researcher",
                toolName: "sub_search",
                toolParams: { query: "Mars" }
            });

            expect(subagentToolExecutedEvents).toHaveLength(1);
            expect(subagentToolExecutedEvents[0].role).toBe("Researcher");
            expect(subagentToolExecutedEvents[0].toolName).toBe("sub_search");
            expect(subagentToolExecutedEvents[0].output).toBe("Info for Mars");

            expect(subagentResultEvents).toHaveLength(1);
            expect(subagentResultEvents[0].role).toBe("Researcher");
            expect(subagentResultEvents[0].instruction).toBe("Find Mars facts");
            expect(subagentResultEvents[0].result).toBeDefined();
        });
    });

    describe("HITL events", () => {
        it("emits hitl_triggered, hitl_result, hitl_tool_approval, hitl_question, and hitl_acceptance", async () => {
            const hitlTriggeredEvents: any[] = [];
            const hitlResultEvents: any[] = [];
            const hitlToolApprovalEvents: any[] = [];
            const hitlQuestionEvents: any[] = [];
            const hitlAcceptanceEvents: any[] = [];

            const mockHitlTransport: HITLTransportSchema = {
                config: {
                    questions: { abcQuestion: true, openQuestion: true },
                    toolsUsage: { "protected_tool": { delayMs: 100, defaultAnswer: "allow" } }
                },
                questionHITLPrompt: "Question prompt",
                emitToolUsage: vi.fn().mockResolvedValue({ answer: "allow", reason: "user_answer" }),
                emitAbcQuestion: vi.fn().mockResolvedValue(["a", "Option A"]),
                emitOpenQuestion: vi.fn().mockResolvedValue("User open answer"),
                emitAcceptance: vi.fn().mockResolvedValue("allow"),
                createQuestionTools() {
                    return [
                        tool(async (args) => {
                            const res = await mockHitlTransport.emitAbcQuestion!(args.question, args.options);
                            return JSON.stringify(res);
                        }, {
                            toolName: "hitl_ask_abc_question",
                            toolDescription: "Ask abc question"
                        }),
                        tool(async (args) => {
                            const res = await mockHitlTransport.emitOpenQuestion!(args.question);
                            return JSON.stringify(res);
                        }, {
                            toolName: "hitl_ask_open_question",
                            toolDescription: "Ask open question"
                        })
                    ];
                }
            };

            const protectedTool = tool(async () => "Secret action done", {
                toolName: "protected_tool",
                toolDescription: "Tool needing approval"
            });

            let callCount = 0;
            const model = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });

            vi.spyOn(model, "invoke").mockImplementation(async (options) => {
                const currentMessages = options?.messages || model.config.messages || [];
                callCount++;
                if (callCount === 1) {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "",
                        calledTools: [{
                            tool_id: "call_1",
                            tool_name: "protected_tool",
                            arguments: {}
                        }]
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                } else if (callCount === 2) {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "",
                        calledTools: [{
                            tool_id: "call_2",
                            tool_name: "hitl_ask_abc_question",
                            arguments: { question: "Choose one", options: [["a", "Option A"], ["b", "Option B"]] }
                        }]
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                } else {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "All actions completed."
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                }
            });

            const agent = new ReActAgent({
                model,
                systemPrompt: "Prompt",
                messages: [{ type: "user", content: "Perform action" }],
                tools: [protectedTool],
                hitl: mockHitlTransport,
                withConclusion: false
            });

            agent.onEvent("hitl_triggered", (type, payload) => hitlTriggeredEvents.push({ type, payload }));
            agent.onEvent("hitl_result", (type, payload, result) => hitlResultEvents.push({ type, payload, result }));
            agent.onEvent("hitl_tool_approval", (toolName, allowance) => hitlToolApprovalEvents.push({ toolName, allowance }));
            agent.onEvent("hitl_question", (questionType, question, answer) => hitlQuestionEvents.push({ questionType, question, answer }));
            agent.onEvent("hitl_acceptance", (question, answer) => hitlAcceptanceEvents.push({ question, answer }));

            await agent.invoke();

            expect(hitlTriggeredEvents.some(e => e.type === "tool_usage" && e.payload.toolName === "protected_tool" && e.payload.toolArguments)).toBe(true);
            expect(hitlResultEvents.some(e => e.type === "tool_usage" && e.payload.toolName === "protected_tool" && e.payload.toolArguments)).toBe(true);
            expect(hitlToolApprovalEvents).toHaveLength(1);
            expect(mockHitlTransport.emitToolUsage).toHaveBeenCalledWith("protected_tool", expect.any(Object));
            expect(hitlToolApprovalEvents[0]).toEqual({
                toolName: "protected_tool",
                allowance: { answer: "allow", reason: "user_answer" }
            });

            expect(hitlTriggeredEvents.some(e => e.type === "question_abc")).toBe(true);
            expect(hitlResultEvents.some(e => e.type === "question_abc")).toBe(true);
            expect(hitlQuestionEvents).toHaveLength(1);
            expect(hitlQuestionEvents[0]).toEqual({
                questionType: "abc",
                question: "Choose one",
                answer: ["a", "Option A"]
            });

            // Also test acceptance directly
            await mockHitlTransport.emitAcceptance!("Do you accept?", "context");
            expect(hitlTriggeredEvents.some(e => e.type === "acceptance" && e.payload.question === "Do you accept?")).toBe(true);
            expect(hitlAcceptanceEvents.some(e => e.question === "Do you accept?" && e.answer === "allow")).toBe(true);
        });
    });

    describe("Memory events", () => {
        it("emits memory_action, memory_fetch, memory_save, memory_get_conclusion, and memory_set_conclusion", async () => {
            const memoryActionEvents: any[] = [];
            const memoryFetchEvents: any[] = [];
            const memorySaveEvents: any[] = [];
            const memoryGetConclusionEvents: any[] = [];
            const memorySetConclusionEvents: any[] = [];

            const mockStore: SchemaMemoryStore = {
                config: { hasToRemember: "" },
                fetchMemoryConclusionFile: vi.fn().mockResolvedValue("Old conclusion"),
                writeMemoryConclusionFile: vi.fn().mockResolvedValue(true),
                fetchMemory: vi.fn().mockResolvedValue([{ id: "m1", title: "Fact 1", content: "Details", keywords: [], subMemoryIds: [] }]),
                saveMemory: vi.fn().mockResolvedValue(true)
            };

            let callCount = 0;
            const model = new OpenAI({ model: "gpt-5-mini", apiKey: "dummy" });

            vi.spyOn(model, "invoke").mockImplementation(async (options) => {
                const currentMessages = options?.messages || model.config.messages || [];
                callCount++;
                if (callCount === 1) {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "",
                        calledTools: [{
                            tool_id: "mem_fetch_1",
                            tool_name: "user_data_fetch_memory",
                            arguments: { mode: "semantic", words: ["user"] }
                        }]
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                } else if (callCount === 2) {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "",
                        calledTools: [{
                            tool_id: "mem_save_1",
                            tool_name: "user_data_save_memory",
                            arguments: {
                                record: { title: "User preference", content: "Prefers dark mode", keywords: ["theme"] }
                            }
                        }]
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                } else {
                    const aiMessage = {
                        type: "ai" as const,
                        content: "Memory retrieved and updated."
                    };
                    return {
                        messages: [...currentMessages, aiMessage],
                        answer: [aiMessage],
                        tokens: { input: 10, output: 5, reasoning: 0 }
                    };
                }
            });

            const agent = new ReActAgent({
                model,
                systemPrompt: "Memory prompt",
                messages: [{ type: "user", content: "Check memory" }],
                tools: [],
                memory: {
                    memory: mockStore,
                    name: "user_data",
                    purpose: "Store user preferences"
                },
                withConclusion: false
            });

            agent.onEvent("memory_action", (action, memoryName, details, result) => {
                memoryActionEvents.push({ action, memoryName, details, result });
            });
            agent.onEvent("memory_fetch", (memoryName, params, result) => {
                memoryFetchEvents.push({ memoryName, params, result });
            });
            agent.onEvent("memory_save", (memoryName, record, result) => {
                memorySaveEvents.push({ memoryName, record, result });
            });
            agent.onEvent("memory_get_conclusion", (memoryName, conclusion) => {
                memoryGetConclusionEvents.push({ memoryName, conclusion });
            });
            agent.onEvent("memory_set_conclusion", (memoryName, content, status) => {
                memorySetConclusionEvents.push({ memoryName, content, status });
            });

            await agent.invoke();

            // get_conclusion event should be emitted when system prompt loads memory conclusion
            expect(memoryGetConclusionEvents.length).toBeGreaterThan(0);
            expect(memoryGetConclusionEvents[0].memoryName).toBe("user_data");
            expect(memoryGetConclusionEvents[0].conclusion).toBe("Old conclusion");

            // memory_fetch event
            expect(memoryFetchEvents.length).toBe(1);
            expect(memoryFetchEvents[0].memoryName).toBe("user_data");
            expect(memoryFetchEvents[0].params.mode).toBe("semantic");

            // memory_save event
            expect(memorySaveEvents.length).toBe(1);
            expect(memorySaveEvents[0].memoryName).toBe("user_data");
            expect(memorySaveEvents[0].record.title).toBe("User preference");

            // memory_action events
            expect(memoryActionEvents.some(e => e.action === "get_conclusion")).toBe(true);
            expect(memoryActionEvents.some(e => e.action === "fetch")).toBe(true);
            expect(memoryActionEvents.some(e => e.action === "save")).toBe(true);

            // Test set_conclusion action
            const memoryInterface = Array.isArray(agent.agentMemoryInterface) ? agent.agentMemoryInterface[0] : agent.agentMemoryInterface!;
            await memoryInterface.setMemoryConclusionFile("New conclusion content");
            expect(memorySetConclusionEvents.length).toBe(1);
            expect(memorySetConclusionEvents[0]).toEqual({
                memoryName: "user_data",
                content: "New conclusion content",
                status: true
            });
            expect(memoryActionEvents.some(e => e.action === "set_conclusion")).toBe(true);
        });
    });
});
