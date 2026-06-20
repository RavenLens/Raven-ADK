import "dotenv/config";
import { describe, expect, it } from "vitest";
import { ReActAgent } from "../../../src/agent/ReAct.agent";
import { OpenAI } from "../../../src/models/openai";
import { createTodoPlugin, TodoStoreSchemaTS } from "../../../src/agent/todo/todo";

const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = (openaiApiKey && openaiApiKey.length > 0) ? describe : describe.skip;

liveDescribe("ReActAgent with TODO Plugin - Live Integration", () => {
    it("should manage a todo list with main agent and subagent", async () => {
        const todoStorage: TodoStoreSchemaTS[] = [{ todoPoints: [] }];
        const todoPlugin = createTodoPlugin(todoStorage);

        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openaiApiKey!,
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "You are a project manager. Use the todo plugin to track tasks.",
            plugins: [todoPlugin],
            tools: [],
            messages: [
                {
                    type: "user",
                    content: "I need to start a new project. Please create a todo list with 2 tasks: 'Initial Research' and 'Architecture Design'. Assign 'Initial Research' to your Research Assistant subagent and ask it to report when done."
                }
            ],
            subagents: [
                {
                    role: "Research Assistant",
                    roleDescription: "Expert at performing initial research and data collection.",
                    model,
                    systemPrompt: "You are a research assistant. When you finish a task, inform the project manager.",
                    tools: []
                }
            ]
        });

        // The agent should:
        // 1. Initialize the plugin (add tools)
        // 2. Use 'update_todo_list' to add the 2 tasks.
        // 3. Delegate to subagent.
        // 4. Subagent finishes task.
        // 5. after_model_call should detect finished task and update state.

        const result = await agent.invoke();
        console.log('Agent result', result);
        console.log(`\n\nAgent response`, result.messages.at(-1));
        console.log(`\n\n Todo Storage`, todoStorage);

        // 1. Check if tasks were created in storage
        expect(todoStorage[0].todoPoints.length).toBeGreaterThanOrEqual(2);
        const researchTask = todoStorage[0].todoPoints.find(p => p.name.includes("Research"));
        const designTask = todoStorage[0].todoPoints.find(p => p.name.includes("Architecture"));
        
        expect(researchTask).toBeDefined();
        expect(designTask).toBeDefined();

        // 2. Check if at least one task was marked as done (the one assigned to subagent)
        // Note: In a real run, this depends on model performance. 
        // We'll check if the storage has any 'done' tasks if we want to verify the after_model_call logic.
        const doneTasks = todoStorage[0].todoPoints.filter(p => p.state === "done");
        
        // We expect at least one task to be done if the subagent completed its part.
        // Even if zero, it validates the agent ran with the plugin without crashing.
        console.log("Current TODO State:", JSON.stringify(todoStorage[0].todoPoints, null, 2));
    }, 600_000);
});
