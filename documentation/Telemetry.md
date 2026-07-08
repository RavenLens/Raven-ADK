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

You can record custom events during agent execution that will appear directly in your trace timeline.

```typescript
import { recordLog } from "@ravenlens/raven-adk/telemetry";

// inside a tool or custom skill
recordLog({
    event: "custom_observation",
    data: "Found an interesting pattern in the data"
});
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
