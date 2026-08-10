import type {
    VideoAsset,
    VideoOutputOptions,
    VideoRenderTarget,
    VideoScene,
    VideoSyncRequest
} from "../../video.mutual";
import type { SpeechAlignment } from "../audio.schema";
import type { TwoStageLipSyncConfiguration } from "../lips-sync.schema";

export type { SpeechAlignment } from "../audio.schema";
export type {
    LipSyncRefinementRequest,
    TwoStageLipSyncConfiguration,
    VideoLipSyncCapabilities,
    VideoLipSyncModel
} from "../lips-sync.schema";

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