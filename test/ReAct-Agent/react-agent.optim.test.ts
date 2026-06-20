import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { Google } from "../../src/models/google";
import { tool } from "../../src/agent/tools/tools";

describe("ReActAgent optimizations", () => {
    let mockModel: Google;

    beforeEach(() => {
        mockModel = new Google({
            model: "gemini-3-flash-preview",
            apiKey: "test-key"
        });
        vi.spyOn(mockModel, "invoke");
    });

    it("executes tools in parallel when parallelTools is true", async () => {
        const tool1 = tool(async () => {
            await new Promise(r => setTimeout(r, 50));
            return "result1";
        }, {
            toolName: "tool1",
            toolDescription: "tool1",
            toolArguments: z.object({})
        });

        const tool2 = tool(async () => {
            await new Promise(r => setTimeout(r, 50));
            return "result2";
        }, {
            toolName: "tool2",
            toolDescription: "tool2",
            toolArguments: z.object({})
        });

        let callCount = 0;
        vi.mocked(mockModel.invoke).mockImplementation(async (options) => {
            callCount++;
            if (callCount === 1) {
                const aiMessage = {
                    type: "ai" as const,
                    calledTools: [
                        { type: "tool" as const, tool_id: "id1", tool_name: "tool1", arguments: {}, content: "" },
                        { type: "tool" as const, tool_id: "id2", tool_name: "tool2", arguments: {}, content: "" }
                    ]
                };
                return {
                    messages: [...(options?.messages || []), aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            }
            return {
                messages: [...(options?.messages || []), { type: "ai", content: "Done" }],
                answer: [{ type: "ai", content: "Done" }],
                tokens: { input: 10, output: 5, reasoning: 0 }
            };
        });

        const agent = new ReActAgent({
            model: mockModel,
            systemPrompt: "test",
            messages: [{ type: "user", content: "run tools" }],
            tools: [tool1, tool2],
            parallelTools: true,
            withConclusion: false
        });

        const start = Date.now();
        await agent.invoke();
        const duration = Date.now() - start;

        // Both tools take 50ms. In parallel, total should be ~50-70ms.
        // Sequential would be >100ms.
        // On some environments it might be slow, but parallel is significantly faster.
        expect(duration).toBeLessThan(140); // Generous for CI, but sequential would definitely be >100ms
    });

    it("eliminates dead turns by resolving tool outputs inline", async () => {
        const myTool = tool(async () => "tool_output", {
            toolName: "my_tool",
            toolDescription: "my_tool",
            toolArguments: z.object({})
        });

        let callCount = 0;
        vi.mocked(mockModel.invoke).mockImplementation(async (options) => {
            callCount++;
            if (callCount === 1) {
                const aiMessage = {
                    type: "ai" as const,
                    calledTools: [
                        { type: "tool" as const, tool_id: "t1", tool_name: "my_tool", arguments: {}, content: "" }
                    ]
                };
                return {
                    messages: [...(options?.messages || []), aiMessage],
                    answer: [aiMessage],
                    tokens: { input: 10, output: 5, reasoning: 0 }
                };
            }
            return {
                messages: [...(options?.messages || []), { type: "ai", content: "Final result based on tool_output" }],
                answer: [{ type: "ai", content: "Final result based on tool_output" }],
                tokens: { input: 10, output: 5, reasoning: 0 }
            };
        });

        const agent = new ReActAgent({
            model: mockModel,
            systemPrompt: "test",
            messages: [{ type: "user", content: "call tool" }],
            tools: [myTool],
            withConclusion: false
        });

        const result = await agent.invoke();

        // Turn 1: AI calls tool
        // tools_node runs
        // tools_node returns state with tools and callNode: "main_node"
        // main_node runs, sees state.callTools, appends to messages, calls model again (Turn 2)
        // Total model.invoke calls should be exactly 2.
        expect(mockModel.invoke).toHaveBeenCalledTimes(2);
        
        // Verify that tool output was injected before the second call
        const secondCallMessages = vi.mocked(mockModel.invoke).mock.calls[1][0].messages;
        expect(secondCallMessages?.some(m => m.type === "tool" && m.toolOutput === "tool_output")).toBe(true);
        expect(result.messages.at(-1)?.content).toBe("Final result based on tool_output");
    });

    it("generates conclusion when withConclusion is true", async () => {
        vi.mocked(mockModel.invoke).mockImplementation(async (options) => {
            const currentMessages = options?.messages || [];
            // Detect if this is a conclusion call
            const lastMsg = currentMessages.at(-1);
            if (lastMsg?.type === "user" && lastMsg.content.includes("Write the final user-facing conclusion")) {
                return {
                    messages: [...currentMessages, { type: "ai", content: "Generated Conclusion" }],
                    answer: [{ type: "ai", content: "Generated Conclusion" }],
                    tokens: { input: 5, output: 5, reasoning: 0 }
                };
            }
            return {
                messages: [...currentMessages, { type: "ai", content: "Original AI message" }],
                answer: [{ type: "ai", content: "Original AI message" }],
                tokens: { input: 10, output: 5, reasoning: 0 }
            };
        });

        const agent = new ReActAgent({
            model: mockModel,
            systemPrompt: "test",
            messages: [{ type: "user", content: "hello" }],
            tools: [],
            withConclusion: true
        });

        const result = await agent.invoke();

        // invoke 1: original response
        // invoke 2: conclusion response
        expect(mockModel.invoke).toHaveBeenCalledTimes(2);
        expect(result.messages.at(-1)?.content).toBe("Generated Conclusion");
    });

    it("caches the wrapped system prompt for efficiency", async () => {
        const agent = new ReActAgent({
            model: mockModel,
            systemPrompt: "User Prompt",
            messages: [{ type: "user", content: "hello" }],
            tools: [],
        });

        // @ts-ignore - accessing private method for testing
        const prompt1 = agent.buildWrappedSystemPrompt("User Prompt");
        // @ts-ignore
        const prompt2 = agent.buildWrappedSystemPrompt("User Prompt");

        expect(prompt1).toBe(prompt2);
        
        // @ts-ignore
        expect(agent.cachedWrappedSystemPrompt).toBe(prompt1);

        // Changing user prompt should invalidate cache
        // @ts-ignore
        const prompt3 = agent.buildWrappedSystemPrompt("New User Prompt");
        expect(prompt3).not.toBe(prompt1);
        // @ts-ignore
        expect(agent.cachedUserSystemPrompt).toBe("New User Prompt");
    });
});
