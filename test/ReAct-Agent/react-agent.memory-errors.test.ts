import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { tool } from "../../src/agent/tools/tools";
import { OpenAI } from "../../src/models/text-to-text/openai";

const createModel = () => {
    const model = new OpenAI({
        model: "gpt-5-mini",
        apiKey: "test"
    });

    vi.spyOn(model, "invoke").mockImplementation((async (options: any) => {
        const currentMessages = options?.messages || model.config.messages || [];
        const aiMessage = {
            type: "ai" as const,
            content: "Completed with the available context."
        };

        return {
            messages: [...currentMessages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 1, output: 1, reasoning: 0 }
        };
    }) as any);

    return model;
};

const createMemory = (name: string, hooks: Record<string, unknown>) => ({
    typeMemory: "deterministic" as const,
    config: {
        name,
        purpose: "Test deterministic memory behavior.",
        tools: {}
    },
    ...hooks
});

const createToolCallModel = (toolName: string, toolArguments: Record<string, unknown> = {}) => {
    const model = createModel();
    let callCount = 0;

    vi.mocked(model.invoke).mockImplementation((async (options: any) => {
        callCount++;
        const currentMessages = options?.messages || model.config.messages || [];

        if (callCount === 1) {
            const aiMessage = {
                type: "ai" as const,
                calledTools: [{
                    type: "tool" as const,
                    tool_id: `${toolName}-call`,
                    tool_name: toolName,
                    arguments: toolArguments,
                    content: ""
                }]
            };

            return {
                messages: [...currentMessages, aiMessage],
                answer: [aiMessage],
                tokens: { input: 1, output: 1, reasoning: 0 }
            };
        }

        const aiMessage = {
            type: "ai" as const,
            content: "Completed after the tool failure."
        };

        return {
            messages: [...currentMessages, aiMessage],
            answer: [aiMessage],
            tokens: { input: 1, output: 1, reasoning: 0 }
        };
    }) as any);

    return model;
};

describe("ReActAgent deterministic memory errors", () => {
    it("continues after a before-hook error and exposes diagnostics with healthy memory context", async () => {
        const model = createModel();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const memoryError = vi.fn();
        const failedMemory = createMemory("Broken memory", {
            beforeOrchestratorAgentRun: vi.fn().mockRejectedValue(new Error("invalid memory JSON"))
        });
        const healthyMemory = createMemory("Healthy memory", {
            beforeOrchestratorAgentRun: vi.fn().mockResolvedValue([{
                memoryInformations: ["The user prefers concise updates."],
                attchToAgentAwareness: true
            }])
        });

        try {
            const agent = new ReActAgent({
                model,
                systemPrompt: "Answer the user.",
                messages: [{ type: "user", content: "What should I know?" }],
                tools: [],
                memory: [failedMemory, healthyMemory],
                withConclusion: false
            });
            agent.onEvent("memory_error", memoryError);

            const result = await agent.invoke();
            const invokedMessages = vi.mocked(model.invoke).mock.calls[0]?.[0]?.messages ?? [];
            const systemPrompt = invokedMessages.find(message => message.type === "system");

            expect(result.messages.at(-1)?.content).toBe("Completed with the available context.");
            expect(model.invoke).toHaveBeenCalledOnce();
            expect(systemPrompt?.content).toContain("## Retrieved Memory:");
            expect(systemPrompt?.content).toContain("The user prefers concise updates.");
            expect(systemPrompt?.content).toContain("## Memory Diagnostics:");
            expect(systemPrompt?.content).toContain("invalid memory JSON");
            expect(memoryError).toHaveBeenCalledWith({
                memoryName: "Broken memory",
                hook: "beforeOrchestratorAgentRun",
                phase: "orchestrator",
                message: "invalid memory JSON"
            });
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("Broken memory"),
                expect.any(Error)
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it("returns the completed result after an after-hook error", async () => {
        const model = createModel();
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const memoryError = vi.fn();
        const memory = createMemory("Persistence memory", {
            afterOrchestratorAgentRun: vi.fn().mockRejectedValue(new Error("schema validation failed"))
        });

        try {
            const agent = new ReActAgent({
                model,
                systemPrompt: "Answer the user.",
                messages: [{ type: "user", content: "Finish the task." }],
                tools: [],
                memory,
                withConclusion: false
            });
            agent.onEvent("memory_error", memoryError);

            const result = await agent.invoke();

            expect(result.messages.at(-1)?.content).toBe("Completed with the available context.");
            expect(model.invoke).toHaveBeenCalledOnce();
            expect(memoryError).toHaveBeenCalledWith({
                memoryName: "Persistence memory",
                hook: "afterOrchestratorAgentRun",
                phase: "orchestrator",
                message: "schema validation failed"
            });
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("Persistence memory"),
                expect.any(Error)
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it("emits memory_error and continues when a memory fetch tool fails", async () => {
        const model = createToolCallModel("fetch_project_notes");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const memoryError = vi.fn();
        const memory = {
            typeMemory: "toolBased" as const,
            name: "Project memory",
            purpose: "Search project notes.",
            memoryTools: {
                fetch: {
                    toolName: "fetch_project_notes",
                    instruction: "Search project notes.",
                    toolArguments: z.object({}),
                    fn: vi.fn().mockRejectedValue(new Error("memory fetch unavailable"))
                }
            }
        };

        try {
            const agent = new ReActAgent({
                model,
                systemPrompt: "Answer the user.",
                messages: [{ type: "user", content: "Find the project notes." }],
                tools: [],
                memory,
                withConclusion: false
            });
            agent.onEvent("memory_error", memoryError);

            const result = await agent.invoke();
            const secondCallMessages = vi.mocked(model.invoke).mock.calls[1]?.[0]?.messages ?? [];
            const failedToolMessage = secondCallMessages.find(message => message.type === "tool");

            expect(result.messages.at(-1)?.content).toBe("Completed after the tool failure.");
            expect(model.invoke).toHaveBeenCalledTimes(2);
            expect(failedToolMessage?.toolOutput).toContain("Memory tool \"fetch_project_notes\" for \"Project memory\" failed during fetch");
            expect(failedToolMessage?.toolOutput).toContain("Continue without this memory");
            expect(memoryError).toHaveBeenCalledWith({
                memoryName: "Project memory",
                toolName: "fetch_project_notes",
                toolKind: "fetch",
                message: "memory fetch unavailable"
            });
            expect(consoleError).toHaveBeenCalledWith(
                expect.stringContaining("fetch_project_notes"),
                expect.any(Error)
            );
        } finally {
            consoleError.mockRestore();
        }
    });

    it("emits memory_error and continues when a memory update tool fails", async () => {
        const model = createToolCallModel("save_project_note", { content: "A new note" });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const memoryError = vi.fn();
        const memory = {
            typeMemory: "toolBased" as const,
            name: "Project memory",
            purpose: "Save project notes.",
            memoryTools: {
                update: {
                    toolName: "save_project_note",
                    instruction: "Save project notes.",
                    toolArguments: z.object({ content: z.string() }),
                    fn: vi.fn().mockRejectedValue(new Error("memory update unavailable"))
                }
            }
        };

        try {
            const agent = new ReActAgent({
                model,
                systemPrompt: "Answer the user.",
                messages: [{ type: "user", content: "Save the project note." }],
                tools: [],
                memory,
                withConclusion: false
            });
            agent.onEvent("memory_error", memoryError);

            const result = await agent.invoke();

            expect(result.messages.at(-1)?.content).toBe("Completed after the tool failure.");
            expect(model.invoke).toHaveBeenCalledTimes(2);
            expect(memoryError).toHaveBeenCalledWith({
                memoryName: "Project memory",
                toolName: "save_project_note",
                toolKind: "update",
                message: "memory update unavailable"
            });
        } finally {
            consoleError.mockRestore();
        }
    });

    it("does not emit memory_error for an unrelated tool failure", async () => {
        const model = createToolCallModel("unrelated_tool");
        const memoryError = vi.fn();
        const unrelatedTool = tool(
            async () => {
                throw new Error("ordinary tool unavailable");
            },
            {
                toolName: "unrelated_tool",
                toolDescription: "An ordinary tool.",
                toolArguments: z.object({})
            }
        );
        const agent = new ReActAgent({
            model,
            systemPrompt: "Answer the user.",
            messages: [{ type: "user", content: "Use the ordinary tool." }],
            tools: [unrelatedTool],
            withConclusion: false
        });
        agent.onEvent("memory_error", memoryError);

        const result = await agent.invoke();
        const secondCallMessages = vi.mocked(model.invoke).mock.calls[1]?.[0]?.messages ?? [];
        const failedToolMessage = secondCallMessages.find(message => message.type === "tool");

        expect(result.messages.at(-1)?.content).toBe("Completed after the tool failure.");
        expect(model.invoke).toHaveBeenCalledTimes(2);
        expect(failedToolMessage?.toolOutput).toBe("Tool \"unrelated_tool\" failed during execution: ordinary tool unavailable");
        expect(memoryError).not.toHaveBeenCalled();
    });
});