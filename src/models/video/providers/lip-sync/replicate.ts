import type { VideoLipSyncCapabilities, VideoLipSyncModel } from "../../schemas/lips-sync.schema";
import type { VideoGenerationOptions, VideoGenerationResult } from "../../video.mutual";
import type { LipSyncRefinementRequest } from "../../schemas/lips-sync.schema";
import {
    createVideoHttpClient,
    findMediaUrl,
    pollVideoOperation,
    requireRemoteAsset,
    videoResultFromUrl
} from "../http.util";
import { createLipSyncProviderModel, type LipSyncProviderConfig } from "../../schemas/lips-sync.schema";

export interface ReplicateLipSyncConfig extends LipSyncProviderConfig {
    provider: "replicate";
    version: string;
    baseURL?: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
}

export interface ReplicateLipSyncDefinition {
    config: ReplicateLipSyncConfig;
    capabilities: VideoLipSyncCapabilities;
}

interface ReplicatePrediction {
    id: string;
    status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
    output?: unknown;
    error?: string;
    urls?: { get?: string };
}

export function createReplicateLipSyncModel(
    definition: ReplicateLipSyncDefinition
): VideoLipSyncModel {
    const client = createVideoHttpClient({
        baseURL: definition.config.baseURL ?? "https://api.replicate.com",
        apiKey: definition.config.apiKey as string | undefined
    });

    return createLipSyncProviderModel({
        config: definition.config,
        capabilities: definition.capabilities,
        transport: {
            refine: async (request: LipSyncRefinementRequest, options?: VideoGenerationOptions): Promise<VideoGenerationResult> => {
                const prediction = await client.request<ReplicatePrediction>("/v1/predictions", {
                    method: "POST",
                    body: JSON.stringify({
                        version: definition.config.version,
                        input: {
                            video: requireRemoteAsset(request.baseVideo, "baseVideo"),
                            audio: requireRemoteAsset(request.audio, "audio"),
                            ...(request.alignment ? { alignment: request.alignment } : {}),
                            ...(request.speakerId ? { speaker_id: request.speakerId } : {})
                        }
                    })
                }, options);
                const completed = await pollVideoOperation(
                    () => prediction.urls?.get
                        ? client.request<ReplicatePrediction>(new URL(prediction.urls.get).pathname + new URL(prediction.urls.get).search, {}, options)
                        : Promise.resolve(prediction),
                    value => value.status === "succeeded"
                        ? "completed"
                        : value.status === "failed" || value.status === "canceled" ? "failed" : "pending",
                    options,
                    definition.config.pollIntervalMs,
                    definition.config.maxPollAttempts
                );
                const url = findMediaUrl(completed.output);
                if (!url) throw new Error("Replicate lip-sync prediction returned no video URL.");
                return videoResultFromUrl(url, "video/mp4", { lipSync: "synced", gestureSync: "preserved", expressionSync: "preserved" });
            }
        }
    });
}
