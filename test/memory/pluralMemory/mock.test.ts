import { describe, expect, it, vi } from "vitest";
import { ReActAgent } from "../../../src/agent/ReAct.agent";
import { Google } from "../../../src/models/text-to-text/google";
import { SchemaMemoryStore } from "../../../src/agent/memory/stores/schema";

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

});
