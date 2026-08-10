import type { VideoModel } from "../../video.mutual";
import {
    createOneStageVideoModel,
    type OneStageVideoProviderCapabilities,
    type OneStageVideoProviderTransport
} from "./provider";
import type { OneStageVideoProviderConfig } from "./provider";

export interface VismeOneStageConfig extends OneStageVideoProviderConfig {
    provider: "visme";
}

export interface VismeOneStageDefinition {
    config: VismeOneStageConfig;
    capabilities: OneStageVideoProviderCapabilities;
    transport: OneStageVideoProviderTransport;
}

export function createVismeOneStageModel(definition: VismeOneStageDefinition): VideoModel {
    return createOneStageVideoModel(definition);
}
