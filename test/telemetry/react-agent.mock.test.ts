import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { tool } from "../../src/agent/tools/tools";
import { z } from "zod";

// Mock OpenTelemetry API
const { mockSpan, mockTracer, mockMeter } = vi.hoisted(() => {
    const span = {
        setAttribute: vi.fn(),
        addEvent: vi.fn(),
        setStatus: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
    };
    return {
        mockSpan: span,
        mockTracer: {
            startActiveSpan: vi.fn((name, optionsOrCb, cb) => {
                const effectiveCb = typeof optionsOrCb === "function" ? optionsOrCb : cb;
                return effectiveCb(span);
            }),
        },
        mockMeter: {
            createCounter: vi.fn().mockReturnValue({
                add: vi.fn(),
            }),
        },
    };
});

vi.mock("@opentelemetry/api", () => ({
    trace: {
        getTracer: vi.fn().mockReturnValue(mockTracer),
        getActiveSpan: vi.fn().mockReturnValue(mockSpan),
    },
    metrics: {
        getMeter: vi.fn().mockReturnValue(mockMeter),
    },
    SpanStatusCode: {
        OK: 1,
        ERROR: 2,
    },
}));

// Mock Model
const mockModel = {
    config: {
        model: "test-model",
        apiKey: "test-key",
        messages: [],
        tools: [],
    },
    invoke: vi.fn().mockResolvedValue({
        answer: [{ type: "ai", content: "Hello" }],
        messages: [{ type: "ai", content: "Hello" }],
        tokens: { input: 10, output: 5, reasoning: 0 },
    }),
};

describe("ReActAgent Telemetry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should start a span and set attributes in constructor", () => {
        const agent = new ReActAgent({
            model: mockModel as any,
            systemPrompt: "You are a test agent",
            messages: [{ type: "user", content: "Hi" }],
            tools: [],
            telemetry: { send: vi.fn() } as any,
        });

        expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
            "agent.config_constructor_details",
            expect.any(Function)
        );
        expect(mockSpan.setAttribute).toHaveBeenCalledWith("agent.main_model", "test-model");
        expect(mockSpan.setAttribute).toHaveBeenCalledWith("agent.task_query", "Hi");
    });

    it("should start a run span and track token usage during invoke", async () => {
        const agent = new ReActAgent({
            model: mockModel as any,
            systemPrompt: "You are a test agent",
            messages: [{ type: "user", content: "Hi" }],
            tools: [
                tool(() => "weather is nice", {
                    toolName: "get_weather",
                    toolDescription: "Get weather",
                    toolArguments: z.object({}),
                }),
            ],
            telemetry: { send: vi.fn() } as any,
        });

        await agent.invoke();

        expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
            "agent.react_run",
            expect.any(Object),
            expect.any(Function)
        );

        // Verify tokens were recorded
        expect(mockMeter.createCounter().add).toHaveBeenCalledWith(
            10,
            expect.objectContaining({ type: "input", model: "test-model" })
        );
        expect(mockMeter.createCounter().add).toHaveBeenCalledWith(
            5,
            expect.objectContaining({ type: "output", model: "test-model" })
        );
    });

    it("should record tool usage events", async () => {
        // Need to mock model to call a tool first
        mockModel.invoke.mockResolvedValueOnce({
            answer: [{ type: "ai", content: "I will check weather", calledTools: [{ tool_id: "call_1", tool_name: "get_weather", arguments: {} } as any] }],
            messages: [],
            tokens: { input: 10, output: 5, reasoning: 0 },
        }).mockResolvedValueOnce({
            answer: [{ type: "ai", content: "The weather is nice" }],
            messages: [],
            tokens: { input: 5, output: 5, reasoning: 0 },
        });

        const testTool = tool(() => "sunny", {
            toolName: "get_weather",
            toolDescription: "Get weather",
            toolArguments: z.object({}),
        });

        const agent = new ReActAgent({
            model: mockModel as any,
            systemPrompt: "You are a test agent",
            messages: [{ type: "user", content: "How is the weather?" }],
            tools: [testTool],
            telemetry: { send: vi.fn() } as any,
            withConclusion: false // Simplify for test
        });

        await agent.invoke();

        // Check if tool usage was recorded in span events
        expect(mockSpan.addEvent).toHaveBeenCalledWith(
            "agent.tool_usage",
            expect.objectContaining({
                tool: "get_weather",
                status: "success",
            })
        );
        
        expect(mockSpan.addEvent).toHaveBeenCalledWith(
            "log",
            expect.objectContaining({
                event: "tool_call_registered",
                toolName: "get_weather",
            })
        );
    });

    it("should track TTFT on first token event", async () => {
        const agent = new ReActAgent({
            model: mockModel as any,
            systemPrompt: "You are a test agent",
            messages: [{ type: "user", content: "Hi" }],
            tools: [],
            telemetry: { send: vi.fn() } as any,
        });

        // Initialize time tracker (usually done in invoke/runGraph)
        (agent as any).TelemetryTracker.registerTimeTracker();

        // Protected method emitEvent usage via casting or public trigger
        // In the actual code, emitEvent("reasoning", ...) triggers registerTTFT
        (agent as any).emitEvent("reasoning", "Thinking...");

        expect(mockSpan.setAttribute).toHaveBeenCalledWith(
            expect.stringContaining("ttft"),
            expect.any(Number)
        );
    });
});

