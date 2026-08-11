# Models
RavenADK provides support for several model providers, allowing you to easily switch between them using a standard interface.

## Model groups

Models are organized into four independent groups:

* **ttt**: text-to-text models such as OpenAI, Google, Anthropic, and RunPod.
* **stt**: speech-to-text models from OpenAI, Google, Cartesia, and ElevenLabs.
* **tts**: text-to-speech models from OpenAI, Google, Cartesia, and ElevenLabs.
* **embeddings**: vector embedding models from OpenAI, Google, and VoyageAI.

The dedicated speech groups expose the same small contract for every provider:

```typescript
import type { SpeechToTextModel, TextToSpeechModel } from "@ravenlens/raven-adk/models";

async function transcribe(model: SpeechToTextModel, file: File) {
    return model.transcribe(file);
}

async function speak(model: TextToSpeechModel, text: string) {
    return model.synthesize(text); // Buffer containing the provider audio format
}
```

Provider classes are also grouped under `Providers`, so related models can be discovered together:

```typescript
import { Providers } from "@ravenlens/raven-adk/models";

const openAITranscriber = new Providers.OpenAI.speechToText({
    model: "gpt-4o-transcribe",
    apiKey: process.env.OPENAI_API_KEY
});
```

Dedicated imports are available from `@ravenlens/raven-adk/models/speech-to-text`,
`@ravenlens/raven-adk/models/text-to-speech`, `@ravenlens/raven-adk/models/text-to-text`,
and `@ravenlens/raven-adk/models/embeddings`.

### Custom models

Implement the schema for the group your provider belongs to. A custom adapter should preserve the
group method names and return types; provider-specific options can be added through the options index signature.

```typescript
import type { SpeechToTextModel, TextToSpeechModel } from "@ravenlens/raven-adk/models";

const customSTT: SpeechToTextModel = {
    typeAPI: "model",
    apiName: { custom: "My STT" },
    config: { model: "my-transcriber", apiKey: process.env.MY_API_KEY },
    transcribe: async (file, options) => "transcription",
    stt: async (file, options) => "transcription"
};

const customTTS: TextToSpeechModel = {
    typeAPI: "model",
    apiName: { custom: "My TTS" },
    config: { model: "my-voice", apiKey: process.env.MY_API_KEY },
    synthesize: async (text, options) => Buffer.from([]),
    tts: async (text, options) => Buffer.from([])
};
```

The other groups use their own schemas rather than the speech contracts:

```typescript
import { Mutual } from "@ravenlens/raven-adk/models";

const customTTT: Mutual.StandardLLMShema = {
    typeAPI: "model",
    apiName: { custom: "My text model" },
    config: { model: "my-chat-model" },
    invoke: async (options) => ({ messages: [], answer: [], tokens: { input: 0, output: 0, reasoning: 0 } }),
    invokeStructuredOutput: async (schema, maxRecallTries, options) => ({ messages: [], answer: [], tokens: { input: 0, output: 0, reasoning: 0 } })
};

const customEmbedding: Mutual.EmbeddingModel = {
    typeAPI: "model",
    apiName: { custom: "My embeddings" },
    config: { model: "my-embedding-model" },
    embed: async (text) => Array.isArray(text) ? text.map(() => []) : [[]]
};
```

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

## Thoughts (Reasoning)
RavenADK provides a unified interface for models that support explicit reasoning (thoughts). This allows you to capture the model's "chain of thought" separately from its final answer.

### Unified Configuration
You can configure reasoning effort or token budgets across different providers using the `reasoning` configuration in `invoke` or `invokeStream`.

```typescript
const result = await model.invoke({
    reasoning: {
        budgetTokens: 16000, // For Anthropic (thinking) & Google (thinkingConfig)
        effort: "high"       // For OpenAI (o1, o3-mini)
    }
});
```

### Capturing Thoughts
Reasoning content is extracted into a special `reasoning` event and stored as `thinking` messages in the conversation history.

```typescript
model.onEvent("reasoning", (thought) => {
    console.log("Model is thinking:", thought);
});
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

## RAG
Combine your models with RAG for better outcomes check more at [RAG Documentation](./augmented%20generation/RAG.md)


## Embedding models
RavenADK supports these embedding model families:

> Always use the same embedding model as you've used to compose the RAG database in order to always get the similar documents.

1. OpenAI - models used by openai. Use by import `OpenAIEmbedding` class
2. VoyageAI - models used by anthropic. Use by import `VoyageEmbedding` class
3. Google Gemini - Google models used by Gemini. Use by import `GoogleEmbeddingConfig` class

> Check how to use RAG with your models at [RAG Documentation](./augmented%20generation/RAG.md)
