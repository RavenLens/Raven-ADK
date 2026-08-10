import type { OneStagePipeline } from "../../schemas/stages/one-stage.schema";
import type { VideoGenerationOptions, VideoGenerationResult } from "../../video.mutual";
import { createVideoHttpClient, findMediaUrl, pollVideoOperation, requireRemoteAsset, videoResultFromUrl } from "../http.util";
import { createOneStageVideoModel, type OneStageVideoProviderCapabilities } from "./provider.util";

export interface HeyGenOneStageConfig {
    provider: "heygen";
    model: string;
    apiKey: string;
    baseURL?: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
    [key: string]: unknown;
}

export interface HeyGenOneStageDefinition {
    config: HeyGenOneStageConfig;
    capabilities: OneStageVideoProviderCapabilities;
}

interface HeyGenVideoResponse {
    data?: { video_id?: string; video_url?: string; status?: string; error?: string };
}

export function createHeyGenOneStageModel(definition: HeyGenOneStageDefinition) {
    const client = createVideoHttpClient({
        baseURL: definition.config.baseURL ?? "https://api.heygen.com",
        headers: { "X-Api-Key": definition.config.apiKey }
    });
    return createOneStageVideoModel({
        config: definition.config,
        capabilities: definition.capabilities,
        transport: {
            generate: async (request: OneStagePipeline, options?: VideoGenerationOptions): Promise<VideoGenerationResult> => {
                const character = request.scene.characters[0];
                if (!character?.id) throw new Error("HeyGen requires the first scene character id to be an avatar id.");
                if (request.speech.mode === "dialogue") throw new Error("HeyGen adapter currently accepts text or audio speech, not dialogue arrays.");
                const voice = request.speech.mode === "text"
                    ? { type: "text", input_text: request.speech.text, voice_id: request.speech.voice?.kind === "voice-id" ? request.speech.voice.voiceId : undefined }
                    : { type: "audio", audio_url: requireRemoteAsset(request.speech.audio, "speech.audio") };
                const started = await client.request<HeyGenVideoResponse>("/v2/video/generate", {
                    method: "POST",
                    body: JSON.stringify({
                        video_inputs: [{ character: { type: "avatar", avatar_id: character.id }, voice }],
                        dimension: request.output?.width && request.output.height ? { width: request.output.width, height: request.output.height } : undefined
                    })
                }, options);
                const videoId = started.data?.video_id;
                if (!videoId) throw new Error("HeyGen returned no video id.");
                const completed = await pollVideoOperation(
                    () => client.request<HeyGenVideoResponse>(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {}, options),
                    value => value.data?.video_url ? "completed" : value.data?.status === "failed" ? "failed" : "pending",
                    options,
                    definition.config.pollIntervalMs,
                    definition.config.maxPollAttempts
                );
                const url = findMediaUrl(completed.data?.video_url);
                if (!url) throw new Error("HeyGen returned no video URL.");
                return videoResultFromUrl(url, "video/mp4", { lipSync: "synced", gestureSync: "synced", expressionSync: "synced" });
            }
        }
    });
}
