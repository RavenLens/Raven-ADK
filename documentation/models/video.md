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
    createHeyGenOneStageModel,
    createReplicateLipSyncModel,
    createVertexVeoModel
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

The video directory ships concrete HTTP integrations as well as generic transport factories. Every
integration uses `fetch`, forwards `VideoGenerationOptions.signal`, supports bounded polling for
asynchronous jobs, and normalizes the provider's media URL into `VideoGenerationResult`.

### Supported integrations

| Provider | Contract | Implementation | Notes |
| --- | --- | --- | --- |
| Google Vertex AI Veo | Ordinary provider-native Stage 1 | `createVertexVeoModel` | Requires a Google Cloud project, regional endpoint, OAuth access token, and public or resolvable output URI. It does not claim lip-sync or external-audio synchronization. |
| HeyGen | One-stage avatar video | `createHeyGenOneStageModel` | Supports text speech and URL-backed audio for the first scene avatar. Dialogue arrays and realtime generation are not implemented by this adapter. |
| Replicate | Cascaded lip-sync refinement | `createReplicateLipSyncModel` | Runs a selected Replicate model version with URL-backed base video and audio, then polls the prediction. The model version determines face and alignment behavior. |

Native two-stage audio-timeline generation has no built-in vendor adapter yet. Use
`createTwoStageVideoModel` with a provider transport only after verifying that the vendor accepts
authoritative external audio tracks and documents its synchronization guarantees.

| Contract | Adapter targets | Required verification |
| --- | --- | --- |
| One-stage unified avatar | HeyGen adapter above; other hosted avatar APIs remain adapter targets | Verify the selected endpoint's exact text/audio/reference contract and synchronization guarantees. |
| Stage 1 general video | Vertex AI Veo adapter above; Runway, Luma, Kling, OpenAI Sora, and custom endpoints remain targets | Verify prompt, reference media, output format, job polling, and cancellation for the exact model. |
| Lip-sync refinement | Replicate adapter above; Sync.so, fal.ai, RunPod, Hugging Face, and self-hosted services remain targets | Verify base-video input, audio input, alignment, face tracking, background preservation, and cancellation. |
| TTS for the authoritative audio | OpenAI, Google, Cartesia, or ElevenLabs adapters documented in [Text-to-speech models](text-to-speech.md) | Verify voice cloning consent, output format, and alignment metadata before constructing the audio timeline. |

Unlisted names are integration targets, not built-in provider support or capability guarantees. A
provider can be represented with `apiName: { custom: "..." }` and provider-specific values in
`config` or `providerOptions`.

## Provider schemas and adapter boundaries

The provider folders separate the three implementation roles:

```text
video/providers/
    http.util.ts          # fetch, cancellation, polling, and URL normalization
    one-stage/
        provider.util.ts  # one-stage transport and capability adapter
        heygen.ts         # HeyGen HTTP integration
    ordinary/
        vertex-veo.ts     # Vertex AI Veo HTTP integration
    two-stage/
        provider.util.ts  # native audio-timeline transport and capability adapter
    lip-sync/
        replicate.ts      # Replicate prediction integration
    ../schemas/
        audio.schema.ts
        lips-sync.schema.ts
        video-provider.schema.ts
```

The generic factory functions still accept provider-specific transports when a vendor is not yet
implemented. The concrete adapters below own their documented HTTP paths and polling behavior.

```typescript
const heygen = createHeyGenOneStageModel({
    config: {
        provider: "heygen",
        apiKey: process.env.HEYGEN_API_KEY!
    },
    capabilities: oneStageCapabilities
});

const lipSync = createReplicateLipSyncModel({
    config: {
        provider: "replicate",
        version: process.env.REPLICATE_MODEL_VERSION!,
        apiKey: process.env.REPLICATE_API_TOKEN!
    },
    capabilities: lipSyncCapabilities
});

const veo = createVertexVeoModel({
    config: {
        provider: "vertex-veo",
        model: "veo-3.0-generate-001",
        projectId: process.env.GOOGLE_CLOUD_PROJECT!,
        accessToken: process.env.GOOGLE_ACCESS_TOKEN!
    },
    capabilities: providerCapabilities
});
```

`createHeyGenOneStageModel` and `createVertexVeoModel` return `VideoModel` instances.
`createReplicateLipSyncModel` returns a `VideoLipSyncModel` with `refine`, not general video
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
