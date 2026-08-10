import type { VideoModel, VideoModelCapabilities, ProviderVideoGenerationRequest } from "../../video.mutual";
import { createVideoProviderModel } from "../../schemas/video-provider.schema";
import { createVideoHttpClient, findMediaUrl, pollVideoOperation, videoResultFromUrl } from "../http.util";

export interface VertexVeoConfig {
    provider: "vertex-veo";
    model: string;
    projectId: string;
    location?: string;
    accessToken: string;
    baseURL?: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
    [key: string]: unknown;
}

export interface VertexVeoDefinition {
    config: VertexVeoConfig;
    capabilities: VideoModelCapabilities;
}

interface VertexOperation {
    name: string;
    done?: boolean;
    error?: { message?: string };
    response?: unknown;
}

export function createVertexVeoModel(definition: VertexVeoDefinition): VideoModel {
    const location = definition.config.location ?? "us-central1";
    const client = createVideoHttpClient({
        baseURL: definition.config.baseURL ?? `https://${location}-aiplatform.googleapis.com`,
        headers: { Authorization: `Bearer ${definition.config.accessToken}` }
    });

    return createVideoProviderModel({
        apiName: "vertex-veo",
        config: definition.config,
        capabilities: definition.capabilities,
        transport: {
            generate: async (request, options) => {
                if (!("mode" in request) || request.mode !== "provider") {
                    throw new Error("Vertex Veo requires a provider-native video request.");
                }
                const providerRequest = request as ProviderVideoGenerationRequest;
                const operation = await client.request<VertexOperation>(
                    `/v1/projects/${encodeURIComponent(definition.config.projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(definition.config.model)}:predictLongRunning`,
                    {
                        method: "POST",
                        body: JSON.stringify({ instances: [{ prompt: providerRequest.prompt }], parameters: providerRequest.providerOptions ?? {} })
                    },
                    options
                );
                const completed = await pollVideoOperation(
                    () => client.request<VertexOperation>(`/v1/${operation.name}`, {}, options),
                    value => value.error ? "failed" : value.done ? "completed" : "pending",
                    options,
                    definition.config.pollIntervalMs,
                    definition.config.maxPollAttempts
                );
                const url = findMediaUrl(completed.response);
                if (!url) throw new Error("Vertex Veo returned no video URI.");
                return videoResultFromUrl(url, "video/mp4", { lipSync: "not-requested", gestureSync: "unknown", expressionSync: "unknown" });
            }
        }
    });
}
