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
});
