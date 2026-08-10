# Text-to-speech Models

Text-to-speech (TTS) models convert text into audio. RavenADK uses the same small interface for
hosted providers and custom adapters so workflows can replace the voice provider without changing
their model orchestration.

## Public contract

```typescript
import type {
    TextToSpeechCapabilities,
    TextToSpeechModel,
    TextToSpeechOptions
} from "@ravenlens/raven-adk/models/text-to-speech";
import {
    CartesiaTTS,
    ElevenLabsTTS,
    GoogleTTS,
    OpenAITTS
} from "@ravenlens/raven-adk/models/text-to-speech";
```

Every TTS model exposes `synthesize` and the compatibility alias `tts`. Both return a `Buffer`
containing audio in the provider's selected format.

```typescript
async function speak(model: TextToSpeechModel, text: string) {
    return model.synthesize(text);
}
```

The shared configuration supports a model ID, API key, custom base URL, voice, and output format.
Provider-specific values can be added through the options index signature.

## Providers

### OpenAI

```typescript
const model = new OpenAITTS({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    apiKey: process.env.OPENAI_API_KEY,
    outputFormat: "mp3"
});

const audio = await model.synthesize("Welcome to RavenADK.", {
    speed: 1
});
```

### Google Gemini

```typescript
const model = new GoogleTTS({
    model: "gemini-2.5-flash-preview-tts",
    voice: "Kore",
    apiKey: process.env.GEMINI_API_KEY
});

const audio = await model.synthesize("Welcome to RavenADK.");
```

### Cartesia

```typescript
const model = new CartesiaTTS({
    model: "sonic-english",
    voice: "cartesia-voice-id",
    apiKey: process.env.CARTESIA_API_KEY
});

const audio = await model.synthesize("Welcome to RavenADK.");
```

### ElevenLabs

```typescript
const model = new ElevenLabsTTS({
    model: "eleven_multilingual_v2",
    voice: "elevenlabs-voice-id",
    apiKey: process.env.ELEVENLABS_API_KEY
});

const audio = await model.synthesize("Welcome to RavenADK.");
```

The provider's model and voice identifiers must be verified against the selected provider account.
The adapter returns the provider audio bytes; it does not normalize every provider into one audio
codec.

## Capabilities and workflow metadata

TTS capabilities are optional. An omitted declaration means the workflow cannot assume support.

```typescript
const speechCapabilities: TextToSpeechCapabilities = {
    voiceCloning: {
        supported: true,
        sampleRequired: true,
        consentRequired: true
    },
    alignment: {
        wordTimestamps: true,
        phonemeTimestamps: false,
        visemeTimestamps: false
    },
    streaming: true
};
```

Use voice cloning only when the selected model advertises it and the required consent has been
obtained. Alignment metadata is useful for audio-driven video and lip-sync refinement:

```typescript
const options: TextToSpeechOptions = {
    voice: "speaker-voice",
    outputFormat: "wav",
    voiceClone: {
        sample: voiceSample,
        mimeType: "audio/wav",
        consent: { granted: true, subjectId: "speaker-1" }
    }
};

const audio = await model.synthesize(dialogue, options);
```

The current common method returns audio bytes. A provider may advertise streaming or alignment
capabilities for an orchestration layer, but an adapter must expose a concrete implementation before
a workflow relies on those capabilities.

## Cancelling synthesis

TTS options use `signal?: AbortSignal`:

```typescript
const controller = new AbortController();
const pendingAudio = model.synthesize(text, {
    signal: controller.signal
});

controller.abort();
await pendingAudio;
```

An adapter should forward the signal to its HTTP client or SDK. Cancellation support can differ
between provider SDKs, so a workflow should verify the selected adapter before promising cancellation.

## Custom TTS models

```typescript
import type { TextToSpeechModel } from "@ravenlens/raven-adk/models/text-to-speech";

const customTTS: TextToSpeechModel = {
    typeAPI: "model",
    apiName: { custom: "My TTS" },
    config: {
        model: "my-voice",
        apiKey: process.env.MY_API_KEY
    },
    synthesize: async (text, options) => Buffer.from([]),
    tts: async (text, options) => Buffer.from([])
};
```

For a podcast or video workflow, TTS is the authoritative source of the audio timeline. Pass the
resulting audio and any alignment metadata to the selected video model or lip-sync refiner. See
[Video models](video.md) for the complete pipeline guidance.
