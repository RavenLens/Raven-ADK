import type { VideoModel } from "../../video.mutual";
import {
    createOneStageVideoModel,
    type OneStageVideoProviderCapabilities,
    type OneStageVideoProviderTransport
} from "./provider.util";
import type { OneStageVideoProviderConfig } from "./provider.util";

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
