import "dotenv/config";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { Google } from "../../src/models/google";
import { tool } from "../../src/agent/tools/tools";

const googleApiKey = (process.env.GEMINI_API_KEY_RAVENADK || process.env.GOOGLE_API_KEY)?.trim();
const liveDescribe = (googleApiKey && googleApiKey.length > 0) ? describe : describe.skip;

liveDescribe("ReActAgent with Google Gemini live integration", () => {
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

        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: googleApiKey!,
            temperature: 0
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "You are a helpful assistant. Use tools when needed.",
            tools: [adderTool],
            messages: [
                {
                    type: "user",
                    content: "How much is 123 + 456? Answer only with the result number."
                }
            ]
        });

        const result = await agent.invoke();
        
        // Check if the adder tool was called
        const toolCalls = result.messages.filter(m => m.type === "tool");
        expect(toolCalls.length).toBeGreaterThan(0);
        
        // Check the final answer
        const finalAnswer = result.messages.at(-1);
        expect(finalAnswer?.type).toBe("ai");
        expect(finalAnswer?.content).toContain("579");

        console.log(result.messages)
    }, 30000); // 30s timeout for live API

    it("can handle multiple reasoning steps", async () => {
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

        const model = new Google({
            model: "gemini-3-flash-preview",
            apiKey: googleApiKey!,
            temperature: 0
        });

        const agent = new ReActAgent({
            model,
            systemPrompt: "You are a helpful assistant. Use tools to find information.",
            tools: [weatherTool],
            messages: [
                {
                    type: "user",
                    content: "What's the weather in Warsaw and should I take an umbrella?"
                }
            ]
        });

        const result = await agent.invoke();
        
        const toolCalls = result.messages.filter(m => m.type === "tool");
        expect(toolCalls.length).toBeGreaterThan(0);
        expect(result.messages.some(m => m.type === "ai" && m.content?.toLowerCase().includes("sunny"))).toBe(true);

        console.log(result.messages)
    }, 60000);
});
