import { trace, metrics, type Tracer, type Meter, SpanStatusCode, Span } from "@opentelemetry/api";
import { LLMAnswer, LLMConfig } from "../models/mutual";
import { ReActAgentConfig } from "../agent";

export const tracer: Tracer = trace.getTracer("raven-adk");
export const meter: Meter = metrics.getMeter("raven-adk");


export class TelemetryRecordSizeLimit {
    private static instance: TelemetryRecordSizeLimit;
    private limit: number | undefined;

    /**
     * @param limitKb - specify the undefined to make it unlimited or kb to make the record size limited
    */
    private constructor(limitKb?: number | undefined) {
        this.limit = limitKb;
    }

    public static getInstance() {
        if (!TelemetryRecordSizeLimit.instance) {
            TelemetryRecordSizeLimit.instance = new TelemetryRecordSizeLimit(undefined);
        }
        return TelemetryRecordSizeLimit.instance;
    }

    /** Set the limit in KB. Set to undefined for no limit. */
    public setLimit(kb?: number) {
        this.limit = kb;
    }

    /** Returns current limit in characters (approx 1 character = 1 byte for ASCII) */
    public getLimit(): number | undefined {
        return this.limit ? this.limit * 1024 : undefined;
    }

    /** 
     * Truncates content based on current limit 
     * @returns Object with truncated content and boolean flag
     */
    public truncate(content: string): { value: string, isTruncated: boolean } {
        const limit = this.getLimit();
        if (limit && content.length > limit) {
            return {
                value: content.substring(0, limit),
                isTruncated: true
            };
        }
        return { value: content, isTruncated: false };
    }
}

export const telemetryRecordSizeLimit = TelemetryRecordSizeLimit.getInstance();

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

/**
 * Records tge event with data
 * @param event is the name of custom event
 * @param data is the object with data
 */
export function recordEventWithData(event: string, data: any) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
        activeSpan.addEvent(event, data);
    }
}

export enum RecordTrackerType {
    LLM,
    Embedding,
    Agent
}

/**
 * Use to track the llm progress
 */
export class RecordTracker<Config extends LLMConfig | ReActAgentConfig<any, any, any>> {
    private config: Config;
    private TimestampOfUsage: number | undefined = undefined;
    private trackerType: RecordTrackerType;
    private provider: string;

    constructor(config: Config, trackerType: RecordTrackerType, provider: string) {
        this.config = config;
        this.trackerType = trackerType;
        this.provider = provider;
    }

    private getPrefix() {
        switch(this.trackerType) {
            case RecordTrackerType.Agent:
                return "agent";
            case RecordTrackerType.LLM:
                return "llm";
            case RecordTrackerType.Embedding:
                return "embedding";
        }
    }
    
    registerConfig() {
        const activeSpan = trace.getActiveSpan();
        
        // Use a safe stringification to avoid circular reference errors and large object issues
        const safeJsonStringify = (obj: any) => {
            const cache = new Set();
            return JSON.stringify(obj, (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (cache.has(value)) return '[Circular]';
                    cache.add(value);
                }
                // Skip large objects or complex classes if needed
                if (key === 'model' || key === 'client' || key === 'memory') return `[${value?.constructor?.name ?? 'Object'}]`;
                return value;
            }, 4);
        };

        const configStr = safeJsonStringify(this.config);
        const { value, isTruncated } = telemetryRecordSizeLimit.truncate(configStr);
        
        if (isTruncated) {
            activeSpan?.addEvent(`${this.getPrefix()}.config_event`, {
                config: value,
                is_truncated: true
            });
        } else {
            activeSpan?.setAttribute(`${this.getPrefix()}.config`, value);
        }
        
        return this;
    }

    registerTimeTracker(timezoneAttr?: string) {
        this.TimestampOfUsage = Date.now();
        
        const activeSpan = trace.getActiveSpan();

        // Setup time start
        activeSpan?.setAttribute(`${this.getPrefix()}.timestamp_start`, this.TimestampOfUsage);

        // Setup timezone
        const timezone = timezoneAttr ? timezoneAttr : Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (timezone) {
            activeSpan?.setAttribute(`${this.getPrefix()}.timezone`, timezone);
        }

        //
        return this;
    }

    registerTTFT() {
        if (this.TimestampOfUsage === undefined) {
            console.warn("Cannot register TTFT because time tracker wasn't initialized");
            return this;
        }

        const ttft = Date.now() - this.TimestampOfUsage;
        const activeSpan = trace.getActiveSpan();

        activeSpan?.setAttribute(`${this.getPrefix()}.ttft`, ttft);

        return this;
    }

    finishTimeTracker() {
        if (this.TimestampOfUsage === undefined) {
            console.warn("Cannot finish timetracker because it wasn't initialized");
            return this;
        }
        
        const activeSpan = trace.getActiveSpan();

        // Register end
        const timeEnd = Date.now();
        activeSpan?.setAttribute(`${this.getPrefix()}.timestamp_end`, timeEnd);

        // Reset
        this.TimestampOfUsage = undefined;

        //
        return this;
    }
    
    /** Setup user attribute as query */
    setUserQueryActiveSpanAttribute() {
        const activeSpan = trace.getActiveSpan();
        const queryStr = JSON.stringify(this.config.messages ?? [], null, 4);
        const { value, isTruncated } = telemetryRecordSizeLimit.truncate(queryStr);

        if (isTruncated) {
            activeSpan?.addEvent(`${this.getPrefix()}.query_event`, {
                query: value,
                is_truncated: true
            });
        } else {
            activeSpan?.setAttribute(`${this.getPrefix()}.task_query`, value);
        }
        
        return this;
    }
    
    setAnswerActiveSpanAttribute(answer: LLMAnswer) {
        const activeSpan = trace.getActiveSpan();
        const answerStr = JSON.stringify(answer, null, 4);
        const { value, isTruncated } = telemetryRecordSizeLimit.truncate(answerStr);

        if (isTruncated) {
            activeSpan?.addEvent(`${this.getPrefix()}.answer_event`, {
                answer: value,
                is_truncated: true
            });
        } else {
            activeSpan?.setAttribute(`${this.getPrefix()}.answer`, value);
        }
        
        return this;
    }

    setEmbeddingAnswer(embedding: any) {
        if (this.trackerType !== RecordTrackerType.Embedding) {
            console.warn("Cannot use embedding registering for different tracking initialized than `embedding`")
            return this;
        }
        
        const activeSpan = trace.getActiveSpan();
        activeSpan?.setAttribute(`${this.getPrefix()}.embedding`, JSON.stringify(embedding, null, 4));
        return this;
    }

    setUsage(usageObject: LLMAnswer["tokens"]) {
        const activeSpan = trace.getActiveSpan();
        activeSpan?.setAttribute(`${this.getPrefix()}.usage`, JSON.stringify(usageObject, null, 4));
        
        recordTokenUsage(
            this.provider,
            typeof this.config.model === "string" ? this.config.model : this.config.model.config.model,
            usageObject
        );

        return this;
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
    fn: (span: Span) => Promise<T>
): Promise<T> {
    const limitedAttributes: Record<string, any> = {};
    for (const [key, val] of Object.entries(attributes)) {
        if (typeof val === 'string') {
            limitedAttributes[key] = telemetryRecordSizeLimit.truncate(val).value;
        } else {
            limitedAttributes[key] = val;
        }
    }

    return tracer.startActiveSpan(name, { attributes: limitedAttributes }, async (span) => {
        try {
            const result = await fn(span);
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
}
