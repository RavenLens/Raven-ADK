import { trace, metrics, type Tracer, type Meter, SpanStatusCode } from "@opentelemetry/api";

export const tracer: Tracer = trace.getTracer("raven-adk");
export const meter: Meter = metrics.getMeter("raven-adk");

/**
 * Recording a log event on the active trace span if available.
 * In professional OTel, this is handled via Span Events.
 */
export function recordLog(data: any) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
        activeSpan.addEvent("log", data);
    }
}

// Metrics for token usage
export const tokenCounter = meter.createCounter("raven_adk.tokens_usage", {
    description: "Tracks total token usage across model calls",
});


export const agentRunCounter = meter.createCounter("raven_adk.agent_runs", {
    description: "Total number of ReAct Agent executions",
});

/**
 * Helper to wrap any StandardLLMShema provider with telemetry 
 * to allow community providers to be automatically monitored.
 */
export async function withTelemetry<T>(
    name: string, 
    attributes: Record<string, any>, 
    fn: () => Promise<T>
): Promise<T> {
    return tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
            const result = await fn();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error: any) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            throw error;
        } finally {
            span.end();
        }
    });
}

/**
 * Unified helper to record token usage and LLM call metadata.
 */
export function recordTokenUsage(
    provider: string,
    model: string,
    tokens: { input: number; output: number; reasoning?: number }
) {
    tokenCounter.add(tokens.input, { provider, model, type: "input" });
    tokenCounter.add(tokens.output, { provider, model, type: "output" });
    
    if (tokens.reasoning && tokens.reasoning > 0) {
        tokenCounter.add(tokens.reasoning, { provider, model, type: "reasoning" });
    }

    recordLog({
        event: "llm_call",
        provider,
        model,
        tokens
    });
}
