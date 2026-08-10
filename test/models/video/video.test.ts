import { describe, expect, it } from "vitest";
import {
    assertRealtimeVideoCompatibility,
    getVideoCompatibilityIssues,
    supportsVideoRequest,
    type OneStagePipeline,
    type ProviderVideoGenerationRequest,
    type TwoStagePipeline,
    type VideoAsset,
    type VideoGenerationResult,
    type VideoLipSyncModel,
    type VideoModel
} from "../../../src/models/video";

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

const oneStageModel: VideoModel = {
    typeAPI: "model",
    apiName: { custom: "one-stage-test" },
    config: { model: "one-stage-test" },
    capabilities: {
        pipelines: {
            oneStage: {
                input: {
                    text: true,
                    audio: false,
                    audioTracks: false,
                    voiceId: true,
                    voiceCloneSample: false,
                    alignment: false
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
            instruction: true,
            motionInstructions: true,
            backgroundImage: true,
            characterImage: true,
            characterDescription: true,
            characterConsistency: true
        },
        realtime: {
            supported: true,
            streaming: true,
            pipelines: ["one-stage"],
            input: "text",
            output: "video-chunks"
        }
    },
    generate: async () => output,
    generateRealtime: async function* () {
        yield { type: "completed", result: output };
    }
};

const twoStageModel: VideoModel = {
    typeAPI: "model",
    apiName: { custom: "two-stage-test" },
    config: { model: "two-stage-test" },
    capabilities: {
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
            instruction: true,
            motionInstructions: true,
            backgroundImage: true,
            characterImage: true,
            characterDescription: true,
            characterConsistency: true,
            maxCharacters: 2
        },
        realtime: { supported: false }
    },
    generate: async () => output
};

const providerModel: VideoModel = {
    typeAPI: "model",
    apiName: { custom: "provider-video-test" },
    config: { model: "provider-video-test" },
    capabilities: {
        pipelines: {},
        provider: {
            input: {
                prompt: true,
                referenceImages: true,
                referenceVideo: false,
                audio: false,
                providerOptions: true
            },
            output: {
                audio: false,
                formats: ["mp4"]
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
    },
    generate: async () => output
};

const oneStageRequest: OneStagePipeline = {
    pipeline: "one-stage",
    scene: {
        characters: [{ id: "agent", consistencyId: "agent-v1" }]
    },
    speech: {
        mode: "text",
        text: "Hello from the realtime agent.",
        voice: { kind: "voice-id", voiceId: "agent-voice" }
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    }
};

const audioOneStageModel: VideoModel = {
    ...oneStageModel,
    capabilities: {
        ...oneStageModel.capabilities,
        pipelines: {
            oneStage: {
                ...oneStageModel.capabilities.pipelines.oneStage!,
                input: {
                    ...oneStageModel.capabilities.pipelines.oneStage!.input,
                    audio: true,
                    alignment: true
                }
            }
        }
    }
};

const audioOneStageRequest: OneStagePipeline = {
    pipeline: "one-stage",
    scene: {
        characters: [{ id: "agent" }]
    },
    speech: {
        mode: "audio",
        audio: asset("https://example.test/agent.mp3", "audio/mpeg"),
        transcript: "Hello from an audio-driven avatar.",
        alignment: {
            words: [{ text: "Hello", startMs: 0, endMs: 300 }]
        }
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    }
};

const twoStageRequest: TwoStagePipeline = {
    pipeline: "two-stage",
    scene: {
        characters: [{ id: "host" }, { id: "expert" }]
    },
    speech: {
        mode: "audio",
        audio: {
            tracks: [
                { speakerId: "host", audio: asset("https://example.test/host.mp3", "audio/mpeg") },
                { speakerId: "expert", audio: asset("https://example.test/expert.mp3", "audio/mpeg") }
            ]
        }
    },
    sync: {
        lipSync: "required",
        gestureSync: "required",
        expressionSync: "required"
    }
};

const lipSyncModel: VideoLipSyncModel = {
    typeAPI: "model",
    apiName: { custom: "lip-sync-test" },
    capabilities: {
        input: {
            video: true,
            audio: true,
            alignment: true,
            multiFace: true
        },
        sync: { lipSync: "native" },
        preservesBackground: true
    },
    refine: async () => output
};

const cascadedTwoStageModel: VideoModel = {
    ...twoStageModel,
    capabilities: {
        ...twoStageModel.capabilities,
        pipelines: {
            twoStage: {
                ...twoStageModel.capabilities.pipelines.twoStage!,
                sync: {
                    lipSync: "unsupported",
                    gestureSync: "unsupported",
                    expressionSync: "unsupported"
                }
            }
        }
    }
};

const cascadedTwoStageRequest: TwoStagePipeline = {
    ...twoStageRequest,
    sync: {
        ...twoStageRequest.sync,
        gestureSync: "preferred",
        expressionSync: "preferred"
    },
    lipSync: {
        mode: "refinement",
        model: lipSyncModel,
        preserveBackground: true
    }
};

const providerRequest: ProviderVideoGenerationRequest = {
    mode: "provider",
    prompt: "A quiet mountain landscape at sunrise.",
    referenceImages: [asset("https://example.test/mountain.png", "image/png")],
    output: {
        format: "mp4",
        includeAudio: false
    },
    providerOptions: {
        durationSeconds: 8
    }
};

describe("video model compatibility", () => {
    it("accepts a native one-stage request", () => {
        expect(supportsVideoRequest(oneStageModel, oneStageRequest, { target: "realtime-agent" })).toBe(true);
    });

    it("accepts an audio-driven one-stage request when audio and alignment are advertised", () => {
        expect(supportsVideoRequest(audioOneStageModel, audioOneStageRequest)).toBe(true);
    });

    it("requires audio-capable realtime input for an audio-driven one-stage request", () => {
        expect(() => assertRealtimeVideoCompatibility(audioOneStageModel, {
            ...audioOneStageRequest,
            realtime: true
        })).toThrow(/realtime-input-unsupported/);
    });

    it("accepts a native two-stage podcast request", () => {
        expect(supportsVideoRequest(twoStageModel, twoStageRequest, { target: "podcast" })).toBe(true);
    });

    it("accepts a two-stage request when native lip sync is supplied by a refiner", () => {
        expect(supportsVideoRequest(cascadedTwoStageModel, cascadedTwoStageRequest, { target: "podcast" })).toBe(true);
    });

    it("accepts provider-native generation without applying sync requirements", () => {
        expect(supportsVideoRequest(providerModel, providerRequest)).toBe(true);
    });

    it("rejects provider-native generation for synchronized branch targets", () => {
        expect(supportsVideoRequest(providerModel, providerRequest, { target: "realtime-agent" })).toBe(false);
        expect(supportsVideoRequest(providerModel, providerRequest, { target: "podcast" })).toBe(false);
    });

    it("does not let best-effort synchronization satisfy a required feature", () => {
        const model: VideoModel = {
            ...oneStageModel,
            capabilities: {
                ...oneStageModel.capabilities,
                pipelines: {
                    oneStage: {
                        ...oneStageModel.capabilities.pipelines.oneStage!,
                        sync: {
                            lipSync: "best-effort",
                            gestureSync: "native",
                            expressionSync: "native"
                        }
                    }
                }
            }
        };

        const issues = getVideoCompatibilityIssues(model, oneStageRequest);
        expect(issues.some(issue => issue.code === "lip-sync-unsupported" && issue.severity === "error")).toBe(true);
    });

    it("requires a realtime generation method and streaming capability", () => {
        const model: VideoModel = {
            ...oneStageModel,
            generateRealtime: undefined,
            capabilities: {
                ...oneStageModel.capabilities,
                realtime: {
                    supported: true,
                    streaming: false,
                    pipelines: ["one-stage"],
                    input: "text",
                    output: "video-chunks"
                }
            }
        };

        expect(() => assertRealtimeVideoCompatibility(model, { ...oneStageRequest, realtime: true })).toThrow(/generateRealtime/);
    });
});