import "dotenv/config";
import { describe, expect, it } from "vitest";
import { ReActAgent } from "../../../src/agent/ReAct.agent";
import { OpenAI } from "../../../src/models/text-to-text/openai";

const openAIKey = (process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY)?.trim();
const liveDescribe = (openAIKey && openAIKey.length > 0) ? describe : describe.skip;

liveDescribe("Plural Memory Systems - Live integration", () => {
    it("Agent should correctly use prefixed tools for specific memory domains", async () => {
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIKey!,
        });

        // Using simple in-memory stores for testing
        const createStore = (remember: string) => {
            let conclusion = "";
            return {
                config: { hasToRemember: remember, session: "live-test" },
                fetchMemoryConclusionFile: async () => conclusion,
                writeMemoryConclusionFile: async (content: string) => { conclusion = content; return true; },
                fetchMemory: async () => [],
                saveMemory: async () => true
            };
        };

        const identityStore = createStore("User name and age");
        const preferenceStore = createStore("User favorite food");

        const agent = new ReActAgent({
            model,
            systemPrompt: "You are a helpful assistant with memory.",
            tools: [],
            messages: [],
            parallelTools: true,
            memory: [
                { memory: identityStore, name: "identity", purpose: "Store user identity facts" },
                { memory: preferenceStore, name: "preferences", purpose: "Store user preferences" }
            ]
        });

        const result = await agent.invoke({
            messages: [
                { type: "user", content: "My name is John and I love Pizza. Save my name in Identity system and my food preference in Preferences system." }
            ]
        });

        console.log("Agent result", result)

        // Check if tool calls were made (looking at message history)
        const toolMessages = result.messages.filter(m => m.type === "tool");
        const toolNames = toolMessages.map(m => (m as any).tool_name);

        expect(toolNames.some(name => name.startsWith("identity_save_memory"))).toBe(true);
        expect(toolNames.some(name => name.startsWith("preferences_save_memory"))).toBe(true);
    }, 600_000);
});
