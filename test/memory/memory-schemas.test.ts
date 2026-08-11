import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReActAgent, ReActAgentPluginSpec } from "../../src/agent/ReAct.agent";
import {
    DeterministicFunctionInstruction,
    DeterministicMemoryConfig,
    DeterministicMemorySchema
} from "../../src/agent/memory/schema/deterministicMemorySchema";
import { ToolBasedMemorySchema } from "../../src/agent/memory/schema/toolMemorySchema";
import {
    InMemoryMem0MemoryStore,
    InMemoryMemPProcedureStore,
    InMemoryMemRLScoreStore,
    InMemoryMemRLTraceStore,
    type Mem0Memory,
    type MemPProcedure,
    type MemRLScore,
    type MemRLTrace
} from "../../src/agent/memory";

describe("memory schema contracts", () => {
    it("validates Mem0 records at the store boundary and isolates returned data", async () => {
        const record: Mem0Memory = {
            id: "fact-1",
            scope: "user-123",
            content: "The user prefers concise updates.",
            revision: 2,
            createdAt: 1_000,
            updatedAt: 2_000,
            expiresAt: 3_000,
            metadata: { source: "conversation" }
        };
        const store = new InMemoryMem0MemoryStore();

        await store.set(record);
        expect(await store.get(record.scope, record.id)).toEqual(record);
        expect(await store.list(record.scope)).toEqual([record]);
        expect(await store.list("another-user")).toEqual([]);

        const returnedRecord = await store.get(record.scope, record.id);
        returnedRecord!.content = "Changed by the caller.";
        returnedRecord!.metadata!.source = "changed by the caller";
        expect(await store.get(record.scope, record.id)).toEqual(record);

        await expect(store.set({ ...record, revision: "2" } as unknown as Mem0Memory)).rejects.toThrow();
        await expect(store.set({ ...record, metadata: [] } as unknown as Mem0Memory)).rejects.toThrow();
        expect(await store.get(record.scope, record.id)).toEqual(record);

        await store.delete(record.scope, record.id);
        expect(await store.get(record.scope, record.id)).toBeUndefined();
        expect(await store.list(record.scope)).toEqual([]);
    });

    it("validates MemP procedures at the store boundary, isolates nested data, and supports scoped deletion", async () => {
        const procedure: MemPProcedure = {
            id: "procedure-1",
            scope: "production",
            key: "Recover a failed deployment",
            steps: ["Stop exposure.", "Restore the stable version.", "Verify health."],
            script: "Restore the known-good version and verify recovery.",
            tags: ["deployment", "rollback"],
            status: "active" as const,
            revision: 1,
            createdAt: 1_000,
            updatedAt: 1_000,
            deprecatedAt: 2_000,
            deprecationReason: "Replaced by the platform orchestrator.",
            metadata: { reviewed: true }
        };
        const store = new InMemoryMemPProcedureStore();

        await store.set(procedure);
        expect(await store.get(procedure.scope, procedure.id)).toEqual(procedure);
        expect(await store.list(procedure.scope)).toEqual([procedure]);
        expect(await store.list("staging")).toEqual([]);
        expect(await store.get("staging", procedure.id)).toBeUndefined();

        const returnedProcedure = await store.get(procedure.scope, procedure.id);
        returnedProcedure!.steps[0] = "Changed by the caller.";
        returnedProcedure!.tags.push("changed-by-caller");
        returnedProcedure!.metadata!.reviewed = false;
        expect(await store.get(procedure.scope, procedure.id)).toEqual(procedure);

        await expect(store.set({ ...procedure, steps: ["Stop exposure.", 2] } as unknown as MemPProcedure)).rejects.toThrow();
        await expect(store.set({ ...procedure, status: "retired" } as unknown as MemPProcedure)).rejects.toThrow();
        expect(await store.get(procedure.scope, procedure.id)).toEqual(procedure);

        await store.delete(procedure.scope, procedure.id);
        expect(await store.get(procedure.scope, procedure.id)).toBeUndefined();
        expect(await store.list(procedure.scope)).toEqual([]);
    });

    it("validates MemRL scores at the store boundary and isolates resource keys", async () => {
        const score: MemRLScore = {
            resourceId: "strategy-1",
            resourceType: "memory" as const,
            scope: "deploy",
            qScore: 0.75,
            updates: 2,
            updatedAt: 2_000
        };
        const store = new InMemoryMemRLScoreStore();

        await store.set(score);
        await store.set({ ...score, scope: "other-user" });
        await store.set({ ...score, resourceType: "tool" });
        expect(await store.get(score.scope, score.resourceType, score.resourceId)).toEqual(score);
        expect(await store.get("other-user", score.resourceType, score.resourceId)).toEqual({
            ...score,
            scope: "other-user"
        });
        expect(await store.get(score.scope, "tool", score.resourceId)).toEqual({
            ...score,
            resourceType: "tool"
        });

        const returnedScore = await store.get(score.scope, score.resourceType, score.resourceId);
        returnedScore!.qScore = 0.1;
        expect(await store.get(score.scope, score.resourceType, score.resourceId)).toEqual(score);

        await expect(store.set({ ...score, qScore: "0.75" } as unknown as MemRLScore)).rejects.toThrow();
        expect(await store.get(score.scope, score.resourceType, score.resourceId)).toEqual(score);
    });

    it("validates MemRL traces at the store boundary, including nested feedback", async () => {
        const trace: MemRLTrace = {
            traceId: "trace-1",
            scope: "deploy",
            createdAt: 1_000,
            candidates: [{
                resourceId: "strategy-1",
                resourceType: "memory" as const,
                semanticScore: 0.9,
                qScore: 0.75,
                utilityScore: 0.78,
                rank: 1
            }],
            selectedResources: [{ resourceId: "strategy-1", resourceType: "memory" as const }],
            feedback: [{
                source: "automatic" as const,
                reward: 1,
                appliedAt: 2_000,
                resources: [{ resourceId: "strategy-1", resourceType: "memory" as const }],
                metadata: { outcome: "successful" }
            }]
        };
        const store = new InMemoryMemRLTraceStore();

        await store.set(trace);
        expect(await store.get(trace.traceId)).toEqual(trace);

        const returnedTrace = await store.get(trace.traceId);
        returnedTrace!.candidates[0].rank = 99;
        returnedTrace!.selectedResources.pop();
        returnedTrace!.feedback[0].resources[0].resourceId = "changed-by-caller";
        returnedTrace!.feedback[0].metadata!.outcome = "changed-by-caller";
        expect(await store.get(trace.traceId)).toEqual(trace);

        await expect(store.set({
            ...trace,
            candidates: [{ ...trace.candidates[0], resourceType: "dataset" }]
        } as unknown as MemRLTrace)).rejects.toThrow();
        await expect(store.set({
            ...trace,
            feedback: [{ ...trace.feedback[0], resources: [{ resourceId: "strategy-1" }] }]
        } as unknown as MemRLTrace)).rejects.toThrow();
        expect(await store.get(trace.traceId)).toEqual(trace);
    });

    it("carries a custom stored-memory type through deterministic and tool schemas", () => {
        const storedMemorySchema = z.object({
            userId: z.string(),
            preferences: z.array(z.string())
        });
        type StoredMemory = z.infer<typeof storedMemorySchema>;

        const deterministicConfig: DeterministicMemoryConfig<StoredMemory> = {
            name: "User preferences",
            purpose: "Store confirmed preferences.",
            memorySchema: storedMemorySchema,
            tools: {}
        };
        type TypedDeterministicMemorySchema = DeterministicMemorySchema<
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            z.ZodObject,
            StoredMemory
        >;
        const deterministicMemory: TypedDeterministicMemorySchema = {
            typeMemory: "deterministic",
            config: deterministicConfig
        };
        const fetchArgs = z.object({ query: z.string() });
        const updateArgs = z.object({ preference: z.string() });
        const toolMemory: ToolBasedMemorySchema<typeof fetchArgs, typeof updateArgs, StoredMemory> = {
            typeMemory: "toolBased",
            name: "User preferences",
            purpose: "Store confirmed preferences.",
            memorySchema: storedMemorySchema,
            memoryTools: {
                fetch: {
                    toolName: "fetch_preferences",
                    instruction: "Find user preferences.",
                    toolArguments: fetchArgs,
                    fn: () => ""
                },
                update: {
                    toolName: "update_preference",
                    instruction: "Save a confirmed preference.",
                    toolArguments: updateArgs,
                    fn: () => ""
                }
            }
        };
        const validValue = { userId: "user-123", preferences: ["concise updates"] };

        expect(deterministicMemory.config.memorySchema?.parse(validValue)).toEqual(validValue);
        expect(toolMemory.memorySchema?.parse(validValue)).toEqual(validValue);
        expect(() => deterministicMemory.config.memorySchema!.parse({
            userId: "user-123",
            preferences: [42]
        })).toThrow();
        expect(() => toolMemory.memorySchema!.parse({
            userId: "user-123",
            preferences: [42]
        })).toThrow();
    });

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