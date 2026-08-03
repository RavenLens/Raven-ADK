import { describe, expect, it, vi } from "vitest";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { DeterministicMemorySchema } from "../../src/agent/memory/schema/deterministicMemorySchema";
import { Mem0 } from "../../src/agent/memory";

describe("Mem0", () => {
    it("reconciles factual memories through add, update, delete, and retrieval", async () => {
        const memory = new Mem0({
            name: "User facts",
            purpose: "Keep user preferences current.",
            scope: "user-123",
            idFactory: () => "preference-1",
            now: () => 1_000
        });
        const schema: DeterministicMemorySchema = memory;

        const added = await memory.applyUpdate({
            type: "add",
            memory: { content: "The user prefers coffee." }
        });
        const updated = await memory.applyUpdate({
            type: "update",
            memoryId: "preference-1",
            memory: { content: "The user now prefers decaf coffee." }
        });
        const retrieved = await memory.retrieve("Which coffee does the user prefer?");
        const deleted = await memory.applyUpdate({
            type: "delete",
            memoryId: "preference-1"
        });

        expect(schema.typeMemory).toBe("deterministic");
        expect(added.memory).toMatchObject({
            id: "preference-1",
            content: "The user prefers coffee.",
            revision: 1
        });
        expect(updated.memory).toMatchObject({
            content: "The user now prefers decaf coffee.",
            revision: 2
        });
        expect(retrieved.memories.map(result => result.memory.content)).toEqual([
            "The user now prefers decaf coffee."
        ]);
        expect(deleted.action).toBe("delete");
        expect(await memory.listMemories()).toEqual([]);
    });

    it("uses deterministic hooks to reconcile an extracted fact and attach relevant recall", async () => {
        const memory = new Mem0({
            name: "User facts",
            purpose: "Keep user preferences current.",
            idFactory: () => "coffee-preference",
            factExtractor: async () => ["The user now prefers decaf coffee."],
            updatePlanner: async ({ fact, similarMemories }) => {
                const existing = similarMemories[0];
                return existing
                    ? {
                        type: "update" as const,
                        memoryId: existing.memory.id,
                        memory: fact
                    }
                    : {
                        type: "add" as const,
                        memory: fact
                    };
            }
        });
        await memory.addMemory({ content: "The user prefers coffee." });
        const instruction = {
            contextAgentState: {
                messages: [{ type: "user" as const, content: "Please remember that I drink decaf coffee now." }]
            }
        };

        const updateOutcome = await memory.afterOrchestratorAgentRun(instruction);
        const fetchOutcome = await memory.beforeOrchestratorAgentRun({
            contextAgentState: {
                messages: [{ type: "user" as const, content: "What coffee should I buy?" }]
            }
        });

        expect(updateOutcome).toEqual([{
            updatedInformations: ["Mem0 updated fact \"coffee-preference\"."],
            attchToAgentAwareness: false
        }]);
        expect(fetchOutcome).toEqual([{
            memoryInformations: [expect.stringContaining("decaf coffee")],
            attchToAgentAwareness: true
        }]);
    });

    it("uses a configured LLM for fact extraction followed by ADD planning", async () => {
        const model = {
            invoke: vi.fn()
                .mockResolvedValueOnce({
                    answer: [{ type: "ai", content: "{\"facts\":[\"The user is vegetarian.\"]}" }],
                    messages: [],
                    tokens: { input: 0, output: 0, reasoning: 0 }
                })
                .mockResolvedValueOnce({
                    answer: [{ type: "ai", content: "{\"operation\":\"add\",\"content\":\"The user is vegetarian.\"}" }],
                    messages: [],
                    tokens: { input: 0, output: 0, reasoning: 0 }
                })
        };
        const memory = new Mem0({
            name: "User facts",
            purpose: "Keep dietary preferences current.",
            model: model as never,
            idFactory: () => "diet-1"
        });

        await memory.afterConversationEnd({
            contextAgentState: {
                messages: [{ type: "user", content: "I am vegetarian." }]
            }
        });

        expect(model.invoke).toHaveBeenCalledTimes(2);
        expect(await memory.getMemory("diet-1")).toMatchObject({
            content: "The user is vegetarian.",
            revision: 1
        });
    });

    it("updates after a ReActAgent run and supplies recalled facts before the next run", async () => {
        const model = {
            config: {
                model: "test-model",
                tools: [],
                messages: []
            },
            invoke: vi.fn(async (options?: { messages?: Array<{ type: string; content?: string; }>; }) => {
                const messages = options?.messages ?? [];
                return {
                    answer: [{ type: "ai" as const, content: "Acknowledged." }],
                    messages: [...messages, { type: "ai" as const, content: "Acknowledged." }],
                    tokens: { input: 0, output: 0, reasoning: 0 }
                };
            })
        };
        const memory = new Mem0({
            name: "User facts",
            purpose: "Keep dietary preferences current.",
            idFactory: () => "tea-preference",
            factExtractor: async () => ["The user prefers green tea."],
            updatePlanner: async ({ fact, similarMemories }) => similarMemories.length
                ? { type: "noop" as const }
                : { type: "add" as const, memory: fact }
        });
        const agent = new ReActAgent({
            model: model as never,
            systemPrompt: "You are a helpful assistant.",
            messages: [{ type: "user", content: "I prefer green tea." }],
            memory,
            tools: [],
            withConclusion: false
        });

        await agent.invoke();
        agent.agentConfig.messages.push({ type: "user", content: "What tea should I buy?" });
        await agent.invoke();

        expect(await memory.getMemory("tea-preference")).toMatchObject({
            content: "The user prefers green tea."
        });
        expect(model.invoke.mock.calls.some(([options]) => {
            const messages = (options as { messages?: Array<{ type?: string; content?: string; }> }).messages;
            return messages?.some(message =>
                message.type === "system" && message.content?.includes("The user prefers green tea.")
            );
        })).toBe(true);
    });

    it("uses subagent lifecycle hooks for delegated ReActAgent work", async () => {
        const lifecycle: string[] = [];
        const memory: DeterministicMemorySchema = {
            typeMemory: "deterministic",
            config: {
                name: "Lifecycle memory",
                purpose: "Verify deterministic memory hook routing.",
                tools: {} as never
            },
            beforeOrchestratorAgentRun: async () => {
                lifecycle.push("before-orchestrator");
                return null;
            },
            afterOrchestratorAgentRun: async () => {
                lifecycle.push("after-orchestrator");
                return null;
            },
            beforeSubagentRun: async () => {
                lifecycle.push("before-subagent");
                return null;
            },
            afterSubagentRun: async () => {
                lifecycle.push("after-subagent");
                return null;
            }
        };
        const createModel = (responses: string[]) => ({
            config: {
                model: "test-model",
                tools: [],
                messages: []
            },
            invoke: vi.fn(async (options?: { messages?: Array<{ type: string; content?: string; }>; }) => {
                const content = responses.shift() ?? "Done.";
                const messages = options?.messages ?? [];
                return {
                    answer: [{ type: "ai" as const, content }],
                    messages: [...messages, { type: "ai" as const, content }],
                    tokens: { input: 0, output: 0, reasoning: 0 }
                };
            })
        });
        const agent = new ReActAgent({
            model: createModel([
                "[[RAVEN_CALL_SUBAGENT]] researcher | Check the available facts.",
                "The delegated check is complete."
            ]) as never,
            systemPrompt: "You are an orchestrator.",
            messages: [{ type: "user", content: "Delegate this check." }],
            memory,
            tools: [],
            withConclusion: false,
            subagents: [{
                role: "researcher",
                roleDescription: "Checks facts.",
                model: createModel(["The facts have been checked."]) as never,
                systemPrompt: "You are a researcher.",
                tools: []
            }]
        });

        await agent.invoke();

        expect(lifecycle).toEqual([
            "before-orchestrator",
            "before-subagent",
            "after-subagent",
            "after-orchestrator"
        ]);
    });
});