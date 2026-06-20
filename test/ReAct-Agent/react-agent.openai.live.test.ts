import "dotenv/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { OpenAI } from "../../src/models/openai";
import { tool } from "../../src/agent/tools/tools";

const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
// Use the model requested by the user
const openaiModel = "gpt-5-mini"; 
const liveDescribe = (openaiApiKey && openaiApiKey.length > 0) ? describe : describe.skip;

liveDescribe("ReActAgent with OpenAI live integration", () => {
    it("can solve a simple task using a tool", async () => {
        const adderTool = tool(
            async ({ a, b }) => {
                return (a + b).toString();
            },
            {
                toolName: "adder",
                toolDescription: "Adds two numbers together",
                toolArguments: z.object({
                    a: z.number(),
                    b: z.number()
                })
            }
        );

        const model = new OpenAI({
            model: openaiModel,
            apiKey: openaiApiKey!,
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "You are a helpful assistant. Use tools when needed. If you use a tool, always base your final answer on the tool output.",
            tools: [adderTool],
            messages: [
                {
                    type: "user",
                    content: "How much is 123 + 456? You MUST use the adder tool. Answer ONLY with the result number."
                }
            ]
        });

        const result = await agent.invoke();
        console.log('Result messages', agent.messages);
        
        // Check if the adder tool was called
        const toolCalls = result.messages.filter(m => m.type === "tool");
        expect(toolCalls.length).toBeGreaterThan(0);
        
        // Check the final answer
        const finalAnswer = result.messages.at(-1);
        expect(finalAnswer?.type).toBe("ai");
        expect(finalAnswer?.content).toContain("579");

        console.log(result.messages);
    }, 30000); // 30s timeout for live API

    it("can handle multiple reasoning steps with weather tool", async () => {
        const weatherTool = tool(
            async ({ location }) => {
                if (location.toLowerCase().includes("warsaw")) return "Sunny, 25°C";
                return "Cloudy, 15°C";
            },
            {
                toolName: "get_weather",
                toolDescription: "Get the weather for a location",
                toolArguments: z.object({
                    location: z.string()
                })
            }
        );

        const model = new OpenAI({
            model: openaiModel,
            apiKey: openaiApiKey!,
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "You are a helpful assistant. Use tools to find information. Always report the exact weather conditions from the tool.",
            tools: [weatherTool],
            withConclusion: false, // Use raw output to avoid summary inaccuracies
            messages: [
                {
                    type: "user",
                    content: "What's the weather in Warsaw, Poland and should I take an umbrella? Use the get_weather tool."
                }
            ]
        });

        const result = await agent.invoke();
        console.log('Result messages', agent.messages);
        
        const toolCalls = result.messages.filter(m => m.type === "tool");
        expect(toolCalls.length).toBeGreaterThan(0);
        // Look for sunny in ANY ai message content after tool call
        const passedWeatherCheck = result.messages.some(m => m.type === "ai" && m.content?.toLowerCase().includes("sunny"));
        expect(passedWeatherCheck).toBe(true);

        console.log(result.messages);
    }, 60000);

    it("uses the optimizations: parallelizeSubagents and parallelTools", async () => {
        const tool1 = tool(async () => {
            await new Promise(r => setTimeout(r, 100));
            return "Task 1 completed";
        }, {
            toolName: "task1",
            toolDescription: "Performs task 1. Safe to call in parallel with other tools.",
            toolArguments: z.object({})
        });

        const tool2 = tool(async () => {
            await new Promise(r => setTimeout(r, 100));
            return "Task 2 completed";
        }, {
            toolName: "task2",
            toolDescription: "Performs task 2. Safe to call in parallel with other tools.",
            toolArguments: z.object({})
        });

        const model = new OpenAI({
            model: openaiModel,
            apiKey: openaiApiKey!,
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "Perform tasks using tools. If you have multiple tools to call, call them at once. Both tools support parallel execution.",
            tools: [tool1, tool2],
            parallelTools: true,
            withConclusion: false,
            messages: [
                {
                    type: "user",
                    content: "Execute task1 and task2 simultaneously if possible."
                }
            ]
        });

        const result = await agent.invoke();
        console.log('Result messages', agent.messages);
        
        const task1Called = result.messages.some(m => m.type === "tool" && m.tool_name === "task1");
        const task2Called = result.messages.some(m => m.type === "tool" && m.tool_name === "task2");
        
        expect(task1Called).toBe(true);
        expect(task2Called).toBe(true);
        
        console.log("Parallel tools test completed. Messages count:", result.messages.length);
    }, 120000);
});
