import { describe, expect, it, vi } from "vitest";
import { createHeyGenOneStageModel } from "../../../src/models/video/providers/one-stage/heygen";
import { createReplicateLipSyncModel } from "../../../src/models/video/providers/lip-sync/replicate";
import { createVertexVeoModel } from "../../../src/models/video/providers/ordinary/vertex-veo";
import type { VideoModelCapabilities } from "../../../src/models/video";

const capabilities: VideoModelCapabilities = {
    pipelines: {},
    scene: {
        instruction: false,
        motionInstructions: false,
        backgroundImage: false,
        characterImage: false,
        characterDescription: false,
        characterConsistency: false
    },
    realtime: { supported: false }
};

const oneStageCapabilities = {
    ...capabilities,
    pipelines: { oneStage: { input: { text: true, audio: true, audioTracks: false, voiceId: true, voiceCloneSample: false, alignment: false }, sync: { lipSync: "native", gestureSync: "native", expressionSync: "native" }, multipleSpeakers: false } }
} as VideoModelCapabilities;

const lipSyncCapabilities = {
    input: { video: true, audio: true, alignment: false, multiFace: false },
    sync: { lipSync: "native" },
    preservesBackground: true
};

function response(body: unknown) {
    return { ok: true, status: 200, json: async () => body, text: async () => "" } as Response;
}

const asset = (url: string, mimeType: string) => ({ source: { kind: "url" as const, url }, mimeType });

describe("concrete video providers", () => {
    it("maps HeyGen generation and polls its status endpoint", async () => {
        const requestFetch = vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(response({ data: { video_id: "heygen-1" } }))
            .mockResolvedValueOnce(response({ data: { video_url: "https://cdn.test/heygen.mp4" } }));
        const model = createHeyGenOneStageModel({ config: { provider: "heygen", model: "avatar", apiKey: "key", pollIntervalMs: 0 }, capabilities: oneStageCapabilities as never });
        const result = await model.generate({ pipeline: "one-stage", scene: { characters: [{ id: "avatar-1" }] }, speech: { mode: "text", text: "Hello" }, sync: { lipSync: "required", gestureSync: "required", expressionSync: "required" } });
        expect(result.video.source).toEqual({ kind: "url", url: "https://cdn.test/heygen.mp4" });
        expect(requestFetch).toHaveBeenCalledTimes(2);
        requestFetch.mockRestore();
    });

    it("polls Vertex Veo long-running operations", async () => {
        const requestFetch = vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(response({ name: "operations/1" }))
            .mockResolvedValueOnce(response({ done: true, response: { videos: [{ gcsUri: "gs://bucket/video.mp4" }] } }));
        const model = createVertexVeoModel({ config: { provider: "vertex-veo", model: "veo", projectId: "project", accessToken: "token", pollIntervalMs: 0 }, capabilities });
        const result = await model.generate({ mode: "provider", prompt: "A quiet room" });
        expect(result.video.source).toEqual({ kind: "url", url: "gs://bucket/video.mp4" });
        expect(requestFetch).toHaveBeenCalledTimes(2);
        requestFetch.mockRestore();
    });

    it("keeps Replicate refinement separate from general video generation", async () => {
        const requestFetch = vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(response({ id: "prediction-1", status: "succeeded", output: "https://cdn.test/lipsync.mp4" }));
        const model = createReplicateLipSyncModel({ config: { provider: "replicate", model: "lipsync", version: "version-1", apiKey: "token", pollIntervalMs: 0 }, capabilities: lipSyncCapabilities });
        const result = await model.refine({ mode: "lip-sync-refinement", baseVideo: asset("https://cdn.test/base.mp4", "video/mp4"), audio: asset("https://cdn.test/audio.mp3", "audio/mpeg") });
        expect(result.sync.lipSync).toBe("synced");
        expect("generate" in model).toBe(false);
        requestFetch.mockRestore();
    });
});
