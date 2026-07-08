# Telemetry & Observability

RavenADK provides native **OpenTelemetry (OTel)** support, establishing it as the project's observability standard. This allows you to monitor agent performance, track token usage in real-time, and debug complex reasoning paths using industry-standard tools like Jaeger, Honeycomb, or Prometheus.

## Why OpenTelemetry?
- **Universal Standard**: Compatible with almost all modern monitoring platforms.
- **Deep Insights**: Track everything from high-level token costs to low-level internal reasoning recalls.
- **Zero Overhead**: Uses non-blocking batch processing for minimum impact on agent performance.
- **Automatic Lifecycle**: Telemetry data is automatically flushed when the agent completes its task.

## What is recorded?
- AI Agents steps and procedures are registered for each RavenADK agentic concept like `ReAct` Agent
- Tool calls and `MCP` tool calls
- `MCP` interaction like: connections, tool downloads
- abstract connecepts interactions like: `AEval` (loops and evaluations), `MutlipleAnswers`
- and `[more]`

## Architecture

Raven ADK uses the **OTLP (OpenTelemetry Line Protocol)** over HTTP to export two types of data:
1.  **Traces**: Distributed traces representing the "flow" of an agent run, including tool calls and subagent executions.
2.  **Metrics**: Quantitative data like `tokens_usage` and `agent_runs`.

## Quick Start

To enable professional observability, use the `OpenSourceTelemetryProvider`.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { OpenSourceTelemetryProvider } from "@ravenlens/raven-adk/telemetry/providers";
import { OpenAIModel } from "@ravenlens/raven-adk/models";

// 1. Initialize the OTel Provider
const telemetry = new OpenSourceTelemetryProvider({
    url: "http://localhost:4318", // Your OTel Collector / Jaeger endpoint
    serviceName: "raven-research-agent",
    headers: {
        "x-api-key": "optional-security-header"
    }
});

// 2. Attach to Agent
const agent = new ReActAgent({
    model: new OpenAIModel({ model: "gpt-4o" }),
    telemetry: telemetry,
    messages: [{ type: "user", content: "Analyze these logs..." }]
});

// 3. Run Agent
// All traces and metrics are automatically sent to your collector!
await agent.invoke();
```

## Tracked Metrics

Raven ADK automatically tracks the following:

| Metric Name | Type | Description |
| :--- | :--- | :--- |
| `raven_adk.tokens_usage` | Counter | Total tokens consumed (labels: `type: input|output|reasoning`, `model`, `provider`) |
| `raven_adk.agent_runs` | Counter | Total number of agent executions |

## Custom Logging (Span Events)

1. You can make active spans by wrapping logic with `withTelemetry` function - this creates an active span and closes it immediately after the execution of the specified logic.
```typescript
import { withTelemetry } from "@ravenlens/raven-adk/telemetry";

const result = await withTelemetry(
    "operation_name", 
    { "attribute.key": "value" }, 
    async (span) => {
        // Your logic here
        return "some result";
    }
);
```

> After execution no-matter failure or success the span is finished with `span.end()`, therefore you don't have to call it manually

- Use this to create parent and child spans for granular tracing. Nested calls to `withTelemetry` automatically become child spans of the active parent.
```typescript
await withTelemetry("parent_processor", { id: "p1" }, async (parentSpan) => {
    // Child span 1
    await withTelemetry("sub_task_alpha", { detail: "check" }, async (childSpan) => {
        // logic...
    });

    // Child span 2
    await withTelemetry("sub_task_beta", { detail: "save" }, async (childSpan) => {
        // logic...
    });
});
```

2. Events bounding to active span - You can record custom events during agent/ai-autonomous system execution that will appear directly in your trace timeline.
- `log` event - is standalone event

```typescript
import { recordLog } from "@ravenlens/raven-adk/telemetry";

// inside a tool or custom skill -> this assignes the event to `active span
recordLog({
    event: "custom_observation",
    data: "Found an interesting pattern in the data"
});
```

- `custim event` - use `recordEventWithData` to record custom event
```typescript
import { recordEventWithData } from "@ravenlens/raven-adk/telemetry";

recordEventWithData("event-name", {
    // Specify your custom field
    data1: "your data",
    /// ...more_custom_field
})
```

3. Tokens usage `recordTokenUsage`
```typescript
import { recordTokenUsage } from "@ravenlens/raven-adk/telemetry";

recordTokenUsage("openai", "gpt-4o", { input: 100, output: 50 });
```

4. High-level tracking with `RecordTracker`
The `RecordTracker` is a utility class used by RavenADK internals (in `ReActAgent`, `RLM` orchestrator, and all `Model` providers) to provide a consistent schema for complex AI operations. 

**Why use it?**
- **Standardized Schema**: It automatically prefixes attributes (e.g., `agent.*`, `llm.*`, `embedding.*`) based on the tracker type.
- **Latency Insights**: Provides built-in methods for tracking Time-To-First-Token (TTFT) and total execution duration.
- **Lifecycle Management**: Simplifies registering model configurations, user queries, and AI answers while respecting global record size limits.

**Usecase Example: Custom Model Provider**
If you are implementing a custom model or a complex autonomous loop, `RecordTracker` ensures your telemetry matches the RavenADK standard:

```typescript
import { RecordTracker, RecordTrackerType } from "@ravenlens/raven-adk/telemetry";

class MyCustomAgent {
    private tracker: RecordTracker<any>;

    constructor(config: any) {
        this.tracker = new RecordTracker(config, RecordTrackerType.Agent, "my-custom-agent");
    }

    async run() {
        return await withTelemetry("my_agent.run", {}, async (span) => {
            // 1. Register config and start timer
            this.tracker.registerConfig()
                        .registerTimeTracker();

            // ... perform AI logic ...

            // 2. Register usage and finish
            this.tracker.setUsage({ input: 100, output: 200 })
                        .finishTimeTracker();
        });
    }
}
```

## Configuring Record Size Limits

RavenADK allows you to control the size of telemetry payloads to prevent large spans from being dropped by OTel backends. By default, the limit is unset (unlimited), but you can configure a global limit in KB.

When a limit is set:
- Attributes in `withTelemetry` are truncated.
- Large JSON payloads (configs, queries, results) are automatically moved from **Attributes** to **Span Events** with truncation and an `is_truncated` flag.

Recomendations:
- Allways setup limit is in match with your provider explicit configuration e.g: 64-128kb is common for such backend OTel providers as Jaeger and Honeycomb

```typescript
import { telemetryRecordSizeLimit } from "@ravenlens/raven-adk/telemetry";

// Set a global limit of 2KB for all telemetry records
telemetryRecordSizeLimit.setLimit(2); 

// To remove the limit
telemetryRecordSizeLimit.setLimit(undefined);
```

## Recommended Backend: Jaeger

For the best experience, we recommend running a local Jaeger instance via Docker:

```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

After running your agent, visit `http://localhost:16686` to see your agent's reasoning traces and performance metrics.
