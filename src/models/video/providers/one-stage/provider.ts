import type { OneStagePipeline } from "../../schemas/stages/one-stage.schema";
import type {
    RealtimeVideoRequest,
    VideoGenerationEvent,
    VideoGenerationOptions,
    VideoGenerationRequest,
    VideoGenerationResult,
    VideoModel,
    VideoModelCapabilities,
    VideoPipelineCapabilities
} from "../../video.mutual";
import {
    createVideoProviderModel,
    type VideoProviderConfig,
    type VideoProviderTransport
} from "../../schemas/video-provider.schema";

export interface OneStageVideoProviderConfig extends VideoProviderConfig {}

export interface OneStageVideoProviderCapabilities extends Omit<VideoModelCapabilities, "pipelines"> {
    pipelines: {
        oneStage: VideoPipelineCapabilities;
    };
}

export interface OneStageVideoProviderTransport {
    generate(
        request: OneStagePipeline,
        options?: VideoGenerationOptions
    ): Promise<VideoGenerationResult>;
    generateStream?(
        request: OneStagePipeline,
        options?: VideoGenerationOptions
    ): AsyncIterable<VideoGenerationEvent>;
    generateRealtime?(
        request: RealtimeVideoRequest,
        options?: VideoGenerationOptions
    ): AsyncIterable<VideoGenerationEvent>;
}

export interface OneStageVideoProviderDefinition {
    config: OneStageVideoProviderConfig;
    capabilities: OneStageVideoProviderCapabilities;
    transport: OneStageVideoProviderTransport;
}

function requireOneStage(request: VideoGenerationRequest): OneStagePipeline {
    if (!("pipeline" in request) || request.pipeline !== "one-stage") {
        throw new Error("The one-stage provider received a non-one-stage video request.");
    }
    return request;
}

function requireRealtimeOneStage(request: RealtimeVideoRequest): RealtimeVideoRequest {
    if (request.pipeline !== "one-stage") {
        throw new Error("The one-stage provider received a non-one-stage realtime request.");
    }
    return request;
}

export function createOneStageVideoModel(definition: OneStageVideoProviderDefinition): VideoModel {
    const transport: VideoProviderTransport = {
        generate: async (request, options) => definition.transport.generate(requireOneStage(request), options),
        generateStream: definition.transport.generateStream
            ? (request, options) => definition.transport.generateStream!(requireOneStage(request), options)
            : undefined,
        generateRealtime: definition.transport.generateRealtime
            ? (request, options) => definition.transport.generateRealtime!(requireRealtimeOneStage(request), options)
            : undefined
    };

    return createVideoProviderModel({
        apiName: definition.config.provider,
        config: definition.config,
        capabilities: definition.capabilities,
        transport
    });
}
