import z from "zod";
import { ReActAgent, ReActAgentConfig, ReActAgentPluginSpec } from "../../ReAct.agent";
import { tool, Tool } from "../../tools/tools";
import EventEmitter from "node:events";
import { recordLog } from "../../../telemetry/telemetry";

export interface TodoPoint {
    name: string;
    description?: string;
    state: "untouched" | "done" | "in_progress"
}

export interface TodoStoreSchemaTS {
    todoPoints: TodoPoint[]
}

export const todoSchemaZod = z.object({
    todoPoints: z.array(
        z.object({
            name: z.string().describe("Required: Name and unique identifier of a todo point. It has to be unique"),
            description: z.string().optional().describe("Optional description of point. Has to include the additional specification. It don't have to be specified always"),
            state: z.enum(["untouched", "done", "in_progress"]).describe("Required: It's a state of resolution for this todo point")
        })
    )
})

/** Use this schema for the struggle result when tasks are not finished */
export const todoStruggleSchema = z.object({
    unresolvedTasksReason: z.string().describe("A field describing for the user why certain tasks could not be completed.")
});

export function createTodoTools(
    todoStorage: TodoStoreSchemaTS[]
) {
    const TODO_TOOLS = [
        tool(
            (args) => {
                if (todoStorage.length === 0) {
                    todoStorage.push({ todoPoints: [] });
                }
                
                // Manual validation and mapping to help model if it uses wrong names
                const rawPoints = (args.todoPoints as any[]) || [];
                const mappedPoints: TodoPoint[] = rawPoints.map(p => {
                    const point: TodoPoint = {
                        name: String(p.name || p.title || p.task || "Unnamed Task"),
                        description: String(p.description || p.notes || ""),
                        state: (p.state === "done" || p.state === "in_progress" || p.state === "untouched") ? p.state : "untouched"
                    };
                    return point;
                });

                todoStorage[0].todoPoints = mappedPoints;
                return JSON.stringify({ success: true, count: mappedPoints.length });
            },
            {
                toolName: "update_todo_list",
                toolDescription: "Use this tool to: add, remove and change state of todo list points. IMPORTANT: This tool overwrites the entire list, so you MUST provide all points you want to keep. Required fields for each point: 'name', 'state' (untouched, in_progress, done), and optional 'description'.",
                toolArguments: todoSchemaZod,
                toolOutputSchema: z.object({
                    success: z.boolean().describe("State of output schema resolution"),
                    count: z.number().describe("Number of items in the list after update")
                })
            }
        ),
        tool(
            () => {
                const points = todoStorage[0]?.todoPoints || [];
                return JSON.stringify({ todoPoints: points });
            },
            {
                toolName: "get_todo_list_points",
                toolDescription: "Use this tool to download actual todo points and its state. Useful to get awareness of what is todo and what was done",
                toolArguments: z.object({}),
                toolOutputSchema: todoSchemaZod,
            }
        )
    ] as const;

    return TODO_TOOLS;
}

export const TODOPluginEventEmitter = new EventEmitter();

/**
 * TODO Plugin:
 * - Matches to work with ReAct Agent
 * - How it works?
 *   1. `before_agent_run` - Before execution of agent is changed the state and by modifying the system prompt and assigning the tools
 *   2. `after_model_call` - After model when not each each todo is finished model tries the specified times or Default times to accomplish the task or gives as addition to output conlusion why it cannot accomplish the task - it recalls ReAct agent once again 
 *      - This produces the additional event can be listened for working environment
 * 
 * @param todoStorage - is the storage with list of all todo points either finished and not
 * @param options - Optional: It's set with options for agent
 */
export function createTodoPlugin(
    todoStorage: TodoStoreSchemaTS[],
    options?: {
        struggleForAccomplishementRetries?: number;
        /** S
         * Setup as `true` to achive `Planist behaviour` generating plan before run model - it's deepagent behaviour. Agent is spawn with config inherited from ReAct agent on that plugin is mount
         * Setup with reactagent config to spawn specific agent will generate todo before agent run
        */
        generateAlwaysBeforePluginRun?: boolean | ReActAgentConfig<any, any, any>;
    }
): ReActAgentPluginSpec {
    return {
        name: "TODO-Plugin",
        executionWay: ["before_agent_run", "after_agent_run"],
        async execute(executionPlace, agentConfig, graphState) {
            if (executionPlace.way === "before_agent_run") {
                const tools = createTodoTools(todoStorage);
                // 1. Assign tools
                for (const tool of tools) {
                    if (!agentConfig.tools.find(t => t.toolConfig.toolName === tool.toolConfig.toolName)) {
                        agentConfig.tools.push(tool);
                    }
                }

                // 1.1 Trigger Always Before Plugin Run (Planning phase)
                if (options?.generateAlwaysBeforePluginRun) {
                    const planningAgentConfig: ReActAgentConfig<any, any, any> =
                        options.generateAlwaysBeforePluginRun === true
                            ? { ...agentConfig }
                            : { ...options.generateAlwaysBeforePluginRun };

                    // Ensure we don't have recursive plugin calls and have tools
                    const planningTools = createTodoTools(todoStorage);
                    const filteredPlugins = (planningAgentConfig.plugins || []).filter(p => p.name !== "TODO-Plugin");

                    const finalPlanningConfig: ReActAgentConfig<any, any, any> = {
                        ...planningAgentConfig,
                        plugins: filteredPlugins,
                        tools: [...(planningAgentConfig.tools || [])] as any as Tool<any, any>[],
                        systemPrompt: `
### PLANNING PROTOCOL
Analyze the mission and generate a detailed TODO list of points to accomplish the goal.
Decompose complex tasks into specific, manageable steps.
You MUST output the TODO points according to the schema.
`
                    };

                    // Add todo tools if missing to the planning config
                    for (const pt of planningTools) {
                        if (!finalPlanningConfig.tools.find(t => t.toolConfig.toolName === pt.toolConfig.toolName)) {
                            finalPlanningConfig.tools.push(pt as any);
                        }
                    }

                    const planningAgent = new ReActAgent(finalPlanningConfig);
                    const planningResult = await planningAgent.invokeStructuredOutput(todoSchemaZod, 1);
                    const structuredOutputResult = (planningResult.state.produceStructuredOutput as any)?.result as z.infer<typeof todoSchemaZod>;

                    if (structuredOutputResult?.todoPoints) {
                        if (todoStorage.length === 0) {
                            todoStorage.push({ todoPoints: [] });
                        }
                        todoStorage[0].todoPoints = structuredOutputResult.todoPoints;
                    }
                }
    
                // 2. Modify system prompt
                const currentTodos = todoStorage[0]?.todoPoints || [];
                let todoContext = "";
                if (currentTodos.length > 0) {
                    todoContext = currentTodos.map((t, index) => `${index + 1}. [${t.state}] ${t.name}${t.description ? `: ${t.description}` : ''}`).join('\n');
                } else {
                    todoContext = "The list is currently empty.";
                }
    
                const todoInstruction = `
\n\n### TODO List Management Protocol
${options?.generateAlwaysBeforePluginRun ? "Treat TODO List as pathway you've to follow to accomplish task" : ""}

You MUST actively manage the task progress using the TODO list tools. TODO is for you the canvas for strategical planning of tasks. Follow these rules to ensure operational excellence:
1. **Frequent Observation**: Call 'get_todo_list_points' at the beginning of your task and after major milestones to synchronize your state with the storage.
2. **Immediate Updates**: Use 'update_todo_list' the moment a task state changes. Mark points as 'in_progress' when starting and 'done' immediately upon completion.
3. **Resolution Commitment**: Pursue the resolution of ALL points. Your primary objective is to move every task to the 'done' state.
4. **Accuracy for Final Output**: Never conclude a conversation while points are still marked 'untouched' or 'in_progress' if the corresponding work has been performed. All points have to be done before finishing the progress

The list MUST reflect the actual mission status.

### Current TODO List State:
${todoContext}


Use the 'update_todo_list' and 'get_todo_list_points' tools to pursue these objectives.`;
                if (!agentConfig.systemPrompt.includes("### TODO List Management Protocol")) {
                    agentConfig.systemPrompt += todoInstruction;
                }
    
                return {
                    status: true,
                    result: {
                        agentConfig: agentConfig
                    }
                };
            }
            else if (executionPlace.way === "after_agent_run" && options?.struggleForAccomplishementRetries) {
                const todoListsPointsNotFinished = todoStorage[0]?.todoPoints.filter(todoPoint => todoPoint.state !== "done");
                if (todoListsPointsNotFinished.length) {
                    const uncompletedNames = todoListsPointsNotFinished.map(tp => tp.name).join(', ');
                    const struggleSystemPrompt = `
### TODO RESOLUTION STRUGGLE PROTOCOL
You have finished your initial run, but the following tasks from your TODO list are NOT marked as 'done':
${uncompletedNames}

Your ABSOLUTE PRIORITY is to RETRY and complete these tasks now. Use any necessary tools. 
If you absolutely cannot complete them, you must provide a detailed explanation of why in your final structured output.

IMPORTANT: Previous history is provided below for context. Focus on finishing these remaining points.
`;
                    // Override prior system prompt and put at the beginning by providing clean non-system messages
                    // ReActAgent.ensureWrappedSystemPrompt will wrap systemPrompt and prepend it.
                    const nonSystemMessages = agentConfig.messages.filter(m => m.type !== "system");
                    const tools = createTodoTools(todoStorage);

                    const struggleAgentConfig: ReActAgentConfig<any, any, any> = {
                        ...agentConfig,
                        systemPrompt: struggleSystemPrompt,
                        messages: nonSystemMessages,
                        tools: tools as any as Tool<any, any>[],
                        // Avoid infinite recursion by removing TODO-Plugin in the struggle run
                        plugins: agentConfig.plugins?.filter(p => p.name !== "TODO-Plugin")
                    };

                    const retryAgent = new ReActAgent(struggleAgentConfig);
                    const result = await retryAgent.invokeStructuredOutput(todoStruggleSchema, options.struggleForAccomplishementRetries);
                    
                    const structuredOutputResult = (result.state.produceStructuredOutput as any)?.result as z.infer<typeof todoStruggleSchema>;

                    const eventData = {
                        unresolvedTasksReason: structuredOutputResult?.unresolvedTasksReason || "Agent could not complete all tasks and did not provide a specific reason.",
                        todoPoints: todoStorage[0]?.todoPoints || []
                    };

                    recordLog({
                        event: "todo_struggle_finished",
                        ...eventData,
                        timestamp: Math.floor(Date.now() / 1000)
                    });

                    TODOPluginEventEmitter.emit("todo_struggle_finished", eventData);
                }
            }

            return {
                status: false
            }
        },
    };
}
