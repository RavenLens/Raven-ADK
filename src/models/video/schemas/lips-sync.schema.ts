import type { SpeechAlignment } from "./audio.schema";
import type {
    VideoApiName,
    VideoAsset,
    VideoCapability,
    VideoGenerationOptions,
    VideoGenerationResult,
    VideoModelConfig
} from "../video.mutual";

export type { SpeechAlignment } from "./audio.schema";

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

export interface LipSyncProviderConfig extends VideoModelConfig {
    provider: string;
}

export interface LipSyncProviderTransport {
    refine(
        request: LipSyncRefinementRequest,
        options?: VideoGenerationOptions
    ): Promise<VideoGenerationResult>;
}

export interface LipSyncProviderDefinition {
    config: LipSyncProviderConfig;
    capabilities: VideoLipSyncCapabilities;
    transport: LipSyncProviderTransport;
}

export function createLipSyncProviderModel(definition: LipSyncProviderDefinition): VideoLipSyncModel {
    return {
        typeAPI: "model",
        apiName: definition.config.provider,
        config: definition.config,
        capabilities: definition.capabilities,
        refine: (request, options) => definition.transport.refine(request, options)
    };
}

