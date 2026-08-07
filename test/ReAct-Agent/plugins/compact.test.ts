import "dotenv/config";
import { describe, expect, it } from "vitest";
import { generateCompactReActAgentPlugin, Tokenizer } from "../../../src/agent/plugins/compaction";
import { MessagesVariations } from "../../../src/agent/state";
import { ReActAgent } from "../../../src/agent/ReAct.agent";
import { OpenAI } from "../../../src/models/openai";

describe("Mocking: Conversation Tokenizer & Compaction Tests", () => {
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

        const plugin = generateCompactReActAgentPlugin(
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

        const result = await plugin.execute({ nodeType: "aside", way: "after_agent_run" }, config, {});
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

        const plugin = generateCompactReActAgentPlugin(
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

        const result = await plugin.execute({
            nodeType: "aside",
            way: "after_agent_run"
        }, config, {});
        expect(result.status).toBe(false);
    });

    it("treats encrypted provider compaction state as bounded opaque metadata", async () => {
        const messages: MessagesVariations[] = [
            { type: "system", content: "You are an agent." },
            {
                type: "compaction",
                provider: "openai",
                encryptedContent: "ciphertext".repeat(10_000),
                items: [{ type: "compaction", encrypted_content: "opaque" }]
            },
            { type: "user", content: "Recent request." },
            { type: "ai", content: "Recent answer." },
            { type: "user", content: "Current request." },
            { type: "ai", content: "Current answer." }
        ];

        const characterTokenizer: Tokenizer = (content) => Math.ceil(content.length / 4);
        const plugin = generateCompactReActAgentPlugin(
            { name: "gpt-5", contextWindowTokens: 1000 },
            characterTokenizer,
            80
        );

        const result = await plugin.execute({ nodeType: "aside", way: "before_model_call" }, {
            model: {} as any,
            systemPrompt: "",
            messages,
            tools: []
        }, {});

        expect(result.status).toBe(false);
    });

    it("delegates older history to a provider compaction method", async () => {
        const messages: MessagesVariations[] = [
            { type: "system", content: "You are an agent." },
            { type: "user", content: "First request. " + "long ".repeat(500) },
            { type: "ai", content: "First answer." },
            { type: "user", content: "Second request." },
            { type: "ai", content: "Second answer." },
            { type: "user", content: "Most recent request." },
            { type: "ai", content: "Most recent answer." }
        ];
        const compact = async (options?: { messages?: MessagesVariations[] }) => [{
            type: "compaction" as const,
            provider: "summary" as const,
            content: `Compacted ${options?.messages?.length ?? 0} messages.`
        }];
        const plugin = generateCompactReActAgentPlugin(
            { name: "mock-model", contextWindowTokens: 100 },
            mockTokenizer,
            50
        );
        const config = {
            model: { compactionMode: "manual" as const, compact } as any,
            systemPrompt: "",
            messages,
            tools: []
        };

        const result = await plugin.execute({ nodeType: "aside", way: "before_model_call" }, config, {});

        expect(result.status).toBe(true);
        expect(result.result?.agentConfig?.messages).toStrictEqual([
            { type: "system", content: "You are an agent." },
            { type: "compaction", provider: "summary", content: "Compacted 2 messages." },
            { type: "user", content: "Second request." },
            { type: "ai", content: "Second answer." },
            { type: "user", content: "Most recent request." },
            { type: "ai", content: "Most recent answer." }
        ]);
    });

    it("force truncates with the configured size without using provider compaction", async () => {
        const messages: MessagesVariations[] = [
            { type: "system", content: "You are an agent." },
            { type: "user", content: "Old request " + "x".repeat(100) },
            { type: "ai", content: "Old response " + "y".repeat(100) },
            { type: "user", content: "Recent request." },
            { type: "ai", content: "Recent response." },
            { type: "user", content: "Current request." }
        ];
        const compact = async () => {
            throw new Error("compact() should not be called when forceTruncate is enabled");
        };
        const plugin = generateCompactReActAgentPlugin(
            { name: "mock-model", contextWindowTokens: 50 },
            mockTokenizer,
            10,
            undefined,
            { forceTruncate: true, truncateSize: 12 }
        );
        const config = {
            model: { compactionMode: "automatic" as const, compact } as any,
            systemPrompt: "",
            messages,
            tools: []
        };

        const result = await plugin.execute({ nodeType: "aside", way: "before_model_call" }, config, {});

        expect(result.status).toBe(true);
        const compactedUser = result.result?.agentConfig?.messages.find(
            message => message.type === "user" && message.content?.includes("Truncated user prompt")
        );
        expect(compactedUser?.content).toContain("Old request ");
        expect(compactedUser?.content?.length).toBeGreaterThan(12);
        expect(compactedUser?.content?.length).toBeLessThan(100);
    });

    it("triggers events properly on context window changes", async () => {
        const messages: MessagesVariations[] = [
            { type: "system", content: "You are an agent." },
            { type: "user", content: "Small prompt." }
        ];

        let receivedContext: any = null;
        const plugin = generateCompactReActAgentPlugin(
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

        await plugin.execute({ nodeType: "aside", way: "after_agent_run" }, config, {});
        expect(receivedContext).not.toBeNull();
        expect(receivedContext.systemPrompt.tokens).toBe(4);
        expect(receivedContext.userPrompt.tokens).toBe(2);
    });
});

describe("OpenAI Compression Test", () => {
    const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
    const liveDescribe = openAIApiKey ? describe : describe.skip;

    liveDescribe("OpenAI live compaction", () => {
        it("compacts older ReAct agent messages with the real OpenAI model", async () => {
            const model = new OpenAI({
                model: "gpt-5-mini",
                apiKey: openAIApiKey!,
                compaction: {
                    compactThreshold: 1000
                }
            });
            const tokenizer: Tokenizer = (content) => Math.ceil(content.length / 4);
            const compactPlugin = generateCompactReActAgentPlugin(
                {
                    name: "gpt-5-mini",
                    contextWindowTokens: 100
                },
                tokenizer,
                10
            );
            const agent = new ReActAgent({
                model,
                systemPrompt: "Answer briefly and clearly.",
                tools: [],
                plugins: [compactPlugin],
                withConclusion: false,
                messages: [
                    { type: "user", content: "Earlier user request: " + "context ".repeat(80) },
                    { type: "ai", content: "Earlier assistant response: " + "details ".repeat(80) },
                    { type: "user", content: "Another earlier request: " + "history ".repeat(80) },
                    { type: "ai", content: "Another earlier response: " + "information ".repeat(80) },
                    { type: "user", content: "A preserved user request." },
                    { type: "ai", content: "A preserved assistant response." },
                    { type: "user", content: "The current request is: reply with the word compacted." }
                ]
            });

            agent.onEvent("llm_result", (result) => {
                console.log("LLM Result:", result)
            })

            const result = await agent.invoke();
            const compaction = result.messages.find(
                (message) => message.type === "compaction" && message.provider === "openai"
            );
            console.log('Result:', result, "\n\nCompaction:", compaction)

            expect(compaction).toBeDefined();
            expect(result.messages.some(
                (message) => message.type === "ai" && message.content?.toLowerCase().includes("compacted")
            )).toBe(true);
        }, 100_000_000);
    });
});
