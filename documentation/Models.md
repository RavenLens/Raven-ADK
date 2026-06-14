# Models
RavenADK provides support for several model providers, allowing you to easily switch between them using a standard interface.

## Supported Providers

* [OpenAI](#openai)
* [Google (Gemini)](#google-gemini)
* [Anthropic (Claude)](#anthropic-claude)
* [RunPod](#runpod)

---

## OpenAI
The OpenAI provider supports the latest OpenAI features including the Responses API, and automatically falls back to Chat Completions for compatible providers.

```typescript
import { OpenAI } from "@ravenlens/raven-adk/models";

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

### Advanced OpenAI Options
* `reasoningEffort`: Set to `"low"`, `"medium"`, or `"high"` for reasoning models (o1, o3).
* `useCompletionsApi`: Force the use of the legacy Completions API (useful for base models).

---

## Google Gemini
Support for Google's Gemini models via the Generative AI SDK.

```typescript
import { Google } from "@ravenlens/raven-adk/models";

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

---

## Anthropic Claude
Support for Anthropic's Claude models.

```typescript
import { Anthropic } from "@ravenlens/raven-adk/models";

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

### Advanced Anthropic Options
* `thinking`: Configure extended thinking (reasoning) for models that support it (e.g., Claude 4.8 Sonnet).

```typescript
const model = new Anthropic({
    model: "claude-4.8-sonnet-latest",
    apiKey: process.env.ANTHROPIC_API_KEY,
    thinking: {
        type: "enabled",
        budget_tokens: 1024
    }
});
```

---

## RunPod
RunPod can be used in two ways: via the native RunPod SDK or via the OpenAI-compatible API.

### 1. Native RunPod SDK
Use this for RunPod Serverless vLLM endpoints.

```typescript
import { RunPod } from "@ravenlens/raven-adk/models";

const model = new RunPod({
    model: "mistralai/Mistral-7B-Instruct-v0.2",
    apiKey: process.env.RUNPOD_API_KEY,
    endpointId: "your-endpoint-id"
});

const result = await model.invoke();
```

### 2. OpenAI-Compatible API (Recommended)
You can use the `OpenAI` class to connect to RunPod's OpenAI-compatible endpoints. This is often more reliable for base models.

```typescript
import { OpenAI } from "@ravenlens/raven-adk/models";

const model = new OpenAI({
    model: "cyfragovpl/pllum-12b-base-2512",
    apiKey: process.env.RUNPOD_API_KEY,
    baseURL: `https://api.runpod.ai/v2/${endpointId}/openai/v1`,
    // Optional: Raven ADK automatically detects "-base" models 
    // and uses the correct API.
    useCompletionsApi: true 
});

const result = await model.invoke();
```

---

## Standard Features
All model providers in RavenADK implement the `StandardLLMShema` interface, ensuring consistent behavior across different APIs.

> You can take favout of schema and use it to extend the current provider or add the custom models provider

### Structured Output
You can force a model to return data matching a specific Zod schema. RavenADK handles the retry logic if the model fails to produce valid JSON.

```typescript
import { z } from "zod";

const schema = z.object({
    summary: z.string(),
    sentiment: z.enum(["positive", "negative", "neutral"])
});

const result = await model.invokeStructuredOutput(schema);
const data = result.answer[0].structuredOutput; // Type-safe data
```

### Streaming
Most providers support streaming. When `stream: true` is passed, `invoke` returns an `AsyncIterable`.

```typescript
const stream = await model.invoke({ stream: true });

for await (const chunk of stream) {
    // Process provider-specific events
    if (chunk.type === "response.output_text.delta") {
        process.stdout.write(chunk.delta);
    }
}
```
