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
    finishedTodoTecallTries: number = 3,
    model?: AgentModel,
): ReActAgentPluginSpec {
    return {
        name: "TODO-Plugin",
        executionWay: ["before_agent_run", "after_model_call"],
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
    
                const todoInstruction = `\n\n### Current TODO List:\n${todoContext}\n\nYou can update this list using the provided tools 'update_todo_list' and 'get_todo_list_points'. Always keep the list up to date with your progress. You've to pursue the TODO list resoultion to mark all points as 'done' by using tools, subagents, skills and your memory the best as is possible.`;
                if (!agentConfig.systemPrompt.includes("### Current TODO List:")) {
                    agentConfig.systemPrompt += todoInstruction;
                }
    
                return {
                    status: true,
                    result: {
                        agentConfig: agentConfig
                    }
                };
            }
            else if (executionPlace.way === "after_model_call") {
                const lastMessage = agentConfig.messages.at(-1);
                // Skip verification if there are pending tool calls - avoids 400 error from OpenAI
                // when tool calls are not followed by tool results in the checker's context
                if (lastMessage?.type === "ai" && lastMessage.calledTools && lastMessage.calledTools.length > 0) {
                    return { status: true };
                }

                const evaluationCheckerModel = model ?? agentConfig.model;
                const currentTodos = todoStorage[0]?.todoPoints || [];
                if (currentTodos.length === 0) return { status: true };

                // 1. Prepare messages for checker (excluding system prompt and cleaning up tool calls)
                const messagesForChecker: MessagesVariations[] = [
                    {
                        type: "system",
                        content: `
You're todo list verificatior and your rule is to check whether was some todo point accomplished base on the deliveried messages history and todo list
                        `
                    },
                    ...agentConfig.messages
                        .filter(m => m.type === "user" || m.type === "ai") // ONLY keep user and ai to keep history clean for verifier
                        .map(m => {
                            // Strip ALL metadata from AI messages to avoid "No tool output found" or other validation errors
                            if (m.type === "ai") {
                                return {
                                    type: "ai",
                                    content: m.content
                                } as AIMessage;
                            }
                            return m;
                        }),
                    // Adds evaluation task
                    {
                        type: "user",
                        content: `Based on the conversation above, identify if any of the following TODO points have been completed (reached 'done' state). 
Return the names of the completed points.

TODO Points to check:
${currentTodos.map(t => `- ${t.name}${t.description ? `: ${t.description}` : ''} (Current state: ${t.state})`).join('\n')}`
                    }
                ];
                
                // 2. Define structured output schema
                const finishedTodoCheckerSchema = z.object({
                    finishedTodoNames: z.array(z.string()).describe("List with names of todo points that has been finished after recent model call")
                });

                // 3. Synchronize messages with the model and call it
                const originalMessages = evaluationCheckerModel.config.messages;
                try {
                    console.log(`TODO-Plugin: Starting evaluation of finished tasks for ${executionPlace.nodeName}...`);
                    evaluationCheckerModel.config.messages = messagesForChecker;
                    const evaluationResult = await evaluationCheckerModel.invokeStructuredOutput(finishedTodoCheckerSchema, finishedTodoTecallTries);
                    const aiMessage = evaluationResult.answer.find((m): m is AIMessage => m.type === "ai");
                    const structured = aiMessage?.structuredOutput as { finishedTodoNames: string[] } | undefined;

                    // 5. Update state of points
                    if (structured?.finishedTodoNames && structured.finishedTodoNames.length > 0) {
                        console.log(`TODO-Plugin: Identified finished tasks: ${structured.finishedTodoNames.join(', ')}`);
                        for (const name of structured.finishedTodoNames) {
                            const point = currentTodos.find(p => p.name === name);
                            if (point && point.state !== "done") {
                                point.state = "done";
                            }
                        }
                    }
                } catch (error) {
                    // Log error but don't break the agent loop
                    console.error("TODO-Plugin: Evaluation of finished tasks failed", error);
                } finally {
                    // Restore original messages
                    evaluationCheckerModel.config.messages = originalMessages;
                }

                return {
                    status: true
                }
            }

            return {
                status: false
            }
        },
    };
}
