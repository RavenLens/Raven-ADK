import { describe, expect, it } from "vitest";
import { generateCompressReActAgentPlugin, Tokenizer } from "../../src/agent/conversation";
import { MessagesVariations } from "../../src/agent/state";

describe("Conversation Tokenizer & Compaction Tests", () => {
    const mockTokenizer: Tokenizer = (content: string) => {
        // Simple word count, or character/4 if no spaces
        const words = content.split(/\s+/).filter(Boolean).length;
        return words > 0 ? words : Math.ceil(content.length / 4);
    };

    it("compresses conversation history when threshold is exceeded", async () => {
        const messages: MessagesVariations[] = [
            { type: "system", content: "You are an agent." },
            { type: "user", content: "User question number one. " + "long ".repeat(500) },
            { type: "tool", tool_id: "calculator", content: "small output", arguments: null },
            { type: "ai", content: "AI response number one." },
            { type: "user", content: "User question number two." },
            { type: "ai", content: "AI response number two." }
        ];

        const plugin = generateCompressReActAgentPlugin(
            { name: "mock-model", contextWindowTokens: 100 },
            mockTokenizer,
            50 // Compress if tokens exceed 50
        );

        const config = {
            model: {} as any,
            systemPrompt: "",
            messages,
            tools: []
        };

        const result = await plugin.execute(config, {});
        expect(result.status).toBe(true);
        expect(result.result?.agentConfig?.messages.length).toBe(6);

        // Find the compressed user message
        const compactedUserMsg = result.result?.agentConfig?.messages.find(m => m.type === "user");
        expect(compactedUserMsg).toBeDefined();
        expect(compactedUserMsg?.content).toContain("Truncated");
    });

    it("does not compress if threshold is not exceeded", async () => {
        const messages: MessagesVariations[] = [
            { type: "system", content: "You are an agent." },
            { type: "user", content: "Small prompt." }
        ];

        const plugin = generateCompressReActAgentPlugin(
            { name: "mock-model", contextWindowTokens: 1000 },
            mockTokenizer,
            80 // Compress if tokens exceed 800
        );

        const config = {
            model: {} as any,
            systemPrompt: "",
            messages,
            tools: []
        };

        const result = await plugin.execute(config, {});
        expect(result.status).toBe(false);
    });

    it("triggers events properly on context window changes", async () => {
        const messages: MessagesVariations[] = [
            { type: "system", content: "You are an agent." },
            { type: "user", content: "Small prompt." }
        ];

        let receivedContext: any = null;
        const plugin = generateCompressReActAgentPlugin(
            { name: "mock-model", contextWindowTokens: 1000 },
            mockTokenizer,
            80,
            (context) => {
                receivedContext = context;
            }
        );

        const config = {
            model: {} as any,
            systemPrompt: "",
            messages,
            tools: []
        };

        await plugin.execute(config, {});
        expect(receivedContext).not.toBeNull();
        expect(receivedContext.systemPrompt.tokens).toBe(4);
        expect(receivedContext.userPrompt.tokens).toBe(2);
    });
});
