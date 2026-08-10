# Speech-to-text Models

Speech-to-text (STT) models transcribe audio into text. RavenADK provides one interface for hosted
providers and custom adapters.

## Public contract

```typescript
import type {
    SpeechToTextModel,
    SpeechToTextOptions
} from "@ravenlens/raven-adk/models/speech-to-text";
import {
    CartesiaSTT,
    ElevenLabsSTT,
    GoogleSTT,
    OpenAISTT
} from "@ravenlens/raven-adk/models/speech-to-text";
```

Every STT model exposes `transcribe` and the compatibility alias `stt`. The input can be a
`Blob`, `File`, or Node.js `Buffer`; the result is the recognized text.

```typescript
async function transcribe(model: SpeechToTextModel, file: File) {
    return model.transcribe(file);
}
```

The shared configuration supports a model ID, API key, custom base URL, and default language.
Provider-specific options can be added through the options index signature.

## Providers

### OpenAI

```typescript
const model = new OpenAISTT({
    model: "gpt-4o-transcribe",
    apiKey: process.env.OPENAI_API_KEY
});

const text = await model.transcribe(audioFile, {
    filename: "recording.wav",
    mimeType: "audio/wav",
    language: "en"
});
```

### Google Gemini

```typescript
const model = new GoogleSTT({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY
});

const text = await model.transcribe(audioFile, {
    language: "en",
    prompt: "This is a technical discussion about software agents."
});
```

### Cartesia

```typescript
const model = new CartesiaSTT({
    model: "ink-whisper",
    apiKey: process.env.CARTESIA_API_KEY
});

const text = await model.transcribe(audioFile, {
    mimeType: "audio/wav"
});
```

### ElevenLabs

```typescript
const model = new ElevenLabsSTT({
    model: "scribe_v1",
    apiKey: process.env.ELEVENLABS_API_KEY
});

const text = await model.transcribe(audioFile, {
    language: "en"
});
```

The provider's model IDs, accepted formats, and language support must be verified against the
selected provider account. STT is a transcription contract; timestamp, phoneme, and viseme output
are provider-specific unless they are added to a future shared result contract.

## Cancelling transcription

STT options use `signal?: AbortSignal`:

```typescript
const controller = new AbortController();
const pendingText = model.transcribe(audioFile, {
    signal: controller.signal
});

controller.abort();
await pendingText;
```

An adapter should forward the signal to its HTTP client or SDK. Cancellation support can differ
between provider SDKs, so verify it before relying on cancellation in an interactive workflow.

## Custom STT models

```typescript
import type { SpeechToTextModel } from "@ravenlens/raven-adk/models/speech-to-text";

const customSTT: SpeechToTextModel = {
    typeAPI: "model",
    apiName: { custom: "My STT" },
    config: {
        model: "my-transcriber",
        apiKey: process.env.MY_API_KEY
    },
    transcribe: async (file, options) => "transcription",
    stt: async (file, options) => "transcription"
};
```

Use STT to turn realtime or uploaded audio into prompts, transcripts, or dialogue input. For
speech synthesis and authoritative audio generation, use [Text-to-speech models](text-to-speech.md).
