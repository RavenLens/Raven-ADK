import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunPod } from "../../src/models/text-to-text/runpod";
import { AIMessage } from "../../src/agent/state";

const { runpodEndpointMock, runpodSdkMock } = vi.hoisted(() => ({
    runpodEndpointMock: {
        run: vi.fn(),
        runSync: vi.fn(),
        stream: vi.fn()
    },
    runpodSdkMock: vi.fn()
}));

vi.mock("runpod-sdk", () => ({
    default: (apiKey: string, config: any) => {
        runpodSdkMock(apiKey, config);
        return {
            endpoint: (id: string) => {
                if (id === "invalid") return null;
                return runpodEndpointMock;
            }
        };
    }
}));

describe("RunPod model wrapper", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("initializes correctly with valid config", () => {
        const model = new RunPod({
            apiKey: "test-key",
            endpointId: "test-endpoint",
            model: "test-model"
        });
        expect(runpodSdkMock).toHaveBeenCalledWith("test-key", undefined);
    });

    it("throws error if apiKey is missing", () => {
        expect(() => new RunPod({ endpointId: "id", model: "m" } as any)).toThrow("RunPod API key is required.");
    });

    it("throws error if endpointId is missing", () => {
        expect(() => new RunPod({ apiKey: "key", model: "m" } as any)).toThrow("RunPod endpointId is required.");
    });

    it("prepares chat messages correctly", async () => {
        const model = new RunPod({
            apiKey: "key",
            endpointId: "id",
            model: "test-model",
            messages: [
                { type: "system", content: "sys" },
                { type: "user", content: "hello" },
                { type: "ai", content: "hi" },
                { type: "thinking", content: "thought" }
            ]
        });

        runpodEndpointMock.runSync.mockResolvedValueOnce({
            output: "response",
            usage: { input_tokens: 10, output_tokens: 5 }
        });

        const result = await model.invoke();
        
        expect(runpodEndpointMock.runSync).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.objectContaining({
                    model: "test-model",
                    messages: [
                        { role: "system", content: "sys" },
                        { role: "user", content: "hello" },
                        { role: "assistant", content: "hi" },
                        { role: "assistant", content: "Assistant thoughts: thought" }
                    ]
                })
            }),
            undefined
        );

        expect((result.answer[0] as AIMessage).content).toBe("response");
        expect(result.tokens.input).toBe(10);
        expect(result.tokens.output).toBe(5);
    });

    it("prepares prompt mode correctly when no structured messages", async () => {
        const model = new RunPod({
            apiKey: "key",
            endpointId: "id",
            model: "test-model",
            messages: [
                { type: "user", content: "hello" }
            ]
        });

        runpodEndpointMock.runSync.mockResolvedValueOnce({
            output: "response"
        });

        await model.invoke();
        
        expect(runpodEndpointMock.runSync).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.objectContaining({
                    prompt: "User: hello"
                })
            }),
            undefined
        );
    });

    it("extracts text from various response structures", async () => {
        const model = new RunPod({ apiKey: "key", endpointId: "id", model: "m" });

        const testCases = [
            { response: { output: "text1" }, expected: "text1" },
            { response: { output: { text: "text2" } }, expected: "text2" },
            { response: { output: { choices: [{ text: "text3" }] } }, expected: "text3" },
            { response: { output: { choices: [{ message: { content: "text4" } }] } }, expected: "text4" },
            { response: { output: { choices: [{ tokens: ["text", "5"] }] } }, expected: "text5" },
            { response: { output: { generated_text: "text6" } }, expected: "text6" }
        ];

        for (const { response, expected } of testCases) {
            runpodEndpointMock.runSync.mockResolvedValueOnce(response);
            const result = await model.invoke();
            expect((result.answer[0] as AIMessage).content).toBe(expected);
        }
    });

    it("compacts history with structured output for endpoint-agnostic RunPod workers", async () => {
        const model = new RunPod({ apiKey: "key", endpointId: "id", model: "m" });
        runpodEndpointMock.runSync.mockResolvedValueOnce({
            output: '{"summary":"The user chose deployment A."}'
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
    });

    it("stops yielding stream chunks after abort", async () => {
        const streamChunks = [{ output: "first" }, { output: "ignored" }];
        runpodEndpointMock.run.mockResolvedValueOnce({ id: "request-1" });
        runpodEndpointMock.stream.mockReturnValueOnce({
            async *[Symbol.asyncIterator]() {
                for (const chunk of streamChunks) {
                    yield chunk;
                }
            }
        });

        const controller = new AbortController();
        const model = new RunPod({ apiKey: "key", endpointId: "id", model: "m" });
        const stream = await model.invoke({ stream: true, abort: controller.signal });
        const yieldedChunks: unknown[] = [];

        for await (const chunk of stream) {
            yieldedChunks.push(chunk);
            controller.abort();
        }

        expect(yieldedChunks).toStrictEqual([streamChunks[0]]);
    });
});
