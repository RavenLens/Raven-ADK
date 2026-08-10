# Video Models

Video models generate ordinary video or synchronized avatar video. They declare their pipeline
and synchronization capabilities before a workflow uses them.

`"native"` is required for a synchronization feature requested as `"required"`; `"best-effort"`
does not satisfy that requirement. A normal text-to-video model should advertise synchronization as
`"unsupported"` and will be rejected for an avatar or podcast request that requires sync.

The contracts describe observable provider behavior, not the provider's internal neural network.
An all-in-one audio-driven model should advertise audio input and native synchronization. A
cascaded model should expose its general video generator as a provider or two-stage model and its
dedicated lip-sync stage as a `VideoLipSyncModel`.

The top-level models entry point exposes video contracts directly and through the `Video` namespace.
The dedicated `@ravenlens/raven-adk/models/video` subpath remains available when an application only
needs video functionality.

```typescript
import { Video } from "@ravenlens/raven-adk/models";
import type {
    LipSyncRefinementRequest,
    OneStagePipeline,
    ProviderVideoGenerationRequest,
    TwoStagePipeline,
    VideoGenerationOptions,
    VideoLipSyncModel,
    VideoModel,
    VideoModelCapabilities
} from "@ravenlens/raven-adk/models";
import type { SpeechAlignment } from "@ravenlens/raven-adk/models/video/schemas/audio.schema";
import {
    createLatentSyncModel,
    createMuseTalkModel,
    createTwoStageVideoModel,
    createVismeOneStageModel
} from "@ravenlens/raven-adk/models/video/providers";
import {
    Audio,
    LipSync,
    OneStage,
    Providers,
    TwoStage
} from "@ravenlens/raven-adk/models/video";

// The same contracts are also available from "@ravenlens/raven-adk/models/video".
```

## Provider-native video model

A provider-native model delegates generation directly to the provider API. It has no RavenADK
one-stage or two-stage pipeline, does not accept a synchronization requirement, and must not claim
that human lips, gestures, or expressions are synchronized. Its behavior is described only by the
provider capability declaration and its provider-specific options.

This mode is useful for ordinary text-to-video or image-to-video generation:

```typescript
const providerCapabilities: VideoModelCapabilities = {
    pipelines: {},
    provider: {
        input: {
            prompt: true,
            referenceImages: true,
            referenceVideo: false,
            audio: false,
            providerOptions: true
        },
        output: {
            audio: false,
            formats: ["mp4", "webm"],
            maxDurationMs: 120000
        }
    },
    scene: {
        instruction: false,
        motionInstructions: false,
        backgroundImage: false,
        characterImage: false,
        characterDescription: false,
        characterConsistency: false
    },
    realtime: {
        supported: false
    }
};

const providerRequest: ProviderVideoGenerationRequest = {
    mode: "provider",
    prompt: "A cinematic mountain landscape at sunrise.",
    referenceImages: [{
        source: { kind: "path", path: "./assets/mountain.png" },
        mimeType: "image/png"
    }],
    output: {
        format: "mp4",
        includeAudio: false
    },
    providerOptions: {
        durationSeconds: 8,
        cameraMotion: "slow forward movement"
    }
};

Video.assertVideoCompatibility(providerModel, providerRequest);
```

Provider-native generation can be used for a general video feature, but it is rejected by the
`realtime/agent` and synchronized `podcast` targets. Those branches must use a one-stage or
two-stage workflow with the synchronization guarantees they request. An audio input accepted by a
provider-native model is still only a provider input; it does not become a lip-sync contract.

Use this mode for ordinary footage, backgrounds, camera moves, or a Stage 1 base video. Do not
advertise `native` lip, gesture, or expression synchronization unless the provider contract and
adapter actually guarantee it.

## One-stage model

A one-stage model can accept text or dialogue and produce speech and video in one provider call.
An audio-driven one-stage model can instead accept an already rendered audio asset, optionally with
a transcript and word, phoneme, or viseme alignment. In both cases the provider is responsible for
syncing the accepted speech signal with the character's lips, gestures, and expressions.

```typescript
const oneStageCapabilities: VideoModelCapabilities = {
    pipelines: {
        oneStage: {
            input: {
                text: true,
                audio: true,
                audioTracks: false,
                voiceId: true,
                voiceCloneSample: true,
                alignment: true
            },
            sync: {
                lipSync: "native",
                gestureSync: "native",
                expressionSync: "native"
            },
            multipleSpeakers: true
        }
    },
    scene: {
        instruction: true,
        motionInstructions: true,
        backgroundImage: true,
        characterImage: true,
        characterDescription: true,
        characterConsistency: true,
        maxCharacters: 4
    },
    realtime: {
        supported: true,
        streaming: true,
        pipelines: ["one-stage"],
        input: "text-and-audio",
        output: "video-chunks"
    }
};

const realtimeRequest: OneStagePipeline = {
    pipeline: "one-stage",
    realtime: true,
    scene: {
        instruction: "Use natural body gestures and attentive facial expressions.",
        characters: [{
            id: "agent",
            description: "A friendly professional assistant.",
            referenceImage: {
                source: { kind: "path", path: "./assets/avatar.png" },
                mimeType: "image/png"
            },
            consistencyId: "agent-v1"
        }]
    },
    speech: {
        mode: "text",
        text: answer,
        voice: { kind: "voice-id", voiceId: "agent-voice" }
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    },
    output: {
        format: "webm",
        includeAudio: true
    }
};

Video.assertRealtimeVideoCompatibility(oneStageModel, realtimeRequest);
```

The audio variant is the direct contract for a unified audio-driven Video DiT:

```typescript
const audioOneStageRequest: OneStagePipeline = {
    pipeline: "one-stage",
    scene,
    speech: {
        mode: "audio",
        audio: ttsAudio,
        transcript: answer,
        alignment: speechAlignment
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    }
};
```

Use `mode: "audio"` when TTS is authoritative and the same audio must drive the generated
performance. Set `input.alignment` to `true` only when the provider consumes alignment metadata.
For realtime use, the provider must also advertise `realtime.input` as `"audio"` or
`"text-and-audio"` and implement incremental output.

`realtime/agent` must use a model with `realtime.supported === true`, streaming enabled, a
`generateRealtime` method, and native synchronization for every feature requested as `"required"`.
For a fully synchronized live avatar, require native lip, gesture, and expression support. An
offline lip-sync refiner such as LatentSync or MuseTalk is not a realtime implementation unless
the adapter provides suitable low-latency streaming or chunk processing.

## Two-stage model

A native audio-driven two-stage model consumes the exact audio generated by TTS. This preserves the
selected speaker voice and lets the video model synchronize motion to the audio timeline. The audio
tracks may be per-speaker for a dialogue or a single mixed track when the provider does not accept
separate tracks. This is different from a cascaded two-stage workflow: a cascade generates a base
video first and applies dedicated lip-sync refinement afterward.

```typescript
const twoStageCapabilities: VideoModelCapabilities = {
    pipelines: {
        twoStage: {
            input: {
                text: false,
                audio: true,
                audioTracks: true,
                voiceId: false,
                voiceCloneSample: false,
                alignment: true
            },
            sync: {
                lipSync: "native",
                gestureSync: "native",
                expressionSync: "native"
            },
            multipleSpeakers: true
        }
    },
    scene: {
        instruction: true,
        motionInstructions: true,
        backgroundImage: true,
        characterImage: true,
        characterDescription: true,
        characterConsistency: true,
        maxCharacters: 4
    },
    realtime: {
        supported: false
    }
};

const podcastRequest: TwoStagePipeline = {
    pipeline: "two-stage",
    scene: {
        instruction: "Keep both speakers engaged and react naturally to each other.",
        backgroundImage: {
            source: { kind: "path", path: "./assets/studio.png" },
            mimeType: "image/png"
        },
        characters: [
            {
                id: "host",
                referenceImage: {
                    source: { kind: "path", path: "./assets/host.png" },
                    mimeType: "image/png"
                },
                consistencyId: "host-v1"
            },
            {
                id: "expert",
                referenceImage: {
                    source: { kind: "path", path: "./assets/expert.png" },
                    mimeType: "image/png"
                },
                consistencyId: "expert-v1"
            }
        ]
    },
    speech: {
        mode: "audio",
        audio: {
            tracks: [
                {
                    speakerId: "host",
                    audio: {
                        source: { kind: "bytes", data: hostAudio, mimeType: "audio/mpeg" },
                        mimeType: "audio/mpeg"
                    },
                    startAtMs: 0
                },
                {
                    speakerId: "expert",
                    audio: {
                        source: { kind: "bytes", data: expertAudio, mimeType: "audio/mpeg" },
                        mimeType: "audio/mpeg"
                    },
                    startAtMs: 4200
                }
            ]
        }
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    }
};
```

## Lip-sync refinement in a two-stage cascade

Use a lip-sync refiner when the Stage 1 video provider can create the scene, body motion, camera
motion, and character appearance but cannot guarantee that the mouth follows the final TTS audio.
The refiner receives the Stage 1 `baseVideo` and the exact audio asset produced by TTS. It changes
the mouth or face region while preserving the rest of the performance when it advertises
`preservesBackground: true`.

The contract is intentionally separate from `VideoModel`: LatentSync and MuseTalk are refinement
models, not general scene video generators.

```typescript
const lipSyncModel: VideoLipSyncModel = {
    typeAPI: "model",
    apiName: { custom: "LatentSync" },
    config: { model: "latentsync-provider-model" },
    capabilities: {
        input: {
            video: true,
            audio: true,
            alignment: true,
            multiFace: false
        },
        sync: {
            lipSync: "native"
        },
        preservesBackground: true
    },
    refine: async (
        request: LipSyncRefinementRequest,
        options?: VideoGenerationOptions
    ) => {
        throw new Error("Implement this adapter for the selected provider.");
    }
};

const cascadedPodcastRequest: TwoStagePipeline = {
    ...podcastRequest,
    sync: {
        lipSync: "required",
        gestureSync: "preferred",
        expressionSync: "preferred"
    },
    lipSync: {
        mode: "refinement",
        model: lipSyncModel,
        preserveBackground: true
    }
};
```

The workflow is:

1. TTS renders the authoritative audio and alignment for each speaker.
2. A provider-native or general video model renders the base video.
3. The orchestrator calls `lipSyncModel.refine` with the base video and the matching audio track.
4. The final result reports `lipSync: "synced"`. Body motion and expressions should be reported as
   `"preserved"` or `"unknown"`, not as audio-synchronized, unless another model guarantees them.

If `multiFace` is `false`, run refinement per speaker or per face and provide `speakerId` in the
`LipSyncRefinementRequest`. The orchestration layer must map each speaker ID to the correct face;
audio tracks by themselves do not identify a face. Set `preserveBackground: true` only when the
refiner guarantees that background and non-mouth pixels remain intact. The compatibility helper
will reject a configuration whose refiner cannot accept video, audio, alignment, or requested
background preservation.

For `podcast`, `strategy: "auto"` should select one-stage only when the model advertises all
required capabilities. Otherwise it may fall back to two-stage only when TTS can produce every
speaker's audio and the selected two-stage path advertises the required synchronization. A native
audio-driven two-stage model can require native lip, gesture, and expression synchronization. A
cascaded refiner normally guarantees only lip synchronization, so gesture and expression should be
`"preferred"` or `"disabled"` unless Stage 1 provides a separate guarantee. An edited segment should
reuse unchanged audio and character consistency IDs, then render only the requested segment with
`target.segmentId`.

## Cancelling video generation

Video generation uses the standard `AbortSignal` pattern. The option is named `signal`; there is no
`abort: true` request property. The adapter must forward the signal to its HTTP client or SDK and
must stop polling, streaming, and local processing when the signal is aborted.

```typescript
const controller = new AbortController();
const generation = videoModel.generate(request, {
    signal: controller.signal
});

controller.abort();

try {
    await generation;
} catch (error) {
    if (controller.signal.aborted) {
        throw new Error("Video generation was cancelled.");
    }
    throw error;
}
```

Use the same signal for every stage of a cascade. A local abort can reject the waiting promise,
but a remote provider job may continue unless its adapter also calls the provider's job-cancellation
endpoint. For a cascade, the orchestrator should check `signal.aborted` between TTS, base-video,
and refinement stages. `generateStream` and `generateRealtime` accept the same option.

## Provider and adapter choices

The current video directory defines contracts and compatibility checks; it does not ship concrete
video or lip-sync provider classes. A provider adapter implements `VideoModel.generate`, optionally
`generateStream` or `generateRealtime`, and translates `VideoGenerationOptions.signal` to the
provider's cancellation mechanism.

| Contract | Adapter targets | Required verification |
| --- | --- | --- |
| One-stage unified avatar | Hosted avatar or interactive-video APIs such as HeyGen LiveAvatar, Tavus, D-ID, or a custom audio-driven endpoint | The selected endpoint must accept the declared text/audio/reference inputs and genuinely guarantee the synchronization values it advertises. |
| Stage 1 general video | Provider-native text/image-to-video APIs such as Google Veo, Runway, Luma, Kling, OpenAI Sora, or a custom video endpoint | Verify prompt, reference-image/video, audio, duration, output format, job polling, and cancellation support for the exact model. |
| Lip-sync refinement | Sync Labs/Sync.so, hosted Replicate or fal.ai deployments, RunPod, Hugging Face Inference Endpoints, or a self-hosted LatentSync, MuseTalk, or Wav2Lip service | Verify base-video input, exact audio input, alignment support, face tracking, multi-face behavior, background preservation, and cancellation. |
| TTS for the authoritative audio | OpenAI, Google, Cartesia, or ElevenLabs adapters documented in [Text-to-speech models](text-to-speech.md) | Verify voice cloning consent, output format, and alignment metadata before constructing the audio timeline. |

These names are integration targets, not built-in provider support or capability guarantees. A
provider can be represented with `apiName: { custom: "..." }` and provider-specific values in
`config` or `providerOptions`. LatentSync and MuseTalk are model implementations; the service
hosting them is the provider that the adapter calls.

## Provider schemas and adapter boundaries

The provider folders separate the three implementation roles:

```text
video/providers/
    one-stage/
        provider.ts       # one-stage transport and capability adapter
        visme.ts          # Visme-specific configuration boundary
    two-stage/
        provider.ts       # native audio-timeline transport and capability adapter
    lip-sync/
        latentsync.ts     # LatentSync-specific configuration boundary
        musetalk.ts       # MuseTalk-specific configuration boundary
    ../schemas/
        audio.schema.ts
        lips-sync.schema.ts
        video-provider.schema.ts
```

The factory functions accept a provider-specific transport. RavenADK owns request and capability
validation, but it does not invent a vendor HTTP API, polling protocol, or cancellation endpoint.
The application or provider integration supplies that transport and must forward
`VideoGenerationOptions.signal`.

```typescript
const visme = createVismeOneStageModel({
    config: {
        provider: "visme",
        model: "avatar-model",
        apiKey: process.env.VISME_API_KEY,
        baseURL: process.env.VISME_BASE_URL
    },
    capabilities: oneStageCapabilities,
    transport: {
        generate: (request, options) => vismeClient.generate(request, options)
    }
});

const nativeTwoStage = createTwoStageVideoModel({
    config: {
        provider: "my-two-stage-provider",
        model: "dialogue-model",
        apiKey: process.env.VIDEO_API_KEY
    },
    capabilities: twoStageCapabilities,
    transport: {
        generate: (request, options) => twoStageClient.generate(request, options)
    }
});

const lipSync = createLatentSyncModel({
    config: {
        provider: "latentsync",
        model: "refiner-model",
        apiKey: process.env.LIPSYNC_API_KEY
    },
    capabilities: lipSyncCapabilities,
    transport: {
        refine: (request, options) => lipSyncClient.refine(request, options)
    }
});

const museTalk = createMuseTalkModel({
    config: {
        provider: "musetalk",
        model: "refiner-model",
        apiKey: process.env.LIPSYNC_API_KEY
    },
    capabilities: lipSyncCapabilities,
    transport: {
        refine: (request, options) => museTalkClient.refine(request, options)
    }
});
```

`createVismeOneStageModel` and `createTwoStageVideoModel` return `VideoModel` instances. Their
transport functions accept only their declared pipeline, while the returned model still satisfies
the aggregate `VideoModel` contract used by compatibility helpers. `createLatentSyncModel` and
`createMuseTalkModel` return `VideoLipSyncModel` instances with `refine`, not general video
generation. This keeps a cascaded Stage 1 plus lip-sync workflow explicit:

```text
TTS audio -> one-stage or native two-stage VideoModel
Stage 1 base video + TTS audio -> VideoLipSyncModel.refine
```

`SpeechAlignment` is shared by one-stage audio input, two-stage audio tracks, and lip-sync
refinement, so it lives under `video/schemas/audio.schema` rather than under the two-stage module.
The aggregate `@ravenlens/raven-adk/models/video` export continues to re-export these types, along
with the `Audio`, `LipSync`, `OneStage`, `TwoStage`, and `Providers` namespaces.

## Using video models with `podcast`

Use `podcast` for offline or queued multi-speaker rendering:

1. Render each speaker's TTS audio and alignment.
2. Preserve each audio track's `speakerId` and start time.
3. Use a native one-stage model when it accepts the complete dialogue and advertises every required
   synchronization capability.
4. Use a native two-stage model when it accepts the TTS audio timeline and advertises native lip,
   gesture, and expression synchronization.
5. Use a cascaded two-stage request with `lipSync.mode: "refinement"` when Stage 1 creates the base
   scene and the refiner guarantees the mouth only. Request gesture and expression synchronization
   as `"preferred"` or `"disabled"` unless a separate model guarantees it.

Before rendering, call `assertPodcastVideoCompatibility`. For a multi-face refiner, verify that the
provider supports `multiFace`. Otherwise render one face or speaker at a time and maintain an
explicit speaker-to-face mapping. Re-rendered segments should retain the original audio and
character `consistencyId` values.

## Using video models with `realtime/agent`

Use `realtime/agent` only with a low-latency model that advertises `realtime.supported: true`, the
requested pipeline in `realtime.pipelines`, streaming output, and an implemented `generateRealtime`
method. A text-driven live avatar uses `speech.mode: "text"`; an audio-driven live avatar uses
`speech.mode: "audio"` and requires realtime input `"audio"` or `"text-and-audio"`.

```typescript
Video.assertRealtimeVideoCompatibility(realtimeVideoModel, realtimeRequest);

for await (const event of realtimeVideoModel.generateRealtime(realtimeRequest, {
    signal: controller.signal
})) {
    if (event.type === "chunk") {
        deliverVideoChunk(event);
    }
}
```

Do not put a normal provider-native video job or an offline LatentSync/MuseTalk job directly in the
realtime path. Use a one-stage streaming avatar provider, or build a dedicated streaming adapter
that can meet the latency and cancellation requirements. A provider that only returns a completed
video asset belongs in the podcast or general video path.

## Related model groups

- [Text-to-speech models](text-to-speech.md) produce the authoritative audio for audio-driven video.
- [Speech-to-text models](speech-to-text.md) can provide transcripts for video inputs and workflows.
- [Text-to-text models](text-to-text.md) can produce prompts, dialogue, or scene instructions.
- [Embedding models](embeddings.md) can support retrieval for video scripts and character context.
