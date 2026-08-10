import { LLMConfig } from "../mutual";
import type { OneStagePipeline } from "./one-stage";
import type { ProviderVideoCapabilities, ProviderVideoGenerationRequest } from "./provider";
import type { TwoStagePipeline } from "./two-stage";

export type {
    DialogueLine,
    OneStagePipeline,
    OneStageSpeechInput
} from "./one-stage";
export type {
    AudioTimeline,
    AudioTrack,
    LipSyncRefinementRequest,
    SpeechAlignment,
    TwoStageLipSyncConfiguration,
    TwoStagePipeline,
    VideoLipSyncCapabilities,
    VideoLipSyncModel
} from "./two-stage";
export type {
    ProviderVideoCapabilities,
    ProviderVideoGenerationRequest,
    ProviderVideoInputCapabilities,
    ProviderVideoOutputCapabilities
} from "./provider";

export type VideoPipelineKind = "one-stage" | "two-stage";
export type VideoCapability = "native" | "best-effort" | "unsupported";
export type SyncRequirement = "required" | "preferred" | "disabled";
export type VideoApiName = string | { custom: string };

export type VideoMediaInput =
    | { kind: "url"; url: string; mimeType?: string }
    | { kind: "path"; path: string; mimeType?: string }
    | { kind: "bytes"; data: Buffer | Uint8Array | Blob | File; mimeType: string };

export interface VideoAsset {
    source: VideoMediaInput;
    mimeType: string;
    durationMs?: number;
    width?: number;
    height?: number;
}

export interface VideoCharacter {
    id: string;
    displayName?: string;
    description?: string;
    referenceImage?: VideoAsset;
    consistencyId?: string;
}

export interface VideoMotionInstructions {
    body?: string;
    gestures?: string;
    expressions?: string;
    camera?: string;
}

export interface VideoScene {
    instruction?: string;
    backgroundImage?: VideoAsset;
    characters: VideoCharacter[];
    motion?: VideoMotionInstructions;
}

export interface VoiceCloneConsent {
    granted: true;
    subjectId?: string;
}

export type VoiceReference =
    | { kind: "voice-id"; voiceId: string }
    | { kind: "voice-clone"; sample: VideoAsset; consent?: VoiceCloneConsent };

export interface VideoOutputOptions {
    format?: string;
    width?: number;
    height?: number;
    fps?: number;
    includeAudio?: boolean;
}

export interface VideoRenderTarget {
    segmentId?: string;
    startAtMs?: number;
    endAtMs?: number;
}

export type VideoGenerationRequest = OneStagePipeline | TwoStagePipeline | ProviderVideoGenerationRequest;
export type RealtimeVideoRequest = (OneStagePipeline | TwoStagePipeline) & { realtime: true };

export interface VideoSyncRequest {
    lipSync: SyncRequirement;
    gestureSync: SyncRequirement;
    expressionSync: SyncRequirement;
}

export interface VideoSyncCapabilities {
    lipSync: VideoCapability;
    gestureSync: VideoCapability;
    expressionSync: VideoCapability;
}

export interface VideoPipelineInputCapabilities {
    text: boolean;
    audio: boolean;
    audioTracks: boolean;
    voiceId: boolean;
    voiceCloneSample: boolean;
    alignment: boolean;
}

export interface VideoPipelineCapabilities {
    input: VideoPipelineInputCapabilities;
    sync: VideoSyncCapabilities;
    multipleSpeakers: boolean;
}

export interface VideoSceneCapabilities {
    instruction: boolean;
    motionInstructions: boolean;
    backgroundImage: boolean;
    characterImage: boolean;
    characterDescription: boolean;
    characterConsistency: boolean;
    maxCharacters?: number;
}

export type VideoRealtimeInput = "text" | "audio" | "text-and-audio";
export type VideoRealtimeOutput = "video-chunks" | "frames";

export interface UnsupportedRealtimeVideoCapabilities {
    supported: false;
}

export interface SupportedRealtimeVideoCapabilities {
    supported: true;
    streaming: boolean;
    pipelines: VideoPipelineKind[];
    input: VideoRealtimeInput;
    output: VideoRealtimeOutput;
    maxStartupLatencyMs?: number;
}

export type VideoRealtimeCapabilities =
    | UnsupportedRealtimeVideoCapabilities
    | SupportedRealtimeVideoCapabilities;

export interface VideoModelCapabilities {
    pipelines: {
        oneStage?: VideoPipelineCapabilities;
        twoStage?: VideoPipelineCapabilities;
    };
    provider?: ProviderVideoCapabilities;
    scene: VideoSceneCapabilities;
    realtime: VideoRealtimeCapabilities;
}

export interface VideoModelConfig extends Omit<LLMConfig, "messages" | "tools"> {
    outputFormat?: string;
    [key: string]: unknown;
}

export interface VideoGenerationOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    idempotencyKey?: string;
}

export type VideoSyncResult = "synced" | "preserved" | "not-requested" | "unsupported" | "unknown";

export interface VideoGenerationResult {
    id?: string;
    video: VideoAsset;
    audio?: VideoAsset;
    sync: {
        lipSync: VideoSyncResult;
        gestureSync: VideoSyncResult;
        expressionSync: VideoSyncResult;
    };
    durationMs?: number;
}

export type VideoGenerationEvent =
    | { type: "started"; jobId?: string }
    | { type: "progress"; progress: number }
    | {
        type: "chunk";
        video?: VideoAsset;
        audio?: VideoAsset;
        startAtMs: number;
        endAtMs: number;
    }
    | { type: "completed"; result: VideoGenerationResult }
    | { type: "failed"; error: unknown };

export interface VideoModel {
    typeAPI: "model";
    apiName: VideoApiName;
    config: VideoModelConfig;
    capabilities: VideoModelCapabilities;
    generate(
        request: VideoGenerationRequest,
        options?: VideoGenerationOptions
    ): Promise<VideoGenerationResult>;
    generateStream?(
        request: VideoGenerationRequest,
        options?: VideoGenerationOptions
    ): AsyncIterable<VideoGenerationEvent>;
    generateRealtime?(
        request: RealtimeVideoRequest,
        options?: VideoGenerationOptions
    ): AsyncIterable<VideoGenerationEvent>;
}

export interface RealtimeVideoModel extends VideoModel {
    generateRealtime(
        request: RealtimeVideoRequest,
        options?: VideoGenerationOptions
    ): AsyncIterable<VideoGenerationEvent>;
}

export type VideoCompatibilitySeverity = "error" | "warning";

export interface VideoCompatibilityIssue {
    code: string;
    message: string;
    severity: VideoCompatibilitySeverity;
}

export interface VideoCompatibilityOptions {
    target?: "realtime-agent" | "podcast";
}

function addIssue(
    issues: VideoCompatibilityIssue[],
    code: string,
    message: string,
    severity: VideoCompatibilitySeverity = "error"
): void {
    issues.push({ code, message, severity });
}

function checkSyncRequirement(
    issues: VideoCompatibilityIssue[],
    requirement: SyncRequirement,
    support: VideoCapability,
    code: string,
    label: string
): void {
    if (requirement === "required" && support !== "native") {
        addIssue(issues, code, `${label} is required, but the model advertises ${support} support.`);
    } else if (requirement === "preferred" && support === "unsupported") {
        addIssue(issues, code, `${label} is preferred, but the model advertises unsupported support.`, "warning");
    }
}

function checkVoiceReference(
    issues: VideoCompatibilityIssue[],
    voice: VoiceReference | undefined,
    capabilities: VideoPipelineCapabilities
): void {
    if (!voice) return;

    if (voice.kind === "voice-id" && !capabilities.input.voiceId) {
        addIssue(issues, "voice-id-input-unsupported", "The request uses a voice ID, but the pipeline does not accept voice IDs.");
    }

    if (voice.kind === "voice-clone" && !capabilities.input.voiceCloneSample) {
        addIssue(issues, "voice-clone-input-unsupported", "The request uses a voice clone sample, but the pipeline does not accept voice clone samples.");
    }
}

function checkScene(
    issues: VideoCompatibilityIssue[],
    scene: VideoScene,
    capabilities: VideoSceneCapabilities,
    target?: VideoCompatibilityOptions["target"]
): void {
    if ((target === "realtime-agent" || target === "podcast") && scene.characters.length === 0) {
        addIssue(issues, "characters-required", `${target} video requires at least one character.`);
    }

    if (scene.instruction && !capabilities.instruction) {
        addIssue(issues, "scene-instruction-unsupported", "The request includes a scene instruction, but the model does not accept scene instructions.");
    }

    if (scene.motion && !capabilities.motionInstructions) {
        addIssue(issues, "motion-instructions-unsupported", "The request includes motion instructions, but the model does not accept them.");
    }

    if (scene.backgroundImage && !capabilities.backgroundImage) {
        addIssue(issues, "background-image-unsupported", "The request includes a background image, but the model does not accept one.");
    }

    if (capabilities.maxCharacters !== undefined && scene.characters.length > capabilities.maxCharacters) {
        addIssue(issues, "character-limit-exceeded", `The request has ${scene.characters.length} characters, but the model supports at most ${capabilities.maxCharacters}.`);
    }

    for (const character of scene.characters) {
        if (character.referenceImage && !capabilities.characterImage) {
            addIssue(issues, "character-image-unsupported", `Character '${character.id}' has a reference image, but the model does not accept character images.`);
        }
        if (character.description && !capabilities.characterDescription) {
            addIssue(issues, "character-description-unsupported", `Character '${character.id}' has a description, but the model does not accept character descriptions.`);
        }
        if (character.consistencyId && !capabilities.characterConsistency) {
            addIssue(issues, "character-consistency-unsupported", `Character '${character.id}' requests consistency '${character.consistencyId}', but the model does not support character consistency.`);
        }
    }
}

function isProviderVideoGenerationRequest(
    request: VideoGenerationRequest
): request is ProviderVideoGenerationRequest {
    return "mode" in request && request.mode === "provider";
}

export function getVideoCompatibilityIssues(
    model: VideoModel,
    request: VideoGenerationRequest,
    options: VideoCompatibilityOptions = {}
): VideoCompatibilityIssue[] {
    const issues: VideoCompatibilityIssue[] = [];

    if (isProviderVideoGenerationRequest(request)) {
        const providerCapabilities = model.capabilities.provider;
        if (!providerCapabilities) {
            addIssue(issues, "provider-generation-unsupported", "The model does not advertise direct provider video generation.");
            return issues;
        }

        if (options.target === "realtime-agent" || options.target === "podcast") {
            addIssue(issues, "provider-generation-not-compatible-with-target", `The ${options.target} requires human lip, gesture, and expression synchronization; direct provider generation does not provide those guarantees.`);
        }
        if (!providerCapabilities.input.prompt) {
            addIssue(issues, "provider-prompt-input-unsupported", "The provider video request requires prompt input, but the model does not accept prompts.");
        }
        if (!request.prompt.trim()) {
            addIssue(issues, "empty-provider-prompt", "The provider video prompt must not be empty.");
        }
        if (request.referenceImages?.length && !providerCapabilities.input.referenceImages) {
            addIssue(issues, "provider-reference-images-unsupported", "The request includes reference images, but the provider does not accept them.");
        }
        if (request.referenceVideo && !providerCapabilities.input.referenceVideo) {
            addIssue(issues, "provider-reference-video-unsupported", "The request includes a reference video, but the provider does not accept one.");
        }
        if (request.audio && !providerCapabilities.input.audio) {
            addIssue(issues, "provider-audio-input-unsupported", "The request includes audio input, but the provider does not accept it.");
        }
        if (request.providerOptions && !providerCapabilities.input.providerOptions) {
            addIssue(issues, "provider-options-unsupported", "The request includes provider-specific options, but the model does not expose that capability.");
        }
        if (request.output?.includeAudio && !providerCapabilities.output.audio) {
            addIssue(issues, "provider-audio-output-unsupported", "The request asks for audio output, but the provider does not advertise audio output.");
        }
        if (request.output?.format && providerCapabilities.output.formats && !providerCapabilities.output.formats.includes(request.output.format)) {
            addIssue(issues, "provider-format-unsupported", `The provider does not advertise support for '${request.output.format}' output.`);
        }
        return issues;
    }

    checkScene(issues, request.scene, model.capabilities.scene, options.target);

    const pipelineCapabilities = request.pipeline === "one-stage"
        ? model.capabilities.pipelines.oneStage
        : model.capabilities.pipelines.twoStage;

    if (!pipelineCapabilities) {
        addIssue(issues, "pipeline-unsupported", `The model does not advertise the ${request.pipeline} pipeline.`);
        return issues;
    }

    if (request.pipeline === "one-stage") {
        if (request.speech.mode !== "audio" && !pipelineCapabilities.input.text) {
            addIssue(issues, "text-input-unsupported", "The one-stage request requires text input, but the model does not accept text.");
        }

        if (request.speech.mode === "text") {
            if (!request.speech.text.trim()) {
                addIssue(issues, "empty-text-input", "The one-stage text input must not be empty.");
            }
            checkVoiceReference(issues, request.speech.voice, pipelineCapabilities);
        } else if (request.speech.mode === "audio") {
            if (!pipelineCapabilities.input.audio) {
                addIssue(issues, "audio-input-unsupported", "The one-stage request requires audio input, but the model does not accept audio.");
            }
            if (request.speech.alignment && !pipelineCapabilities.input.alignment) {
                addIssue(issues, "alignment-unsupported", "The request includes speech alignment data, but the model does not accept alignment input.");
            }
        } else {
            if (request.speech.lines.length === 0) {
                addIssue(issues, "empty-dialogue-input", "The one-stage dialogue input must contain at least one line.");
            }
            if (request.speech.lines.length > 0 && !pipelineCapabilities.multipleSpeakers) {
                const speakerIds = new Set(request.speech.lines.map(line => line.speakerId));
                if (speakerIds.size > 1) {
                    addIssue(issues, "multiple-speakers-unsupported", "The request contains multiple speakers, but the model does not support them.");
                }
            }
            for (const line of request.speech.lines) {
                checkVoiceReference(issues, line.voice, pipelineCapabilities);
            }
        }
    } else {
        if (!pipelineCapabilities.input.audio) {
            addIssue(issues, "audio-input-unsupported", "The two-stage request requires audio input, but the model does not accept audio.");
        }
        if (!pipelineCapabilities.input.audioTracks && request.speech.audio.tracks.length > 1) {
            addIssue(issues, "audio-tracks-unsupported", "The request contains multiple audio tracks, but the model does not accept separate audio tracks.");
        }
        if (request.speech.audio.tracks.length === 0 && !request.speech.audio.mixedAudio) {
            addIssue(issues, "empty-audio-input", "The two-stage request must contain an audio track or mixed audio.");
        }
        if (!pipelineCapabilities.input.alignment && request.speech.audio.tracks.some(track => track.alignment)) {
            addIssue(issues, "alignment-unsupported", "The request includes speech alignment data, but the model does not accept alignment input.");
        }
        if (!pipelineCapabilities.multipleSpeakers) {
            const speakerIds = new Set(request.speech.audio.tracks.map(track => track.speakerId));
            if (speakerIds.size > 1) {
                addIssue(issues, "multiple-speakers-unsupported", "The request contains multiple speakers, but the model does not support them.");
            }
        }
    }

    const lipSyncSupport = request.pipeline === "two-stage" && request.lipSync
        ? request.lipSync.model.capabilities.sync.lipSync
        : pipelineCapabilities.sync.lipSync;
    checkSyncRequirement(issues, request.sync.lipSync, lipSyncSupport, "lip-sync-unsupported", "Lip synchronization");
    checkSyncRequirement(issues, request.sync.gestureSync, pipelineCapabilities.sync.gestureSync, "gesture-sync-unsupported", "Gesture synchronization");
    checkSyncRequirement(issues, request.sync.expressionSync, pipelineCapabilities.sync.expressionSync, "expression-sync-unsupported", "Expression synchronization");

    if (request.pipeline === "two-stage" && request.lipSync) {
        const lipSyncCapabilities = request.lipSync.model.capabilities;
        if (!lipSyncCapabilities.input.video) {
            addIssue(issues, "lip-sync-video-input-unsupported", "The lip-sync refiner does not accept the base video input.");
        }
        if (!lipSyncCapabilities.input.audio) {
            addIssue(issues, "lip-sync-audio-input-unsupported", "The lip-sync refiner does not accept the TTS audio input.");
        }
        if (request.speech.audio.tracks.some(track => track.alignment) && !lipSyncCapabilities.input.alignment) {
            addIssue(issues, "lip-sync-alignment-unsupported", "The request includes speech alignment data, but the lip-sync refiner does not accept alignment input.");
        }
        if (request.lipSync.preserveBackground && !lipSyncCapabilities.preservesBackground) {
            addIssue(issues, "lip-sync-background-preservation-unsupported", "The request asks the lip-sync refiner to preserve the background, but it does not advertise that capability.");
        }
    }

    return issues;
}

export function getRealtimeVideoCompatibilityIssues(
    model: VideoModel,
    request: RealtimeVideoRequest
): VideoCompatibilityIssue[] {
    const issues = getVideoCompatibilityIssues(model, request, { target: "realtime-agent" });
    const realtime = model.capabilities.realtime;

    if (!request.realtime) {
        addIssue(issues, "realtime-request-required", "The realtime agent requires a request with realtime: true.");
    }

    if (!realtime.supported) {
        addIssue(issues, "realtime-unsupported", "The model does not support realtime video generation.");
        return issues;
    }

    if (!realtime.streaming) {
        addIssue(issues, "realtime-streaming-unsupported", "The realtime agent requires streaming video output.");
    }

    if (!realtime.pipelines.includes(request.pipeline)) {
        addIssue(issues, "realtime-pipeline-unsupported", `The model does not advertise realtime support for ${request.pipeline}.`);
    }

    if (!model.generateRealtime) {
        addIssue(issues, "realtime-generation-method-missing", "The model advertises realtime support but does not implement generateRealtime.");
    }

    const requiresAudio = request.pipeline === "two-stage" || request.speech.mode === "audio";
    const requiresText = !requiresAudio;
    const acceptsInput = realtime.input === "text-and-audio"
        || (requiresAudio && realtime.input === "audio")
        || (requiresText && realtime.input === "text");
    if (!acceptsInput) {
        addIssue(issues, "realtime-input-unsupported", `The model realtime input mode '${realtime.input}' does not support ${requiresAudio ? "audio" : "text"} input.`);
    }

    return issues;
}

export function getPodcastVideoCompatibilityIssues(
    model: VideoModel,
    request: VideoGenerationRequest
): VideoCompatibilityIssue[] {
    return getVideoCompatibilityIssues(model, request, { target: "podcast" });
}

function formatCompatibilityErrors(issues: VideoCompatibilityIssue[]): string {
    return issues
        .filter(issue => issue.severity === "error")
        .map(issue => `[${issue.code}] ${issue.message}`)
        .join(" ");
}

export function assertVideoCompatibility(
    model: VideoModel,
    request: VideoGenerationRequest,
    options: VideoCompatibilityOptions = {}
): void {
    const errors = formatCompatibilityErrors(getVideoCompatibilityIssues(model, request, options));
    if (errors) throw new Error(`Video request is not compatible with the model: ${errors}`);
}

export function assertRealtimeVideoCompatibility(
    model: VideoModel,
    request: RealtimeVideoRequest
): void {
    const errors = formatCompatibilityErrors(getRealtimeVideoCompatibilityIssues(model, request));
    if (errors) throw new Error(`Realtime video request is not compatible with the model: ${errors}`);
}

export function assertPodcastVideoCompatibility(
    model: VideoModel,
    request: VideoGenerationRequest
): void {
    const errors = formatCompatibilityErrors(getPodcastVideoCompatibilityIssues(model, request));
    if (errors) throw new Error(`Podcast video request is not compatible with the model: ${errors}`);
}

export function supportsVideoRequest(
    model: VideoModel,
    request: VideoGenerationRequest,
    options: VideoCompatibilityOptions = {}
): boolean {
    return getVideoCompatibilityIssues(model, request, options).every(issue => issue.severity !== "error");
}