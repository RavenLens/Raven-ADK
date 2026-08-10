# Text-to-text Models

Text-to-text (TTT) models generate and transform text. RavenADK provides a common interface for
OpenAI, Google Gemini, Anthropic Claude, RunPod, and OpenAI-compatible endpoints.

## Public contract

```typescript
import { Anthropic, Google, OpenAI, RunPod } from "@ravenlens/raven-adk/models";
import type { Mutual } from "@ravenlens/raven-adk/models";
```

All text-to-text providers implement `Mutual.StandardLLMShema`. A model can invoke a conversation,
request structured output, compact context when supported, and expose provider-specific events.

## Providers

### OpenAI

The OpenAI provider supports the Responses API and falls back to compatible chat or completion APIs
when configured for a compatible endpoint.

```typescript
const model = new OpenAI({
    model: "gpt-6-pro",
    apiKey: process.env.OPENAI_API_KEY,
    messages: [
        { type: "user", content: "Hello!" }
    ]
});

const result = await model.invoke();
console.log(result.answer[0].content);
```

Advanced OpenAI options include:

- `reasoningEffort`: `"low"`, `"medium"`, or `"high"` for supported reasoning models.
- `useCompletionsApi`: force the legacy completions API for compatible base models.
- `compaction`: configure server-side Responses API compaction where supported.

OpenAI-compatible services can use the same class with a custom `baseURL` and API key.

### Google Gemini

```typescript
const model = new Google({
    model: "gemini-3.5-flash-preview",
    apiKey: process.env.GEMINI_API_KEY,
    messages: [
        { type: "user", content: "What's the weather like?" }
    ]
});

const result = await model.invoke();
console.log(result.answer[0].content);
```

Google configuration can include generation settings such as temperature, top-p, top-k,
`maxOutputTokens`, and Vertex AI project settings when supported by the adapter.

### Anthropic Claude

```typescript
const model = new Anthropic({
    model: "claude-4-8-sonnet-latest",
    apiKey: process.env.ANTHROPIC_API_KEY,
    messages: [
        { type: "user", content: "Write a short story." }
    ]
});

const result = await model.invoke();
console.log(result.answer[0].content);
```

Anthropic reasoning can be configured with the provider's thinking settings. Keep the budget
appropriate for the selected model and request.

### RunPod

RunPod can be used through its native Serverless vLLM endpoint or through an OpenAI-compatible
endpoint.

Native RunPod configuration:

```typescript
const model = new RunPod({
    model: "mistralai/Mistral-7B-Instruct-v0.2",
    apiKey: process.env.RUNPOD_API_KEY,
    endpointId: "your-endpoint-id"
});

const result = await model.invoke();
```

For an OpenAI-compatible endpoint:

```typescript
const model = new OpenAI({
    model: "cyfragovpl/pllum-12b-base-2512",
    apiKey: process.env.RUNPOD_API_KEY,
    baseURL: `https://api.runpod.ai/v2/${endpointId}/openai/v1`,
    useCompletionsApi: true
});

const result = await model.invoke();
```

## Reasoning

RavenADK exposes a provider-neutral reasoning configuration for supported models:

```typescript
const result = await model.invoke({
    reasoning: {
        budgetTokens: 16000,
        effort: "high"
    }
});
```

`budgetTokens` is used by providers that expose a reasoning budget, while `effort` maps to
providers that expose reasoning effort levels. The selected provider decides which values are
meaningful.

Providers that expose model events can report reasoning separately from the final answer:

```typescript
model.onEvent("reasoning", (thought) => {
    console.log("Model is thinking:", thought);
});
```

## Structured output

Use `invokeStructuredOutput` to validate a response against a Zod schema. RavenADK can retry a
request when the model returns data that does not match the requested structure.

```typescript
import { z } from "zod";

const schema = z.object({
    summary: z.string(),
    sentiment: z.enum(["positive", "negative", "neutral"])
});

const result = await model.invokeStructuredOutput(schema);
const data = result.answer[0].structuredOutput;
```

## Streaming

Providers that support streaming can return incremental events when invoked with `stream: true`:

```typescript
const stream = await model.invoke({ stream: true });

for await (const chunk of stream) {
    if (chunk.type === "response.output_text.delta") {
        process.stdout.write(chunk.delta);
    }
}
```

The event names and payloads are provider-specific where the underlying SDK does not expose a
common event shape.

## RAG

Combine text-to-text models with embeddings and retrieval for grounded responses. See
[Resource Augmented Generation](../augmented%20generation/RAG.md) for the retrieval workflow and
[Embedding models](embeddings.md) for vector model guidance.

## Custom text-to-text models

A custom adapter preserves the shared method names and return types:

```typescript
import { Mutual } from "@ravenlens/raven-adk/models";

const customTTT: Mutual.StandardLLMShema = {
    typeAPI: "model",
    apiName: { custom: "My text model" },
    config: { model: "my-chat-model" },
    invoke: async () => ({
        messages: [],
        answer: [],
        tokens: { input: 0, output: 0, reasoning: 0 }
    }),
    invokeStructuredOutput: async () => ({
        messages: [],
        answer: [],
        tokens: { input: 0, output: 0, reasoning: 0 }
    })
};
```

Provider-specific configuration belongs in the adapter while workflows depend on the shared
`StandardLLMShema` contract.
