import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool } from "../../src/agent/tools";
import { Anthropic } from "../../src/models/anthropic";

const { anthropicCreateMock, anthropicStreamMock, anthropicBetaCreateMock, anthropicBetaStreamMock, anthropicCtorMock } = vi.hoisted(() => ({
    anthropicCreateMock: vi.fn(),
    anthropicStreamMock: vi.fn(),
    anthropicBetaCreateMock: vi.fn(),
    anthropicBetaStreamMock: vi.fn(),
    anthropicCtorMock: vi.fn()
}));

vi.mock("@anthropic-ai/sdk", () => ({
    Anthropic: class {
        messages = {
            create: anthropicCreateMock,
            stream: anthropicStreamMock
        };
        beta = {
            messages: {
                create: anthropicBetaCreateMock,
                stream: anthropicBetaStreamMock
            }
        };

        constructor(config: unknown) {
            anthropicCtorMock(config);
        }
    }
}));

describe("Anthropic model wrapper", () => {
    beforeEach(() => {
        anthropicCreateMock.mockReset();
        anthropicStreamMock.mockReset();
        anthropicBetaCreateMock.mockReset();
        anthropicBetaStreamMock.mockReset();
        anthropicCtorMock.mockReset();
    });

    it("maps Raven messages/tools into Anthropic payload and output, including thinking", async () => {
        anthropicCreateMock.mockResolvedValueOnce({
            content: [
                {
                    type: "thinking",
                    thinking: "I should first call the weather tool.",
                    signature: "sig_thinking_1"
                },
                {
                    type: "text",
                    text: "I will call a weather tool."
                },
                {
                    type: "tool_use",
                    id: "toolu_1",
                    name: "get_weather",
                    input: {
                        location: "Paris"
                    },
                    caller: "direct"
                }
            ],
            usage: {
                input_tokens: 13,
                output_tokens: 8
            }
        });

        const weatherTool = tool(
            ({ location }: { location: string }) => `Weather for ${location}`,
            {
                toolName: "get_weather",
                toolDescription: "Get weather data for a city",
                toolArguments: z.object({
                    location: z.string().describe("City name")
                }),
                toolOutputSchema: z.object({
                    temperature: z.number()
                })
            }
        );

        const model = new Anthropic({
            model: "claude-3-5-haiku-20241022",
            apiKey: "test-key",
            thinking: {
                type: "enabled",
                budget_tokens: 1024
            },
            tools: [weatherTool],
            messages: [
                { type: "user", content: "What is weather in Paris?" },
                { type: "ai", content: "Let me check that for you." },
                { type: "thinking", content: "I should verify tool output shape.", signature: "sig_prev" },
                { type: "tool", tool_id: "toolu_prev", content: "{}", arguments: {} }
            ]
        });

        const result = await model.invoke();

        expect(anthropicCtorMock).toHaveBeenCalledWith({
            apiKey: "test-key",
            baseURL: undefined
        });
        expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
        expect(anthropicCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "claude-3-5-haiku-20241022",
                max_tokens: 1024,
                messages: [
                    { role: "user", content: "What is weather in Paris?" },
                    { role: "assistant", content: "Let me check that for you." },
                    {
                        role: "assistant",
                        content: [
                            {
                                type: "thinking",
                                thinking: "I should verify tool output shape.",
                                signature: "sig_prev"
                            }
                        ]
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "tool_result",
                                tool_use_id: "toolu_prev",
                                content: "{}"
                            }
                        ]
                    }
                ],
                tools: [
                    expect.objectContaining({
                        name: "get_weather",
                        description: expect.stringContaining("Get weather data for a city"),
                        input_schema: expect.objectContaining({
                            type: "object"
                        })
                    })
                ],
                thinking: {
                    type: "enabled",
                    budget_tokens: 1024
                }
            }),
            expect.objectContaining({ signal: undefined })
        );

        expect(result.tokens).toStrictEqual({
            input: 13,
            output: 8,
            reasoning: 0
        });
        expect(result.answer).toStrictEqual([
            {
                type: "thinking",
                content: "I should first call the weather tool.",
                signature: "sig_thinking_1"
            },
            {
                type: "ai",
                content: "I will call a weather tool.",
                calledTools: [
                    {
                        type: "tool",
                        tool_id: "toolu_1",
                        tool_name: "get_weather",
                        content: '{"location":"Paris"}',
                        arguments: { location: "Paris" }
                    }
                ]
            },
            {
                type: "tool",
                tool_id: "toolu_1",
                tool_name: "get_weather",
                content: '{"location":"Paris"}',
                arguments: { location: "Paris" }
            }
        ]);
        expect(result.messages).toHaveLength(7);
    });

    it("falls back to assistant text when thinking signature is missing", async () => {
        anthropicCreateMock.mockResolvedValueOnce({
            content: [
                {
                    type: "text",
                    text: "Done"
                }
            ],
            usage: {
                input_tokens: 5,
                output_tokens: 2
            }
        });

        const model = new Anthropic({
            model: "claude-3-5-haiku-20241022",
            apiKey: "test-key",
            tools: [],
            messages: [
                { type: "thinking", content: "Unsigned reasoning" },
                { type: "user", content: "Continue" }
            ]
        });

        await model.invoke();

        expect(anthropicCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: [
                    {
                        role: "assistant",
                        content: "Assistant thoughts: Unsigned reasoning"
                    },
                    {
                        role: "user",
                        content: "Continue"
                    }
                ]
            }),
            expect.objectContaining({ signal: undefined })
        );
    });

    it("enables server-side compaction and preserves returned compact blocks", async () => {
        anthropicBetaCreateMock.mockResolvedValueOnce({
            content: [
                {
                    type: "compaction",
                    content: "The user is planning a deployment.",
                    encrypted_content: "opaque-compaction-state"
                },
                {
                    type: "text",
                    text: "I can continue from that summary."
                }
            ],
            usage: {
                input_tokens: 100,
                output_tokens: 20
            }
        });

        const model = new Anthropic({
            model: "claude-sonnet-5",
            apiKey: "test-key",
            compaction: {
                triggerTokens: 50000,
                instructions: "Keep deployment decisions.",
                pauseAfterCompaction: true
            },
            messages: [{ type: "user", content: "Plan a deployment." }]
        });

        const result = await model.invoke();

        expect(anthropicBetaCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                betas: ["compact-2026-01-12"],
                context_management: {
                    edits: [{
                        type: "compact_20260112",
                        trigger: { type: "input_tokens", value: 50000 },
                        instructions: "Keep deployment decisions.",
                        pause_after_compaction: true
                    }]
                }
            }),
            expect.objectContaining({ signal: undefined })
        );
        expect(result.messages).toContainEqual({
            type: "compaction",
            provider: "anthropic",
            content: "The user is planning a deployment.",
            encryptedContent: "opaque-compaction-state"
        });
    });

    it("round-trips Anthropic compact blocks through a later request", async () => {
        anthropicBetaCreateMock.mockResolvedValueOnce({
            content: [{ type: "text", text: "Continued." }],
            usage: { input_tokens: 12, output_tokens: 2 }
        });

        const model = new Anthropic({
            model: "claude-sonnet-5",
            apiKey: "test-key",
            messages: [
                {
                    type: "compaction",
                    provider: "anthropic",
                    content: "Saved state",
                    encryptedContent: "opaque-compaction-state"
                },
                { type: "user", content: "Continue." }
            ]
        });

        await model.invoke();

        expect(anthropicBetaCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: [
                    {
                        role: "assistant",
                        content: [{
                            type: "compaction",
                            content: "Saved state",
                            encrypted_content: "opaque-compaction-state"
                        }]
                    },
                    { role: "user", content: "Continue." }
                ]
            }),
            expect.objectContaining({ signal: undefined })
        );
    });

    it("returns a stream on invoke({ stream: true }) and emits stream events", async () => {
        const streamEvents = [
            {
                type: "message_start",
                message: {
                    id: "msg_1"
                }
            },
            {
                type: "message_stop"
            }
        ];

        anthropicStreamMock.mockReturnValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const event of streamEvents) {
                    yield event;
                }
            }
        });

        const model = new Anthropic({
            model: "claude-3-5-haiku-20241022",
            apiKey: "test-key",
            tools: [],
            messages: [
                { type: "user", content: "Stream this response." }
            ]
        });

        const emittedEvents: unknown[] = [];
        model.onEvent("stream", (event) => {
            emittedEvents.push(event);
        });

        const stream = await model.invoke({ stream: true });
        const iteratedEvents: unknown[] = [];

        for await (const event of stream) {
            iteratedEvents.push(event);
        }

        expect(anthropicStreamMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "claude-3-5-haiku-20241022",
                max_tokens: 1024,
                messages: [
                    {
                        role: "user",
                        content: "Stream this response."
                    }
                ]
            }),
            expect.objectContaining({ signal: undefined })
        );
        expect(iteratedEvents).toStrictEqual(streamEvents);
        expect(emittedEvents).toStrictEqual(streamEvents);
    });

    it("stops forwarding stream events after abort", async () => {
        const streamEvents = [
            { type: "message_start" },
            { type: "content_block_delta", delta: { type: "text_delta", text: "ignored" } }
        ];

        anthropicStreamMock.mockReturnValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const event of streamEvents) {
                    yield event;
                }
            }
        });

        const controller = new AbortController();
        const model = new Anthropic({
            model: "claude-3-5-haiku-20241022",
            apiKey: "test-key",
            tools: [],
            messages: [{ type: "user", content: "Stream this response." }]
        });

        const emittedEvents: unknown[] = [];
        model.onEvent("stream", (event) => {
            emittedEvents.push(event);
            controller.abort();
        });

        const stream = await model.invoke({ stream: true, abort: controller.signal });
        const iteratedEvents: unknown[] = [];

        for await (const event of stream) {
            iteratedEvents.push(event);
        }

        expect(anthropicStreamMock).toHaveBeenCalledWith(
            expect.anything(),
            { signal: controller.signal }
        );
        expect(iteratedEvents).toStrictEqual([streamEvents[0]]);
        expect(emittedEvents).toStrictEqual([streamEvents[0]]);
    });
});
