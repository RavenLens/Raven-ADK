import type {
    VideoAsset,
    VideoOutputOptions,
    VideoRenderTarget,
    VideoScene,
    VideoSyncRequest,
    VoiceReference
} from "./video.mutual";
import type { SpeechAlignment } from "./two-stage";

export interface DialogueLine {
    id: string;
    speakerId: string;
    text: string;
    voice?: VoiceReference;
    startAtMs?: number;
}

export type OneStageSpeechInput =
    | {
        mode: "text";
        text: string;
        speakerId?: string;
        voice?: VoiceReference;
    }
    | {
        mode: "audio";
        audio: VideoAsset;
        transcript?: string;
        alignment?: SpeechAlignment;
    }
    | {
        mode: "dialogue";
        lines: DialogueLine[];
    };

export interface OneStagePipeline {
    pipeline: "one-stage";
    scene: VideoScene;
    speech: OneStageSpeechInput;
    sync: VideoSyncRequest;
    target?: VideoRenderTarget;
    output?: VideoOutputOptions;
    realtime?: boolean;
}