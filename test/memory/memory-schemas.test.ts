import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReActAgent, ReActAgentPluginSpec } from "../../src/agent/ReAct.agent";
import { DeterministicFunctionInstruction, DeterministicMemorySchema } from "../../src/agent/memory/schema/deterministicMemorySchema";
import { ToolBasedMemorySchema } from "../../src/agent/memory/schema/toolMemorySchema";

describe("custom memory schemas", () => {
    it("registers tool-based memory tools and its conclusion plugin", async () => {
        const fetchMemory = vi.fn(async ({ query }: { query: string }) => `Found: ${query}`);
        const conclusionPlugin: ReActAgentPluginSpec = {
            name: "custom-memory-conclusion",
            executionWay: "after_agent_run",
            execute: vi.fn(async () => ({ status: true }))
        };
        const memory: ToolBasedMemorySchema<z.ZodObject<{ query: z.ZodString }>, z.ZodObject<{ content: z.ZodString }>> = {
            typeMemory: "toolBased",
            name: "Project notes",
            purpose: "Search and save durable project notes.",
            memoryTools: {
                fetch: {
                    toolName: "search_project_notes",
                    instruction: "Search project notes before answering project-specific questions.",
                    toolArguments: z.object({ query: z.string() }),
                    fn: fetchMemory
                },
                update: {
                    toolName: "save_project_note",
                    instruction: "Save durable project facts.",
                    toolArguments: z.object({ content: z.string() }),
                    fn: async ({ content }) => `Saved: ${content}`
                }
            },
            conclusionPlugin
        };
        const agent = new ReActAgent({
            model: { config: { tools: [], messages: [] } } as never,
            systemPrompt: "You are a project assistant.",
            messages: [{ type: "user", content: "Find the deployment plan." }],
            tools: [],
            memory,
            withConclusion: false
        });

        const fetchTool = agent.agentConfig.tools.find(tool => tool.toolConfig.toolName === "search_project_notes");

        expect(fetchTool).toBeDefined();
        expect(agent.agentConfig.tools.map(tool => tool.toolConfig.toolName)).toContain("save_project_note");
        await expect(fetchTool!.invoke({ query: "deployment" })).resolves.toBe("Found: deployment");
        expect(fetchMemory).toHaveBeenCalledWith(
            { query: "deployment" },
            expect.objectContaining({ messages: expect.any(Array) })
        );
        expect(agent.agentConfig.plugins).toContain(conclusionPlugin);
    });

    it("forwards deterministic memory tool requests to their lifecycle hook", async () => {
        let receivedInstruction: DeterministicFunctionInstruction | undefined;
        const updateMemory = vi.fn(async ({ preference }: { preference: string }) => "Preference queued.");
        const memory: DeterministicMemorySchema = {
            typeMemory: "deterministic",
            config: {
                name: "User preferences",
                purpose: "Keep durable user preferences current.",
                tools: {
                    afterOrchestratorAgentRun: {
                        update: {
                            instruction: "Record a durable preference after the request completes.",
                            args: z.object({ preference: z.string() }),
                            fn: updateMemory
                        }
                    }
                }
            },
            afterOrchestratorAgentRun: async instruction => {
                receivedInstruction = instruction;
                return null;
            }
        };
        let modelCallCount = 0;
        const model = {
            config: { tools: [], messages: [] },
            invoke: vi.fn(async (options?: { messages?: unknown[] }) => {
                const messages = options?.messages ?? [];
                modelCallCount++;
                const answer = modelCallCount === 1
                    ? [{
                        type: "ai" as const,
                        content: null,
                        calledTools: [{
                            type: "tool" as const,
                            tool_id: "preference-update-1",
                            tool_name: "user_preferences_after_orchestrator_agent_run_update",
                            arguments: { preference: "Use concise weekly updates." }
                        }]
                    }]
                    : [{ type: "ai" as const, content: "Your preference has been recorded." }];

                return {
                    messages: [...messages, ...answer],
                    answer,
                    tokens: { input: 0, output: 0, reasoning: 0 }
                };
            })
        };
        const agent = new ReActAgent({
            model: model as never,
            systemPrompt: "You manage user preferences.",
            messages: [{ type: "user", content: "I prefer concise weekly updates." }],
            tools: [],
            memory,
            withConclusion: false
        });

        await agent.invoke();

        expect(updateMemory).toHaveBeenCalledWith(
            { preference: "Use concise weekly updates." },
            expect.objectContaining({ messages: expect.any(Array) })
        );
        expect(receivedInstruction?.agentWants).toEqual([{
            type: "update",
            wants: '{"preference":"Use concise weekly updates."}'
        }]);
    });
});