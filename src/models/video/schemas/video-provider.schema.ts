import type {
    RealtimeVideoRequest,
    VideoAsset,
    VideoApiName,
    VideoGenerationEvent,
    VideoGenerationOptions,
    VideoGenerationRequest,
    VideoGenerationResult,
    VideoModel,
    VideoModelCapabilities,
    VideoModelConfig,
    VideoOutputOptions
} from "../video.mutual";

export interface VideoProviderConfig extends VideoModelConfig {
    provider: string;
}

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

export interface VideoProviderTransport {
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

export interface VideoProviderDefinition {
    apiName: VideoApiName;
    config: VideoModelConfig;
    capabilities: VideoModelCapabilities;
    transport: VideoProviderTransport;
}

export function createVideoProviderModel(definition: VideoProviderDefinition): VideoModel {
    const model: VideoModel = {
        typeAPI: "model",
        apiName: definition.apiName,
        config: definition.config,
        capabilities: definition.capabilities,
        generate: (request, options) => definition.transport.generate(request, options)
    };

    if (definition.transport.generateStream) {
        model.generateStream = (request, options) => definition.transport.generateStream!(request, options);
    }

    if (definition.transport.generateRealtime) {
        model.generateRealtime = (request, options) => definition.transport.generateRealtime!(request, options);
    }

    return model;
}