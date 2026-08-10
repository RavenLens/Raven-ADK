import type {
    VideoAsset,
    VideoOutputOptions
} from "./video.mutual";

export interface ProviderVideoGenerationRequest {
    mode: "provider";
    prompt: string;
    negativePrompt?: string;
    referenceImages?: VideoAsset[];
    referenceVideo?: VideoAsset;
    audio?: VideoAsset;
    output?: VideoOutputOptions;
    providerOptions?: Record<string, unknown>;
}

export interface ProviderVideoInputCapabilities {
    prompt: boolean;
    referenceImages: boolean;
    referenceVideo: boolean;
    audio: boolean;
    providerOptions: boolean;
}

export interface ProviderVideoOutputCapabilities {
    audio: boolean;
    formats?: string[];
    maxDurationMs?: number;
}

export interface ProviderVideoCapabilities {
    input: ProviderVideoInputCapabilities;
    output: ProviderVideoOutputCapabilities;
}