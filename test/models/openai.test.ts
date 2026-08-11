import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { tool } from "../../src/agent/tools/tools";
import { OpenAI } from "../../src/models/openai";

const { openaiResponsesCreateMock, openaiResponsesCompactMock, openaiChatCreateMock, openaiCompletionsCreateMock, openaiCtorMock } = vi.hoisted(() => ({
    openaiResponsesCreateMock: vi.fn(),
    openaiResponsesCompactMock: vi.fn(),
    openaiChatCreateMock: vi.fn(),
    openaiCompletionsCreateMock: vi.fn(),
    openaiCtorMock: vi.fn()
}));

vi.mock("openai", () => ({
    OpenAI: class {
        responses = {
            create: openaiResponsesCreateMock,
            compact: openaiResponsesCompactMock
        };
        chat = {
            completions: {
                create: openaiChatCreateMock
            }
        };
        completions = {
            create: openaiCompletionsCreateMock
        };

        constructor(config: unknown) {
            openaiCtorMock(config);
        }
    }
}));

describe("OpenAI model wrapper", () => {
    beforeEach(() => {
        openaiResponsesCreateMock.mockReset();
        openaiResponsesCompactMock.mockReset();
        openaiChatCreateMock.mockReset();
        openaiCompletionsCreateMock.mockReset();
        openaiCtorMock.mockReset();
    });

    it("maps Raven messages/tools into Responses API payload and output", async () => {
        openaiResponsesCreateMock.mockResolvedValueOnce({
            id: "resp_1",
            created_at: 1,
            output_text: "It is 20C in Paris.",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: null,
            model: "gpt-4.1-mini",
            object: "response",
            output: [
                {
                    type: "custom_tool_call",
                    call_id: "call_1",
                    name: "get_weather",
                    input: '{"location":"Paris"}'
                }
            ],
            parallel_tool_calls: false,
            temperature: null,
            tool_choice: "auto",
            tools: [],
            usage: {
                input_tokens: 11,
                output_tokens: 7,
                total_tokens: 18,
                input_tokens_details: {
                    cached_tokens: 0
                },
                output_tokens_details: {
                    reasoning_tokens: 2
                }
            },
            top_p: 1,
            text: {
                format: {
                    type: "text"
                }
            },
            status: "completed"
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

        const model = new OpenAI({
            model: "gpt-4.1-mini",
            apiKey: "test-key",
            tools: [weatherTool],
            messages: [
                { type: "user", content: "What is weather in Paris?" },
                { type: "ai", content: "Let me check that for you." },
                { type: "tool", tool_id: "call_0", content: "{}", arguments: {}, toolOutput: "{}" }
            ]
        });

        const result = await model.invoke();

        expect(openaiCtorMock).toHaveBeenCalledWith({
            apiKey: "test-key",
            baseURL: undefined
        });
        expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(1);
        expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-4.1-mini",
                input: [
                    { role: "user", content: "What is weather in Paris?" },
                    { role: "assistant", content: "Let me check that for you." },
                    { type: "custom_tool_call", call_id: "call_0", name: "", input: "{}" },
                    { type: "custom_tool_call_output", call_id: "call_0", output: "{}" }
                ],
                tools: [
                    expect.objectContaining({
                        type: "function",
                        name: "get_weather",
                        description: expect.stringContaining("Get weather data for a city"),
                        parameters: expect.objectContaining({ type: "object" })
                    })
                ],
                stream: false
            }),
            expect.objectContaining({ signal: undefined })
        );

        expect(result.tokens).toStrictEqual({
            input: 11,
            output: 7,
            reasoning: 2
        });
        expect(result.answer).toStrictEqual([
            {
                type: "ai",
                content: "It is 20C in Paris.",
                calledTools: [
                    {
                        type: "tool",
                        tool_id: "call_1",
                        tool_name: "get_weather",
                        content: '{"location":"Paris"}',
                        arguments: { location: "Paris" }
                    }
                ]
            }
        ]);
        expect(result.messages).toHaveLength(4);
    });

    it("returns a stream when invoke is called with stream: true and emits stream events", async () => {
        const streamEvents = [
            {
                type: "response.created",
                sequence_number: 1,
                response: {
                    id: "resp_stream_1"
                }
            },
            {
                type: "response.completed",
                sequence_number: 2,
                response: {
                    id: "resp_stream_1"
                }
            }
        ];

        openaiResponsesCreateMock.mockResolvedValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const event of streamEvents) {
                    yield event;
                }
            }
        });

        const model = new OpenAI({
            model: "gpt-5.5",
            apiKey: "test-key",
            tools: [],
            messages: [
                { type: "user", content: "Say 'double bubble bath' ten times fast." }
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

        expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-5.5",
                input: [
                    {
                        role: "user",
                        content: "Say 'double bubble bath' ten times fast."
                    }
                ],
                stream: true
            }),
            expect.objectContaining({ signal: undefined })
        );
        expect(iteratedEvents).toStrictEqual(streamEvents);
        expect(emittedEvents).toStrictEqual(streamEvents);
    });

    it("stops forwarding stream events after abort", async () => {
        const streamEvents = [
            { type: "response.created", sequence_number: 1 },
            { type: "response.completed", sequence_number: 2 }
        ];

        openaiResponsesCreateMock.mockResolvedValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const event of streamEvents) {
                    yield event;
                }
            }
        });

        const controller = new AbortController();
        const model = new OpenAI({ model: "gpt-5.5", apiKey: "test-key" });
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

        expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
            expect.anything(),
            { signal: controller.signal }
        );
        expect(iteratedEvents).toStrictEqual([streamEvents[0]]);
        expect(emittedEvents).toStrictEqual([streamEvents[0]]);
    });

    it("retries invokeStructuredOutput until the response matches the schema", async () => {
        openaiResponsesCreateMock
            .mockResolvedValueOnce({
                id: "resp_invalid",
                created_at: 1,
                output_text: "not json",
                error: null,
                incomplete_details: null,
                instructions: null,
                metadata: null,
                model: "gpt-4.1-mini",
                object: "response",
                output: [],
                parallel_tool_calls: false,
                temperature: null,
                tool_choice: "auto",
                tools: [],
                usage: {
                    input_tokens: 8,
                    output_tokens: 3,
                    total_tokens: 11,
                    input_tokens_details: {
                        cached_tokens: 0
                    },
                    output_tokens_details: {
                        reasoning_tokens: 0
                    }
                },
                top_p: 1,
                text: {
                    format: {
                        type: "text"
                    }
                },
                status: "completed"
            })
            .mockResolvedValueOnce({
                id: "resp_valid",
                created_at: 2,
                output_text: '{"city":"Paris","country":"France"}',
                error: null,
                incomplete_details: null,
                instructions: null,
                metadata: null,
                model: "gpt-4.1-mini",
                object: "response",
                output: [],
                parallel_tool_calls: false,
                temperature: null,
                tool_choice: "auto",
                tools: [],
                usage: {
                    input_tokens: 9,
                    output_tokens: 4,
                    total_tokens: 13,
                    input_tokens_details: {
                        cached_tokens: 0
                    },
                    output_tokens_details: {
                        reasoning_tokens: 0
                    }
                },
                top_p: 1,
                text: {
                    format: {
                        type: "text"
                    }
                },
                status: "completed"
            });

        const model = new OpenAI({
            model: "gpt-4.1-mini",
            apiKey: "test-key",
            tools: [],
            messages: [
                { type: "user", content: "Return a JSON object with city and country for Paris, France." }
            ]
        });

        const schema = z.object({
            city: z.string(),
            country: z.string()
        });

        const result = await model.invokeStructuredOutput(schema, 1);

        expect(openaiResponsesCreateMock).toHaveBeenCalledTimes(2);
        expect(result.answer).toHaveLength(1);
        expect(result.answer[0]).toStrictEqual({
            type: "ai",
            content: '{"city":"Paris","country":"France"}',
            calledTools: [],
            structuredOutput: {
                city: "Paris",
                country: "France"
            }
        });
        expect(result.messages.at(-1)).toStrictEqual({
            type: "ai",
            content: '{"city":"Paris","country":"France"}',
            calledTools: [],
            structuredOutput: {
                city: "Paris",
                country: "France"
            }
        });
    });

    it("enables OpenAI server-side compaction and retains its opaque output item", async () => {
        openaiResponsesCreateMock.mockResolvedValueOnce({
            output_text: "Continued.",
            output: [{
                type: "compaction",
                id: "cmp_1",
                encrypted_content: "opaque-compaction-state"
            }],
            usage: {
                input_tokens: 12,
                output_tokens: 2,
                output_tokens_details: { reasoning_tokens: 0 }
            }
        });

        const model = new OpenAI({
            model: "gpt-5.3-codex",
            apiKey: "test-key",
            compaction: { compactThreshold: 200000 },
            messages: [{ type: "user", content: "Continue a long task." }]
        });

        const result = await model.invoke();

        expect(openaiResponsesCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                context_management: [{ type: "compaction", compact_threshold: 200000 }]
            }),
            expect.objectContaining({ signal: undefined })
        );
        expect(result.messages).toContainEqual({
            type: "compaction",
            provider: "openai",
            encryptedContent: "opaque-compaction-state",
            items: [{
                type: "compaction",
                id: "cmp_1",
                encrypted_content: "opaque-compaction-state"
            }]
        });
    });

    it("uses the standalone Responses compact endpoint and preserves its full output window", async () => {
        const compactedWindow = [
            { role: "user", content: "Start the task." },
            { type: "compaction", id: "cmp_1", encrypted_content: "opaque-compaction-state" }
        ];
        openaiResponsesCompactMock.mockResolvedValueOnce({ output: compactedWindow });

        const model = new OpenAI({
            model: "gpt-5.6",
            apiKey: "test-key",
            messages: [{ type: "user", content: "Start the task." }]
        });

        const result = await model.compact();

        expect(openaiResponsesCompactMock).toHaveBeenCalledWith({
            model: "gpt-5.6",
            input: [{ role: "user", content: "Start the task." }]
        }, { signal: undefined });
        expect(result).toStrictEqual([{
            type: "compaction",
            provider: "openai",
            items: compactedWindow
        }]);
    });

    it("falls back to legacy chat completions for non-OpenAI baseURL", async () => {
        openaiChatCreateMock.mockResolvedValueOnce({
            id: "chat_1",
            choices: [{
                message: { role: "assistant", content: "Chat response" },
                finish_reason: "stop",
                index: 0
            }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
            object: "chat.completion",
            created: 1,
            model: "other-model"
        });

        const model = new OpenAI({
            model: "other-model",
            apiKey: "test-key",
            baseURL: "https://api.runpod.ai/v2/foo/openai/v1",
            messages: [{ type: "user", content: "Hi" }]
        });

        const result = await model.invoke();

        expect(openaiChatCreateMock).toHaveBeenCalledTimes(1);
        expect(openaiChatCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "other-model",
                messages: [{ role: "user", content: "Hi" }],
                stream: false
            }),
            expect.objectContaining({ signal: undefined })
        );
        expect(result.answer[0].content).toBe("Chat response");
    });

    it("falls back to completions for base models", async () => {
        openaiCompletionsCreateMock.mockResolvedValueOnce({
            id: "cmpl_1",
            choices: [{
                text: " Completion response",
                finish_reason: "length",
                index: 0
            }],
            usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
            object: "text_completion",
            created: 1,
            model: "llama-3-base"
        });

        const model = new OpenAI({
            model: "llama-3-base",
            apiKey: "test-key",
            baseURL: "https://api.runpod.ai/v2/foo/openai/v1",
            messages: [{ type: "user", content: "Hi" }]
        });

        const result = await model.invoke();

        expect(openaiCompletionsCreateMock).toHaveBeenCalledTimes(1);
        expect(openaiCompletionsCreateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "llama-3-base",
                prompt: "User: Hi",
                stream: false
            }),
            expect.objectContaining({ signal: undefined })
        );
        expect(result.answer[0].content).toBe("Completion response");
    });
});
