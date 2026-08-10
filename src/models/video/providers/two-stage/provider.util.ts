import type { TwoStagePipeline } from "../../schemas/stages/two-stage.schema";
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

export interface TwoStageVideoProviderConfig extends VideoProviderConfig {}

export interface TwoStageVideoProviderCapabilities extends Omit<VideoModelCapabilities, "pipelines"> {
    pipelines: {
        twoStage: VideoPipelineCapabilities;
    };
}

export interface TwoStageVideoProviderTransport {
    generate(
        request: TwoStagePipeline,
        options?: VideoGenerationOptions
    ): Promise<VideoGenerationResult>;
    generateStream?(
        request: TwoStagePipeline,
        options?: VideoGenerationOptions
    ): AsyncIterable<VideoGenerationEvent>;
    generateRealtime?(
        request: RealtimeVideoRequest,
        options?: VideoGenerationOptions
    ): AsyncIterable<VideoGenerationEvent>;
}

export interface TwoStageVideoProviderDefinition {
    config: TwoStageVideoProviderConfig;
    capabilities: TwoStageVideoProviderCapabilities;
    transport: TwoStageVideoProviderTransport;
}

function requireTwoStage(request: VideoGenerationRequest): TwoStagePipeline {
    if (!("pipeline" in request) || request.pipeline !== "two-stage") {
        throw new Error("The two-stage provider received a non-two-stage video request.");
    }
    return request;
}

function requireRealtimeTwoStage(request: RealtimeVideoRequest): RealtimeVideoRequest {
    if (request.pipeline !== "two-stage") {
        throw new Error("The two-stage provider received a non-two-stage realtime request.");
    }
    return request;
}

export function createTwoStageVideoModel(definition: TwoStageVideoProviderDefinition): VideoModel {
    const transport: VideoProviderTransport = {
        generate: async (request, options) => definition.transport.generate(requireTwoStage(request), options),
        generateStream: definition.transport.generateStream
            ? (request, options) => definition.transport.generateStream!(requireTwoStage(request), options)
            : undefined,
        generateRealtime: definition.transport.generateRealtime
            ? (request, options) => definition.transport.generateRealtime!(requireRealtimeTwoStage(request), options)
            : undefined
    };

    return createVideoProviderModel({
        apiName: definition.config.provider,
        config: definition.config,
        capabilities: definition.capabilities,
        transport
    });
}
