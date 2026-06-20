import z from "zod";
import { AgentModel, ReActAgentPluginSpec } from "../ReAct.agent";
import { tool, Tool } from "../tools/tools";
import { AIMessage, MessagesVariations } from "../state";

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


/**
 * Possibilities how would it work:
 * 1. Another LLM verifies the results of each node
 *  Advantages:
 *      - this doesn't require to modify the react agent to include some special labels like [TODO_DONE] in the response
 *          - this produces cleares responses and doesn't cause a model to include the TODO in the summary
 *  Disadvantages:
 *      - Cost & Time - each response of model or submodel takes another time and inference costs
*/

/**
 * TODO Plugin:
 * - Matches to work with ReAct Agent
 * - How it works?
 *   1. `before_agent_run` - Before execution of agent is changed the state and by modifying the system prompt and assigning the tools
 *   2. `after_model_call` - After model call the same model or new modified is used to evaluate whhether the action is finished
 * 
 * @param todoStorage - is the storage with list of all todo points either finished and not
 * @param finishedTodoTecallTries - is the number of tries llm will take to parse the names of finished todo points after each call. Default: 3
 * @param model - is the optional model will be leveraged to find the finished points. Optional and if not specified we take model from execution place for **master agent** or subagents depends on execution place itself
 */
export function createTodoPlugin(
    todoStorage: TodoStoreSchemaTS[],
): ReActAgentPluginSpec {
    return {
        name: "TODO-Plugin",
        executionWay: "before_agent_run",
        async execute(executionPlace, agentConfig, graphState) {
            if (executionPlace.way === "before_agent_run") {
                // 1. Assign tools
                const tools = createTodoTools(todoStorage);
                for (const tool of tools) {
                    if (!agentConfig.tools.find(t => t.toolConfig.toolName === tool.toolConfig.toolName)) {
                        agentConfig.tools.push(tool);
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
    
                const todoInstruction = `\n\n### TODO List Management Protocol\nYou MUST actively manage the task progress using the TODO list tools. Follow these rules to ensure operational excellence:\n1. **Frequent Observation**: Call 'get_todo_list_points' at the beginning of your task and after major milestones to synchronize your state with the storage.\n2. **Immediate Updates**: Use 'update_todo_list' the moment a task state changes. Mark points as 'in_progress' when starting and 'done' immediately upon completion.\n3. **Resolution Commitment**: Pursue the resolution of ALL points. Your primary objective is to move every task to the 'done' state. \n4. **Accuracy for Final Output**: Never conclude a conversation while points are still marked 'untouched' or 'in_progress' if the corresponding work has been performed. The list MUST reflect the actual mission status.\n\n### Current TODO List State:\n${todoContext}\n\nUse the 'update_todo_list' and 'get_todo_list_points' tools to pursue these objectives.`;
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

            return {
                status: false
            }
        },
    };
}
