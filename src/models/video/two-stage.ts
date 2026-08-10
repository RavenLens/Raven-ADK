import type {
    VideoApiName,
    VideoAsset,
    VideoCapability,
    VideoGenerationOptions,
    VideoGenerationResult,
    VideoModelConfig,
    VideoOutputOptions,
    VideoRenderTarget,
    VideoScene,
    VideoSyncRequest
} from "./video.mutual";

export interface SpeechAlignment {
    words?: Array<{
        text: string;
        startMs: number;
        endMs: number;
    }>;
    phonemes?: Array<{
        value: string;
        startMs: number;
        endMs: number;
    }>;
    visemes?: Array<{
        value: string;
        startMs: number;
        endMs: number;
    }>;
}

// Lips syncing model spec
export interface LipSyncRefinementRequest {
    mode: "lip-sync-refinement";
    baseVideo: VideoAsset;
    audio: VideoAsset;
    alignment?: SpeechAlignment;
    speakerId?: string;
    preserveBackground?: boolean;
}

export interface VideoLipSyncCapabilities {
    input: {
        video: boolean;
        audio: boolean;
        alignment: boolean;
        multiFace: boolean;
    };
    sync: {
        lipSync: VideoCapability;
    };
    preservesBackground: boolean;
}

export interface VideoLipSyncModel {
    typeAPI: "model";
    apiName: VideoApiName;
    config?: VideoModelConfig;
    capabilities: VideoLipSyncCapabilities;
    refine(
        request: LipSyncRefinementRequest,
        options?: VideoGenerationOptions
    ): Promise<VideoGenerationResult>;
}

export interface TwoStageLipSyncConfiguration {
    mode: "refinement";
    model: VideoLipSyncModel;
    preserveBackground?: boolean;
}

// 2 stage pipeline spec
export interface AudioTrack {
    speakerId: string;
    audio: VideoAsset;
    startAtMs?: number;
    alignment?: SpeechAlignment;
}

export interface AudioTimeline {
    tracks: AudioTrack[];
    mixedAudio?: VideoAsset;
    durationMs?: number;
}

export interface TwoStagePipeline {
    pipeline: "two-stage";
    scene: VideoScene;
    speech: {
        mode: "audio";
        audio: AudioTimeline;
        transcript?: string;
    };
    sync: VideoSyncRequest;
    lipSync?: TwoStageLipSyncConfiguration;
    target?: VideoRenderTarget;
    output?: VideoOutputOptions;
    realtime?: boolean;
}