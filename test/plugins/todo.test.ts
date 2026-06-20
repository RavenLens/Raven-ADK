import { describe, it, expect, vi } from "vitest";
import { createTodoTools, createTodoPlugin, TodoStoreSchemaTS } from "../../src/agent/todo/todo";
import { AgentModel, ReActAgentConfig } from "../../src/agent/ReAct.agent";
import { AgentMessagesGraphState } from "../../src/agent/state";

describe("TODO Plugin - Logic alone", () => {
    it("should create todo tools that interact with storage", async () => {
        const storage: TodoStoreSchemaTS[] = [{ todoPoints: [] }];
        const tools = createTodoTools(storage);

        const updateTool = tools.find(t => t.toolConfig.toolName === "update_todo_list");
        const getTool = tools.find(t => t.toolConfig.toolName === "get_todo_list_points");

        expect(updateTool).toBeDefined();
        expect(getTool).toBeDefined();

        // Test update
        await (updateTool as any)!.invoke({
            todoPoints: [{ name: "Test Task", state: "untouched" }]
        });
        expect(storage[0].todoPoints).toHaveLength(1);
        expect(storage[0].todoPoints[0].name).toBe("Test Task");

        // Test get
        const result = await (getTool as any)!.invoke({});
        const parsed = JSON.parse(result);
        expect(parsed.todoPoints).toHaveLength(1);
        expect(parsed.todoPoints[0].name).toBe("Test Task");
    });

    it("should modify agent config in before_agent_run", async () => {
        const storage: TodoStoreSchemaTS[] = [{ todoPoints: [{ name: "Existing", state: "untouched" }] }];
        const plugin = createTodoPlugin(storage, 1);
        const agentConfig: ReActAgentConfig<any, any> = {
            model: {} as AgentModel,
            systemPrompt: "Original prompt",
            messages: [],
            tools: []
        };
        const graphState: AgentMessagesGraphState = {} as any;

        const result = await plugin.execute(
            { way: "before_agent_run", nodeType: "main" },
            agentConfig,
            graphState
        );

        expect(result.status).toBe(true);
        expect(agentConfig.tools).toHaveLength(2);
        expect(agentConfig.systemPrompt).toContain("Existing");
        expect(agentConfig.systemPrompt).toContain("update_todo_list");
    });

    it("should update storage in after_model_call based on model output", async () => {
        const storage: TodoStoreSchemaTS[] = [{ 
            todoPoints: [
                { name: "Task 1", state: "untouched" },
                { name: "Task 2", state: "untouched" }
            ] 
        }];
        
        const mockModel = {
            config: { messages: [] },
            invokeStructuredOutput: vi.fn().mockResolvedValue({
                answer: [{
                    type: "ai",
                    structuredOutput: {
                        finishedTodoNames: ["Task 1"]
                    }
                }]
            })
        } as unknown as AgentModel;

        const plugin = createTodoPlugin(storage, 3, mockModel);
        const agentConfig: ReActAgentConfig<any, any> = {
            model: mockModel,
            systemPrompt: "",
            messages: [{ type: "user", content: "I finished Task 1" }],
            tools: []
        };

        const result = await plugin.execute(
            { way: "after_model_call", nodeType: "main" },
            agentConfig,
            {} as any
        );

        expect(result.status).toBe(true);
        expect(storage[0].todoPoints.find(p => p.name === "Task 1")?.state).toBe("done");
        expect(storage[0].todoPoints.find(p => p.name === "Task 2")?.state).toBe("untouched");
    });
});
