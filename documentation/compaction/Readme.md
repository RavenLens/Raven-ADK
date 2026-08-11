# Conversation Compaction

Conversation compaction keeps long-running RavenADK conversations within a model's context window. Instead of dropping old history blindly, RavenADK replaces it with either provider-owned compacted state or a structured summary that retains the information needed for the next turn.

Compaction can run in two modes:

- **Automatic compaction**: RavenADK enables the provider's server-side context management during a normal `invoke()` call. The provider decides when to compact.
- **Manual compaction**: Call `model.compact()` yourself, or let the ReAct compaction plugin call it after its token threshold is reached.

> Provider-owned compacted state is represented by a `CompactionMessage`. Do not modify opaque compaction data such as OpenAI `items` or Anthropic `encryptedContent`; pass it back through the same provider wrapper.

## Model Support

| Provider or model wrapper | Automatic compaction | Manual `.compact()` | Compaction result |
| --- | --- | --- | --- |
| `Anthropic` | Yes. Configure `compaction` to use Anthropic's `compact-2026-01-12` beta. | No. Anthropic does not expose RavenADK's `.compact()` method. | Native Anthropic `compaction` block, including opaque encrypted state. |
| `OpenAI` | Yes. Configure `compaction.compactThreshold` for the Responses API. | Yes. Uses the native `responses.compact()` endpoint. | Canonical OpenAI compacted context items, including opaque compaction items. |
| `Google` | No native provider compaction API in this wrapper. | Yes. | Structured summary created by `compactMessagesWithStructuredOutput`. |
| `RunPod` | No endpoint-independent provider compaction API. | Yes. | Structured summary created by `compactMessagesWithStructuredOutput`. |
| OpenAI-compatible legacy endpoints | No. | Yes, when using the `OpenAI` wrapper. | Structured-summary fallback when the endpoint does not expose `responses.compact()`. |
| Embedding models | No. | No. | Embeddings are stateless and have no conversation history. |
| `OpenAISTTModel` | No. | No. | Transcription requests are stateless audio-to-text operations. |

The `.compact()` method is optional in `StandardLLMShema`. Code that works with arbitrary providers should check for it before calling it.

```typescript
if (model.compact) {
    const compactedMessages = await model.compact({ messages: history });
}
```

> Some models like `Antrhopic` haven't manual compaction `.compact` method enabled

---

## Denote: 
You should now the traits of dealing with compaction

1. Each compaction case takes more time to produce the answer than going without compaction
2. Usage of compaction in each form increases costs due to shrinking the history by processing it by model [Input Tokens] -> [Model Infference] -> [Output Tokens]
    - One Exception kays in the [ReactAgent Compaction Plugin](#react-agent-compaction-plugin) that has truncation option that looses the informations but prevents additional costs

### Usefullness: 
- Use [Manual](#manual-compaction), [Automatic ](#automatic-compaction) or [ReActAgent Compaction Plugin](#react-agent-compaction-plugin) to avoid **overflowing context window errors**

---

## Automatic Compaction

Automatic compaction is configured on the provider wrapper, then occurs during a regular `invoke()` call. RavenADK preserves returned `CompactionMessage` instances so the next provider call can continue from the compacted context.

### Anthropic

Anthropic uses its server-side compaction beta. The wrapper sends `context_management` with the `compact-2026-01-12` beta header and round-trips the returned compaction block. Use an Anthropic model that supports this beta feature.

```typescript
import { Anthropic } from "@ravenlens/raven-adk/models";

const model = new Anthropic({
    model: "claude-sonnet-5",
    apiKey: process.env.ANTHROPIC_API_KEY,
    compaction: {
        triggerTokens: 100_000,
        instructions: "Preserve technical decisions, identifiers, and unfinished work.",
        pauseAfterCompaction: false
    }
});

const result = await model.invoke({
    messages: [{ type: "user", content: "Continue the long-running task." }]
});
```

`pauseAfterCompaction` is forwarded to Anthropic. When it is enabled, account for Anthropic returning after its compaction step before continuing your workflow.

### OpenAI

OpenAI's Responses API **can compact automatically** during normal responses. Set a threshold in tokens.

```typescript
import { OpenAI } from "@ravenlens/raven-adk/models";

const model = new OpenAI({
    model: "gpt-5.3-codex",
    apiKey: process.env.OPENAI_API_KEY,
    compaction: {
        compactThreshold: 200_000
    }
});

const result = await model.invoke({
    messages: [{ type: "user", content: "Continue the long-running task." }]
});
```

OpenAI may return an opaque compaction item in `result.messages`. RavenADK preserves that item and sends it back on later Responses API calls.

## Manual Compaction

Manual compaction gives the application an explicit boundary. Pass the historical messages to compact, retain any messages you need verbatim, and use the returned messages as the compacted portion of the next request.

```typescript
import { OpenAI } from "@ravenlens/raven-adk/models";

const model = new OpenAI({
    model: "gpt-5.6",
    apiKey: process.env.OPENAI_API_KEY
});

const olderHistory = [
    { type: "user" as const, content: "Plan a deployment." },
    { type: "ai" as const, content: "I will compare the deployment options." }
];

const compactedHistory = await model.compact({
    messages: olderHistory
});

const result = await model.invoke({
    messages: [
        ...compactedHistory,
        { type: "user", content: "Choose the safer option and explain why." }
    ]
});
```

For OpenAI's native Responses API, `.compact()` calls the standalone `responses.compact()` endpoint. Its output is canonical: use the returned compacted messages unchanged. For a legacy OpenAI-compatible endpoint without that API, the wrapper uses the structured-summary fallback described below.

> **Beware:** Anthropic is automatic-only. It has no public `.compact()` method; enable `AnthropicConfig.compaction` instead.

## Structured-Output Summary Compaction

`compactMessagesWithStructuredOutput` is the manual fallback used by `Google`, `RunPod`, and OpenAI-compatible _endpoints that do not implement the standalone OpenAI compaction endpoint_.

The helper:

1. Sends the selected history to the model's `invokeStructuredOutput()` implementation.
2. Requires a result matching `COMPACTION_SUMMARY_SCHEMA`: `{ summary: string }`.
3. Returns a single `{ type: "compaction", provider: "summary" }` message containing the summary.
4. Restores the model's original messages and tools after the temporary structured-output request completes.

The summary instructs the model to retain user goals, decisions, constraints, facts, tool results, unfinished work, and exact identifiers. It must not include chain-of-thought or invent missing information.

```typescript
import { Google } from "@ravenlens/raven-adk/models";

const model = new Google({
    model: "gemini-3.6-flash",
    apiKey: process.env.GEMINI_API_KEY
});

const compactedHistory = await model.compact({
    messages: [
        { type: "user", content: "Review the migration plan." },
        { type: "ai", content: "The database migration is still pending." }
    ]
});
```

## ReAct Agent Compaction Plugin

> **TL;DR:** The **ReActAgent Compaction Plugin** runs before the model call. It estimates the conversation size and either compacts older messages, truncates them, or defers to an automatic provider.

> **Provider follow-up:** An automatic provider can compact during the following `invoke()` if the messages passed to it still exceed its own provider threshold. **This threshold is independent from the plugin threshold**. 
> - *If the ReActAgent plugin is the primary compaction mechanism, configure the provider threshold higher than the expected post-plugin context, or **omit provider-side compaction only when you intentionally do not want that fallback**. Keep both thresholds when provider-side compaction is required as a safety mechanism.*


The ReAct compaction plugin runs at `before_model_call`. It is implemented in [`src/agent/plugins/compaction/compact.ts`](../../src/agent/plugins/compaction/compact.ts) and exports `generateCompactReActAgentPlugin`.

The plugin:

1. Estimates tokens in `systemPrompt`, `thinking`, `userPrompt`, `aiResponses`, `toolCalls`, `toolResponses`, and `mediaAndFiles`.
2. Removes history preceding an existing `CompactionMessage`, while preserving system messages.
3. When its configured threshold is exceeded, ***preserves*** the _**system prompt** and the **four most recent non-system messages**_.
4. Defers to providers with `compactionMode: "automatic"`; those providers compact during `invoke()` when their own threshold requires it.
5. Calls `.compact()` for providers with manual compaction support.
6. Falls back to bounded truncation only when the provider offers neither mode.

- Use `forceTruncate` when the agent must avoid provider compaction entirely. It bypasses both
`compactionMode: "automatic"` and `.compact()`, then truncates older messages directly. Set
`truncateSize` to configure the maximum number of characters retained in each truncated tool,
user, or AI field. Without `truncateSize`, the existing defaults are used: `400` characters for
tool fields and `1000` characters for user and AI fields.

```typescript
import { ReActAgent, generateCompactReActAgentPlugin } from "@ravenlens/raven-adk/agents";
import { OpenAI } from "@ravenlens/raven-adk/models";

const model = new OpenAI({
    model: "gpt-5.6",
    apiKey: process.env.OPENAI_API_KEY
});

const tokenizer = (text: string) => text.split(/\s+/).filter(Boolean).length;

const compactionPlugin = generateCompactReActAgentPlugin(
    {
        name: "gpt-5.6",
        contextWindowTokens: 128_000
    },
    tokenizer,
    80,
    (context) => {
        console.log("Context usage", context);
    },
    {
        forceTruncate: true,
        truncateSize: 500
    }
);

const agent = new ReActAgent({
    model,
    systemPrompt: "You are a precise software engineering assistant.",
    messages: [{ type: "user", content: "Start the implementation task." }],
    tools: [],
    plugins: [compactionPlugin]
});

const result = await agent.invoke();
```

The model descriptor passed to `generateCompactReActAgentPlugin` supplies the context-window size used for local threshold calculation. Keep it aligned with the provider model and leave enough context for the next response and any reasoning tokens.

### How the thresholds interact

The plugin's threshold and a model provider's threshold control different layers of the request:

```typescript
const contextWindowTokens = 128_000;
const compressOnceContextPr = 80;

// The plugin compacts before a ReActAgent model call when:
// total estimated tokens > 128_000 * (80 / 100)
const pluginThreshold = Math.floor(
    contextWindowTokens * (compressOnceContextPr / 100)
);
```

**Description:** `generateCompactReActAgentPlugin` uses the supplied `contextWindowTokens` and `compressOnceContextPercentage` **arguments** to make a local decision before the model is called. When the estimate is over that limit, it preserves system messages and the four most recent non-system messages, then calls `model.compact()` when the model exposes manual compaction. This is proactive agent-level history management: the application chooses when to create a compaction boundary and can observe the decision through `onCompressionUpdate`.

OpenAI's `compaction.compactThreshold` is different:

```typescript
const model = new OpenAI({
    model: "gpt-5.6",
    apiKey: process.env.OPENAI_API_KEY,
    compaction: {
        // Provider-side Responses API threshold, in tokens.
        compactThreshold: 200_000
    }
});
```

This value is sent to the OpenAI Responses API. OpenAI may compact during a normal `model.invoke()` request when the provider's own threshold is reached. It does not configure `compressOnceContextPercentage`, and changing the plugin threshold does not change OpenAI's Model threshold. In particular, `compactThreshold` is spelled with `Threshold`, not `Treshold`.

**Do not assume** that configuring both settings creates one shared threshold. With the current OpenAI wrapper, the model also exposes `.compact()`, so the ReAct plugin can perform explicit manual compaction when its own threshold is reached, while OpenAI provider compaction remains available during regular Responses API calls. Choose one primary owner for a given workflow unless you intentionally want both safeguards:

- Use the **ReActAgent compaction plugin** when:
    - the agent should compact before a model call,
    - when the application needs a predictable local boundary
    - or when the provider only offers manual compaction. 
    
    > This is the usual choice for Google, RunPod, and OpenAI manual compaction.
- Use **model/provider compaction** when:
    - the provider owns the compaction lifecycle and can preserve its native state. 
    
    > Anthropic's server-side compaction is automatic-only in RavenADK and should be configured on the Anthropic model rather than through `model.compact()`.
- For OpenAI, use the [ReActAgent Compaction Plugin](#react-agent-compaction-plugin) for an agent-controlled boundary, provider compaction for Responses API server-side behavior, or both only when the extra protection is intentional and the two thresholds are documented separately.

- When the plugin sees `compactionMode: "automatic"`, it leaves the history unchanged and allows the provider to handle compaction during `invoke()`. The plugin does not compact once and then ask the automatic provider to compact the same result. 
    - For a model without automatic or manual compaction support, the [ReaActAgent Compaction Plugin](#react-agent-compaction-plugin) falls back to bounded truncation of older messages.

- For a provider that supports both an agent-level/manual path and provider-side automatic compaction, such as the OpenAI Responses wrapper, the plugin can compact or truncate first, or when forced by `options.forceTruncate`. The provider may then compact that resulting history during `invoke()` if it still exceeds `compaction.compactThreshold`. 
    - This is a **legitimate two-stage safeguard**, but *it can add latency and cost*; ***use thresholds that leave enough room for the next response if you want to avoid the second pass***.

### Context Diagnostics

The optional callback receives the current token estimate before every model call.

```typescript
type Context = Record<
    "systemPrompt" | "thinking" | "userPrompt" | "aiResponses" |
    "toolCalls" | "toolResponses" | "mediaAndFiles",
    {
        tokens: number;
        percentage: number;
    }
>;
```

Use it for observability, alerts, or dashboard meters. Estimates for text are tokenizer-based; multimedia and files use size-aware estimates.

## Supporting a Custom Model

Custom conversational models can participate in ReAct compaction through the optional `StandardLLMShema` members:

- Set `compactionMode` to `"automatic"` when the provider handles compaction inside `invoke()`.
- Set `compactionMode` to `"manual"` and implement `compact()` when RavenADK or the application should choose the compaction boundary.
- Omit both when the model has no compaction support. The ReAct plugin then uses its bounded-truncation fallback.

### Manual Provider

For a provider without a native compaction API, delegate to the structured-output helper. This is the same approach used by the Google and RunPod wrappers.

```typescript
import { StructuredOutput } from "@ravenlens/raven-adk/models";

class CustomModel {
    compactionMode: "manual" = "manual";

    async compact(options?: CompactOptions): Promise<MessagesVariations[]> {
        return StructuredOutput.compactMessagesWithStructuredOutput({
            messages: options?.messages ?? this.config.messages ?? [],
            abort: options?.abort,
            invokeStructuredOutput: (schema, maxRecallTries, invokeOptions) => {
                return this.invokeStructuredOutput(schema, maxRecallTries, invokeOptions);
            }
        });
    }
}
```

The containing class must still implement the rest of `StandardLLMShema`, including `invoke()` and `invokeStructuredOutput()`.

### Automatic Provider

For a provider that compacts on its own, configure its request in `invoke()` and return the provider's resulting compacted state in `LLMAnswer.messages`. Set `compactionMode` only while automatic compaction is enabled so the ReAct plugin does not also compact the same history.

```typescript
class CustomAutomaticModel {
    get compactionMode(): "automatic" | undefined {
        return this.config.compaction ? "automatic" : undefined;
    }

    async invoke(options?: InvokeOptions): Promise<LLMAnswer> {
        // Send this.config.compaction in the provider request.
        // Convert its compacted result into a CompactionMessage and append it
        // to LLMAnswer.messages so later requests can continue correctly.
        return this.invokeProvider(options);
    }
}
```

If the provider returns opaque state, preserve it exactly and ensure that the same wrapper translates it back into the provider's request format on subsequent calls.
