import { describe, expect, it } from "vitest";
import { createVismeOneStageModel } from "../../src/models/video/providers/one-stage/visme";
import { createTwoStageVideoModel } from "../../src/models/video/providers/two-stage/provider";
import { createLatentSyncModel } from "../../src/models/video/providers/lip-sync/latentsync";
import { Audio, LipSync, Providers } from "../../src/models/video";
import type {
    LatentSyncDefinition
} from "../../src/models/video/providers/lip-sync/latentsync";
import type {
    OneStagePipeline,
    OneStageVideoProviderCapabilities,
    TwoStagePipeline,
    TwoStageVideoProviderCapabilities,
    VideoAsset,
    VideoGenerationOptions,
    VideoGenerationResult,
    VideoLipSyncCapabilities
} from "../../src/models/video";

const output: VideoGenerationResult = {
    video: {
        source: { kind: "url", url: "https://example.test/video.webm" },
        mimeType: "video/webm"
    },
    sync: {
        lipSync: "synced",
        gestureSync: "synced",
        expressionSync: "synced"
    }
};

function asset(url: string, mimeType: string): VideoAsset {
    return { source: { kind: "url", url }, mimeType };
}

const scene = {
    characters: [{ id: "agent" }]
};

const oneStageCapabilities: OneStageVideoProviderCapabilities = {
    pipelines: {
        oneStage: {
            input: {
                text: true,
                audio: true,
                audioTracks: false,
                voiceId: true,
                voiceCloneSample: true,
                alignment: true
            },
            sync: {
                lipSync: "native",
                gestureSync: "native",
                expressionSync: "native"
            },
            multipleSpeakers: true
        }
    },
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

const twoStageCapabilities: TwoStageVideoProviderCapabilities = {
    pipelines: {
        twoStage: {
            input: {
                text: false,
                audio: true,
                audioTracks: true,
                voiceId: false,
                voiceCloneSample: false,
                alignment: true
            },
            sync: {
                lipSync: "native",
                gestureSync: "native",
                expressionSync: "native"
            },
            multipleSpeakers: true
        }
    },
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

const lipSyncCapabilities: VideoLipSyncCapabilities = {
    input: {
        video: true,
        audio: true,
        alignment: true,
        multiFace: false
    },
    sync: { lipSync: "native" },
    preservesBackground: true
};

const oneStageRequest: OneStagePipeline = {
    pipeline: "one-stage",
    scene,
    speech: {
        mode: "audio",
        audio: asset("https://example.test/audio.mp3", "audio/mpeg")
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    }
};

const twoStageRequest: TwoStagePipeline = {
    pipeline: "two-stage",
    scene,
    speech: {
        mode: "audio",
        audio: {
            tracks: [{
                speakerId: "agent",
                audio: asset("https://example.test/audio.mp3", "audio/mpeg")
            }]
        }
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    }
};

describe("video provider schemas", () => {
    it("creates a Visme one-stage model with a narrowed transport", async () => {
        let received: OneStagePipeline | undefined;
        let receivedOptions: VideoGenerationOptions | undefined;
        const model = createVismeOneStageModel({
            config: { provider: "visme", model: "avatar-model" },
            capabilities: oneStageCapabilities,
            transport: {
                generate: async (request, options) => {
                    received = request;
                    receivedOptions = options;
                    return output;
                }
            }
        });

        const options = { signal: new AbortController().signal, timeoutMs: 5000 };
        await expect(model.generate(oneStageRequest, options)).resolves.toBe(output);
        expect(received).toBe(oneStageRequest);
        expect(receivedOptions).toBe(options);
        expect(receivedOptions?.signal).toBe(options.signal);
        await expect(model.generate(twoStageRequest)).rejects.toThrow("non-one-stage");
    });

    it("creates a native two-stage model with a narrowed transport", async () => {
        let received: TwoStagePipeline | undefined;
        const model = createTwoStageVideoModel({
            config: { provider: "native-provider", model: "dialogue-model" },
            capabilities: twoStageCapabilities,
            transport: {
                generate: async request => {
                    received = request;
                    return output;
                }
            }
        });

        await expect(model.generate(twoStageRequest)).resolves.toBe(output);
        expect(received).toBe(twoStageRequest);
        await expect(model.generate(oneStageRequest)).rejects.toThrow("non-two-stage");
    });

    it("keeps LatentSync as a lip-sync model instead of a video generator", async () => {
        let received: LatentSyncDefinition["transport"] extends { refine: (request: infer Request, ...args: any[]) => any }
            ? Request
            : never;
        let receivedOptions: VideoGenerationOptions | undefined;
        const model = createLatentSyncModel({
            config: { provider: "latentsync", model: "refiner-model" },
            capabilities: lipSyncCapabilities,
            transport: {
                refine: async (request, options) => {
                    received = request;
                    receivedOptions = options;
                    return output;
                }
            }
        });

        const options = { signal: new AbortController().signal, idempotencyKey: "video-1" };
        await expect(model.refine({
            mode: "lip-sync-refinement",
            baseVideo: asset("https://example.test/base.mp4", "video/mp4"),
            audio: asset("https://example.test/audio.mp3", "audio/mpeg")
        }, options)).resolves.toBe(output);
        expect(received.mode).toBe("lip-sync-refinement");
        expect(receivedOptions).toBe(options);
        expect(receivedOptions?.signal).toBe(options.signal);
        expect(model.capabilities).toBe(lipSyncCapabilities);
        expect("generate" in model).toBe(false);
    });

    it("exposes the shared video namespaces and provider aggregate", () => {
        expect(Audio).toBeDefined();
        expect(LipSync).toBeDefined();
        expect(Providers.createVismeOneStageModel).toBe(createVismeOneStageModel);
        expect(Providers.createTwoStageVideoModel).toBe(createTwoStageVideoModel);
        expect(Providers.createLatentSyncModel).toBe(createLatentSyncModel);
    });
});
