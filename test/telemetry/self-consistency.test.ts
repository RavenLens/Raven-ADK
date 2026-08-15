import { beforeEach, describe, expect, it, vi } from "vitest";

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
            startActiveSpan: vi.fn((name, optionsOrCallback, callback) => {
                const activeCallback = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
                return activeCallback(span);
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

import { MultipleAnswers, SelfConsistency } from "../../src/agent";

const messages = [{ type: "user", content: "Choose a support queue." }] as const;

describe("SelfConsistency telemetry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("records the consensus lifecycle in a decision span", async () => {
        const candidates = new MultipleAnswers([
            async () => ({ answer: "Billing" }),
            async () => ({ answer: " billing " }),
            async () => ({ answer: "Technical" }),
        ]);
        const consistency = new SelfConsistency<string, { answer: string }>({
            candidates,
            extract: result => result.answer,
        });

        const result = await consistency.invoke({ messages: [...messages] });

        expect(result.status).toBe("accepted");
        expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
            "self_consistency.invoke",
            {
                attributes: {
                    "self_consistency.candidate_count": 3,
                    "self_consistency.min_agreement": 2 / 3,
                    "self_consistency.min_candidates": 2,
                },
            },
            expect.any(Function)
        );
        expect(mockSpan.addEvent).toHaveBeenCalledWith(
            "self_consistency.candidate",
            expect.objectContaining({ weight: 1 })
        );
        expect(mockSpan.addEvent).toHaveBeenCalledWith(
            "self_consistency.decision",
            {
                status: "accepted",
                agreement: 2 / 3,
                valid_candidates: 3,
                invalid_candidates: 0,
                cluster_count: 2,
            }
        );
        expect(mockSpan.setAttribute).toHaveBeenCalledWith("self_consistency.status", "accepted");
        expect(mockSpan.setAttribute).toHaveBeenCalledWith("self_consistency.agreement", 2 / 3);
        expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
});
