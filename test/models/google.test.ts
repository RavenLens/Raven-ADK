import { beforeEach, describe, expect, it, vi } from "vitest";
import { Google } from "../../src/models/text-to-text/google";

const { googleGenerateContentMock, googleGenerateContentStreamMock } = vi.hoisted(() => ({
    googleGenerateContentMock: vi.fn(),
    googleGenerateContentStreamMock: vi.fn()
}));

vi.mock("@google/genai", () => ({
    GoogleGenAI: class {
        models = {
            generateContent: googleGenerateContentMock,
            generateContentStream: googleGenerateContentStreamMock
        };
    }
}));

describe("Google model wrapper", () => {
    beforeEach(() => {
        googleGenerateContentMock.mockReset();
        googleGenerateContentStreamMock.mockReset();
    });

    it("compacts history through structured output", async () => {
        googleGenerateContentMock.mockResolvedValueOnce({
            text: '{"summary":"The user chose deployment A."}',
            candidates: [{
                content: {
                    parts: [{ text: '{"summary":"The user chose deployment A."}' }]
                }
            }],
            usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 5
            }
        });

        const model = new Google({
            model: "gemini-2.5-flash",
            apiKey: "test-key"
        });

        const result = await model.compact({
            messages: [{ type: "user", content: "Choose deployment A." }]
        });

        expect(result).toStrictEqual([{
            type: "compaction",
            provider: "summary",
            content: "The user chose deployment A."
        }]);
        expect(model.config.messages).toBeUndefined();
        expect(googleGenerateContentMock).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gemini-2.5-flash",
                contents: expect.arrayContaining([
                    expect.objectContaining({ role: "user" })
                ])
            })
        );
    });

    it("stops forwarding stream events after abort", async () => {
        const streamEvents = [
            { candidates: [{ content: { parts: [{ text: "first" }] } }] },
            { candidates: [{ content: { parts: [{ text: "ignored" }] } }] }
        ];

        googleGenerateContentStreamMock.mockResolvedValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const event of streamEvents) {
                    yield event;
                }
            }
        });

        const controller = new AbortController();
        const model = new Google({ model: "gemini-3.6-flash", apiKey: "test-key" });
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

        expect(iteratedEvents).toStrictEqual([streamEvents[0]]);
        expect(emittedEvents).toStrictEqual([streamEvents[0]]);
    });
});
