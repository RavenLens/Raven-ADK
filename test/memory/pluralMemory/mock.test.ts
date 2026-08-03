import { describe, expect, it, vi } from "vitest";
import { ReActAgent } from "../../../src/agent/ReAct.agent";
import { Google } from "../../../src/models/google";
import { SchemaMemoryStore } from "../../../src/agent/memory/stores/schema";
import { createMemoryConclusionPlugin } from "../../../src/agent/memory/memory";

describe("Plural Memory Systems - Mocking", () => {
    it("should register prefixed tools and separate system prompts for plural settings", async () => {
        const mockModel = {
            config: { model: "test" },
            invoke: vi.fn()
        } as any;
        
        // Define two distinct memory stores
        const createMockStore = (id: string, remember: string): SchemaMemoryStore => ({
            config: { hasToRemember: remember, session: `session-${id}` },
            fetchMemoryConclusionFile: vi.fn().mockResolvedValue(`Conclusion for ${id}`),
            writeMemoryConclusionFile: vi.fn(),
            fetchMemory: vi.fn(),
            saveMemory: vi.fn()
        });

        const userStore = createMockStore("user", "User name");
        const projectStore = createMockStore("project", "Project status");

        const agent = new ReActAgent({
            model: mockModel,
            systemPrompt: "Agent prompt",
            tools: [],
            messages: [],
            memory: [
                { memory: userStore, name: "User Profile", purpose: "Store user identity" },
                { memory: projectStore, name: "Task Tracker", purpose: "Track project tasks" }
            ]
        });

        // 1. Tool prefixes check (whitespaces in names should be converted to underscores)
        const toolNames = agent.agentConfig.tools.map(t => t.toolConfig.toolName);
        expect(toolNames).toContain("user_profile_fetch_memory");
        expect(toolNames).toContain("user_profile_save_memory");
        expect(toolNames).toContain("task_tracker_fetch_memory");
        expect(toolNames).toContain("task_tracker_save_memory");

        // 2. System prompt synthesis check
        const systemPrompt = await (agent as any).buildWrappedSystemPrompt("Agent prompt");
        
        expect(systemPrompt).toContain("## Memory and Recall Systems:");
        expect(systemPrompt).toContain("### Memory System: User Profile");
        expect(systemPrompt).toContain("### Memory System: Task Tracker");
        expect(systemPrompt).toContain("Conclusion for user");
        expect(systemPrompt).toContain("Conclusion for project");
    });

    it("MemoryConcludePlugin should iterate and update all memory systems", async () => {
        const mockModel = {
            config: { model: "test" },
            invoke: vi.fn()
        } as any;
        
        const storeA = {
            config: { hasToRemember: "A", session: "s1" },
            fetchMemoryConclusionFile: vi.fn().mockResolvedValue("Old A"),
            writeMemoryConclusionFile: vi.fn().mockResolvedValue(true),
            fetchMemory: vi.fn(),
            saveMemory: vi.fn()
        };
        const storeB = {
            config: { hasToRemember: "B", session: "s2" },
            fetchMemoryConclusionFile: vi.fn().mockResolvedValue("Old B"),
            writeMemoryConclusionFile: vi.fn().mockResolvedValue(true),
            fetchMemory: vi.fn(),
            saveMemory: vi.fn()
        };

        // Mock model invoke since MemoryConcludePlugin now uses it directly
        mockModel.invoke
            .mockResolvedValueOnce({
                messages: [{ type: "ai", content: "Updated A" }],
                answer: [{ type: "ai", content: "Updated A" }],
                tokens: { input: 0, output: 0, reasoning: 0 }
            })
            .mockResolvedValueOnce({
                messages: [{ type: "ai", content: "Updated B" }],
                answer: [{ type: "ai", content: "Updated B" }],
                tokens: { input: 0, output: 0, reasoning: 0 }
            });

        const plugin = createMemoryConclusionPlugin({
            model: mockModel,
            systemPrompt: "Summary spec",
            tools: [],
            messages: []
        });

        const agentConfig = {
            model: mockModel,
            memory: [
                { memory: storeA, name: "System A", purpose: "P1" },
                { memory: storeB, name: "System B", purpose: "P2" }
            ],
            messages: [
                { type: "user", content: "Hi" },
                { type: "ai", content: "Hello" }
            ]
        } as any;

        const result = await plugin.execute({ way: "after_agent_run", nodeType: "main" }, agentConfig, {} as any);

        expect(result.status).toBe(true);
        expect(storeA.writeMemoryConclusionFile).toHaveBeenCalledWith("Updated A");
        expect(storeB.writeMemoryConclusionFile).toHaveBeenCalledWith("Updated B");
    });
});
