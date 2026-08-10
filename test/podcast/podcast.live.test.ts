import "dotenv/config";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { fal } from "@fal-ai/client";
import type { TextToSpeechOptions } from "../../src/models/text-to-speech/tts.mutual";
import type {
    PodcastAsset,
    PodcastAudioComposer,
    PodcastAvatarRequest,
    PodcastCharacter,
    PodcastFactCheckRequest,
    PodcastFactCheckResult,
    PodcastImageRequest,
    PodcastLipSyncModel,
    PodcastLipSyncRepresentation,
    PodcastModel,
    PodcastSpeechSegment,
    PodcastTextToSpeechRequest,
    PodcastTextToTextRequest,
    PodcastTranscript,
    PodcastWorkflowConfig
} from "../../src/podcast/podcast";
import { PodcastWorkflow } from "../../src/podcast/podcast";

const falKey = process.env.FAL_KEY?.trim() || process.env.FAI_API_KEY?.trim();
const hasFalKey = Boolean(falKey);
const liveDescribe = hasFalKey ? describe : describe.skip;

const textModelId = process.env.FAL_PODCAST_TEXT_MODEL?.trim() || "openrouter/router";
const llmModelId = process.env.FAL_PODCAST_LLM_MODEL?.trim() || "google/gemini-3.1-flash-lite";
const textToSpeechModelId = process.env.FAL_PODCAST_TTS_MODEL?.trim() || "fal-ai/elevenlabs/tts/turbo-v2.5";
const textToImageModelId = process.env.FAL_PODCAST_IMAGE_MODEL?.trim() || "fal-ai/flux/schnell";
const directAvatarModelId = process.env.FAL_PODCAST_AVATAR_MODEL?.trim() || "fal-ai/sadtalker";
const lipSyncModelId = process.env.FAL_PODCAST_LIPSYNC_MODEL?.trim();
const stagedAvatarModelId = process.env.FAL_PODCAST_AVATAR_STAGE2_MODEL?.trim();
const audioComposerModelId = process.env.FAL_PODCAST_AUDIO_COMPOSER_MODEL?.trim();
const liveTimeout = Number(process.env.FAL_PODCAST_LIVE_TIMEOUT_MS) || 180_000;

if (!hasFalKey) {
    console.warn(
        "FAL_KEY (or the legacy FAI_API_KEY alias) is not set or empty in .env. "
        + "Podcast fal.ai live tests will be skipped."
    );
} else {
    fal.config({ credentials: falKey });
}

if (hasFalKey && (!lipSyncModelId || !stagedAvatarModelId)) {
    console.warn(
        "Stage 1/Stage 2 podcast live tests are skipped. Set "
        + "FAL_PODCAST_LIPSYNC_MODEL and FAL_PODCAST_AVATAR_STAGE2_MODEL "
        + "to fal endpoints that implement the motion-representation contract."
    );
}

if (hasFalKey && !audioComposerModelId) {
    console.warn(
        "Audio-composer podcast live test is skipped. Set FAL_PODCAST_AUDIO_COMPOSER_MODEL "
        + "to an endpoint that accepts audio_urls and returns composed audio."
    );
}

const hostVoice = process.env.FAL_PODCAST_HOST_VOICE?.trim() || "Rachel";
const guestVoice = process.env.FAL_PODCAST_GUEST_VOICE?.trim() || "Adam";
const characters: PodcastCharacter[] = [
    { name: "Maya", role: "science host", voice: hostVoice },
    { name: "Noah", role: "skeptical co-host", voice: guestVoice }
];

const requestOptions = (signal?: AbortSignal) => ({
    abortSignal: signal,
    storageSettings: { expiresIn: "1h" as const }
});

type FalRecord = Record<string, unknown>;
type FalModelOptions = { signal?: AbortSignal };

async function runFalEndpoint(
    endpointId: string,
    input: FalRecord,
    signal?: AbortSignal
): Promise<unknown> {
    try {
        const result = await fal.subscribe(endpointId, {
            input,
            ...requestOptions(signal)
        });
        return result.data;
    } catch (error) {
        const status = getField(error, ["status", "statusCode"]);
        const statusText = status === undefined ? "" : ` (${String(status)})`;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`fal endpoint "${endpointId}" failed${statusText}: ${message}`, { cause: error });
    }
}

async function requestFalText(prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await runFalEndpoint(textModelId, {
        model: llmModelId,
        prompt,
        system_prompt: "Return only the requested JSON. Do not use Markdown fences.",
        temperature: 0,
        max_tokens: 700
    }, signal);

    const output = getField(response, ["output", "content"]);
    if (typeof output === "string") {
        return output;
    }
    if (typeof response === "string") {
        return response;
    }
    throw new Error("The configured fal text endpoint did not return a string output.");
}

const falTextToText: PodcastModel<
    PodcastTextToTextRequest,
    PodcastTranscript | string,
    unknown
> = async (request, options) => {
    return await requestFalText(request.prompt, signalFrom(options));
};

const falFactChecker: PodcastModel<
    PodcastFactCheckRequest,
    PodcastFactCheckResult,
    unknown
> = async ({ transcript }, options) => {
    const response = await requestFalText([
        "Fact-check the podcast transcript below.",
        "Return only JSON in this exact shape:",
        "{\"passed\":true,\"issues\":[],\"correctedTranscript\":{\"segments\":[{\"speaker\":\"Maya\",\"text\":\"...\"}]}}",
        "Preserve the configured speaker names exactly.",
        JSON.stringify(transcript)
    ].join("\n\n"), signalFrom(options));

    const parsed = parseJsonObject(response);
    if (!isRecord(parsed) || typeof parsed.passed !== "boolean") {
        throw new Error("The configured fal fact-check endpoint did not return the expected JSON shape.");
    }

    return {
        passed: parsed.passed,
        issues: Array.isArray(parsed.issues)
            ? parsed.issues.filter((issue): issue is string => typeof issue === "string")
            : undefined,
        correctedTranscript: isRecord(parsed.correctedTranscript)
            ? parsed.correctedTranscript as unknown as PodcastTranscript
            : undefined
    };
};

const falTextToSpeech: PodcastModel<
    PodcastTextToSpeechRequest,
    Uint8Array,
    TextToSpeechOptions
> = async (request, options) => {
    const response = await runFalEndpoint(textToSpeechModelId, {
        text: request.text,
        voice: request.character?.voice || options?.voice || hostVoice,
        language_code: "en"
    }, options?.signal);
    const audio = getField(response, ["audio", "audio_url", "file", "output"]);
    if (audio === undefined) {
        throw new Error("The configured fal TTS endpoint did not return audio.");
    }
    return await materializeMedia(audio);
};

const falTextToImage: PodcastModel<PodcastImageRequest, PodcastAsset> = async (
    request,
    options
) => {
    const response = await runFalEndpoint(textToImageModelId, {
        prompt: request.prompt,
        image_size: "portrait_4_3",
        num_images: 1,
        output_format: "jpeg"
    }, signalFrom(options));
    return normalizeImageAsset(response);
};

const falDirectAvatar: PodcastModel<PodcastAvatarRequest, PodcastAsset> = async (
    request,
    options
) => {
    if (request.speech?.length !== 1) {
        throw new Error(
            "The default fal SadTalker adapter supports one direct-avatar speech segment per video. "
            + "Configure a multi-segment avatar endpoint for longer episodes."
        );
    }

    const character = request.characters[0];
    const avatarImage = character?.avatarImage;
    if (!avatarImage) {
        throw new Error("The direct fal avatar adapter needs a resolved avatar image.");
    }

    const sourceImageUrl = await uploadMedia(avatarImage, "image/jpeg");
    const drivenAudioUrl = await uploadMedia(request.speech[0].audio, "audio/mpeg");
    const response = await runFalEndpoint(directAvatarModelId, {
        source_image_url: sourceImageUrl,
        driven_audio_url: drivenAudioUrl,
        preprocess: "full",
        still_mode: true
    }, signalFrom(options));
    return await normalizeVideoAsset(response);
};

const falAudioComposer: PodcastAudioComposer | undefined = audioComposerModelId
    ? async ({ transcript, segments, format }, options) => {
        const audioUrls = await Promise.all(
            segments.map((segment) => uploadMedia(segment.audio, format === "wav" ? "audio/wav" : "audio/mpeg"))
        );
        const response = await runFalEndpoint(audioComposerModelId, {
            audio_urls: audioUrls,
            format,
            transcript
        }, signalFrom(options));
        const audio = getField(response, ["audio", "audio_url", "file", "output"]);
        if (audio === undefined) {
            throw new Error("The configured fal audio-composer endpoint did not return audio.");
        }
        return await materializeMedia(audio);
    }
    : undefined;

const falLipSync: PodcastLipSyncModel | undefined = lipSyncModelId
    ? async (request, options) => {
        const audioUrl = await uploadMedia(request.audio, "audio/mpeg");
        const response = await runFalEndpoint(lipSyncModelId, {
            [process.env.FAL_PODCAST_LIPSYNC_AUDIO_FIELD?.trim() || "audio_url"]: audioUrl,
            [process.env.FAL_PODCAST_LIPSYNC_TEXT_FIELD?.trim() || "text"]: request.text,
            [process.env.FAL_PODCAST_LIPSYNC_CHARACTER_FIELD?.trim() || "character"]: request.character.name
        }, options?.signal);
        return normalizeMotionRepresentation(response);
    }
    : undefined;

function createStagedAvatarAdapter(
    requests: PodcastAvatarRequest[]
): PodcastModel<PodcastAvatarRequest, PodcastAsset> | undefined {
    if (!stagedAvatarModelId) {
        return undefined;
    }

    return async (request, options) => {
        requests.push(request);
        if (!request.lipSync?.length) {
            throw new Error("The Stage 2 adapter requires Stage 1 motion representations.");
        }

        const avatarImages = await Promise.all(
            request.characters.map(async (character) => {
                if (!character.avatarImage) {
                    throw new Error(`Character ${character.name} has no resolved avatar image.`);
                }
                return await uploadMedia(character.avatarImage, "image/jpeg");
            })
        );
        const representations = request.lipSync.length === 1
            ? request.lipSync[0].representation
            : request.lipSync.map(({ speaker, text, startTime, endTime, representation }) => ({
                speaker,
                text,
                startTime,
                endTime,
                representation
            }));
        const imageField = process.env.FAL_PODCAST_STAGE2_IMAGE_FIELD?.trim() || "image_url";
        const motionField = process.env.FAL_PODCAST_STAGE2_MOTION_FIELD?.trim() || "representation";
        const response = await runFalEndpoint(stagedAvatarModelId, {
            [imageField]: avatarImages.length === 1 ? avatarImages[0] : avatarImages,
            [motionField]: representations,
            transcript: request.transcript,
            characters: request.characters.map(({ name, role }) => ({ name, role }))
        }, signalFrom(options));
        return await normalizeVideoAsset(response);
    };
}

liveDescribe("fal.ai podcast live integration", () => {
    it("generates and fact-checks a transcript for configured characters", async () => {
        const workflow = new PodcastWorkflow({
            models: {
                textToText: falTextToText,
                textToSpeech: falTextToSpeech
            },
            transcript: { factChecker: falFactChecker, targetDurationSeconds: 20 },
            characters,
            output: { format: "mp3" }
        });

        const transcript = await workflow.generateTranscript({
            subject: "how a microphone turns sound into a digital signal",
            description: "A short educational exchange between a science host and a skeptical co-host.",
            instruction: "Return exactly two short segments: one by Maya and one by Noah. Keep the claims easy to verify."
        });

        expect(transcript.segments).toHaveLength(2);
        expect(transcript.segments.map(({ speaker }) => speaker)).toStrictEqual(["Maya", "Noah"]);
        expect(transcript.segments.every(({ text }) => text.length > 0)).toBe(true);
    }, liveTimeout);

    it("synthesizes ordered multi-character speech with the configured voices", async () => {
        const workflow = new PodcastWorkflow({
            models: { textToSpeech: falTextToSpeech },
            characters,
            output: { format: "mp3" }
        });
        const transcript: PodcastTranscript = {
            segments: [
                { speaker: "Maya", text: "A microphone converts pressure changes into an electrical signal." },
                { speaker: "Noah", text: "And the converter then represents that signal as digital samples." }
            ]
        };

        const result = await workflow.generatePodcast({ transcript, factChecking: false });

        expect(result.speech.map(({ speaker }) => speaker)).toStrictEqual(["Maya", "Noah"]);
        expect(result.speech.every(({ audio }) => audio instanceof Uint8Array && audio.byteLength > 0)).toBe(true);
        expect(result.output.segments?.map(({ speaker }) => speaker)).toStrictEqual(["Maya", "Noah"]);
        expect(result.output.asset).toBeUndefined();
    }, liveTimeout);

    it("saves a single generated audio asset to disk", async () => {
        const directory = await mkdtemp(join(tmpdir(), "raven-fal-podcast-"));
        try {
            const workflow = new PodcastWorkflow({
                models: { textToSpeech: falTextToSpeech },
                characters: [characters[0]],
                output: { format: "mp3" }
            });
            const result = await workflow.generatePodcast({
                transcript: {
                    segments: [{ speaker: "Maya", text: "This episode is persisted from a live fal audio asset." }]
                },
                factChecking: false
            });
            const filePath = join(directory, "episode.mp3");

            expect(result.output.asset).toBeDefined();
            await result.output.asset!.save(filePath);
            const savedFile = await stat(filePath);
            expect(savedFile.size).toBeGreaterThan(0);
            expect((await readFile(filePath)).byteLength).toBe(savedFile.size);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }, liveTimeout);

    it("generates an avatar image, renders direct avatar video, and saves it", async () => {
        const directory = await mkdtemp(join(tmpdir(), "raven-fal-avatar-"));
        try {
            const workflow = new PodcastWorkflow({
                models: {
                    textToSpeech: falTextToSpeech,
                    textToImage: falTextToImage,
                    avatarVideos: falDirectAvatar
                },
                characters: [{ ...characters[0], avatarImage: undefined }],
                output: { format: "mp4" }
            });
            const result = await workflow.generatePodcast({
                transcript: {
                    segments: [{ speaker: "Maya", text: "This is a direct audio-driven avatar test." }]
                },
                factChecking: false
            });
            const filePath = join(directory, "avatar.mp4");

            expect(result.output.asset).toBeDefined();
            expect(result.output.contentType).toBe("video/mp4");
            await result.output.asset!.save(filePath);
            expect((await stat(filePath)).size).toBeGreaterThan(0);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }, liveTimeout);

    const stagedDescribe = lipSyncModelId && stagedAvatarModelId ? describe : describe.skip;
    stagedDescribe("configured two-stage motion representation pipeline", () => {
        it("passes Stage 1 motion to Stage 2 without passing speech audio", async () => {
            const stagedRequests: PodcastAvatarRequest[] = [];
            const workflow = new PodcastWorkflow({
                models: {
                    textToSpeech: falTextToSpeech,
                    textToImage: falTextToImage,
                    lipSync: falLipSync,
                    avatarVideos: createStagedAvatarAdapter(stagedRequests)
                },
                characters: [{ ...characters[0], avatarImage: undefined }],
                output: { format: "mp4" }
            });

            const result = await workflow.generatePodcast({
                transcript: {
                    segments: [{ speaker: "Maya", text: "This segment becomes facial motion data before rendering." }]
                },
                factChecking: false
            });

            expect(result.lipSync).toHaveLength(1);
            expect(result.lipSync?.[0].representation).toBeDefined();
            expect(stagedRequests).toHaveLength(1);
            expect(stagedRequests[0].speech).toBeUndefined();
            expect(stagedRequests[0].lipSync?.[0].representation).toEqual(result.lipSync?.[0].representation);
            expect(result.output.asset).toBeDefined();
        }, liveTimeout);
    });

    const composerDescribe = audioComposerModelId ? describe : describe.skip;
    composerDescribe("configured audio composition pipeline", () => {
        it("composes ordered multi-character speech through fal", async () => {
            const workflowConfig: PodcastWorkflowConfig = {
                models: { textToSpeech: falTextToSpeech },
                characters,
                output: {
                    format: "mp3",
                    composeAudio: falAudioComposer
                }
            };
            const workflow = new PodcastWorkflow(workflowConfig);
            const result = await workflow.generatePodcast({
                transcript: {
                    segments: [
                        { speaker: "Maya", text: "The first audio segment is generated live." },
                        { speaker: "Noah", text: "The second segment is composed after synthesis." }
                    ]
                },
                factChecking: false
            });

            expect(result.output.asset).toBeDefined();
            expect(result.output.contentType).toBe("audio/mpeg");
            const savedBytes = await materializeMedia(result.output.asset!.media);
            expect(savedBytes.byteLength).toBeGreaterThan(0);
        }, liveTimeout);
    });
});

function getField(value: unknown, names: string[]): unknown {
    if (!isRecord(value)) {
        return undefined;
    }
    for (const name of names) {
        if (value[name] !== undefined) {
            return value[name];
        }
    }
    return undefined;
}

function signalFrom(value: unknown): AbortSignal | undefined {
    const signal = getField(value, ["signal"]);
    return typeof AbortSignal !== "undefined" && signal instanceof AbortSignal
        ? signal
        : undefined;
}

function isRecord(value: unknown): value is FalRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: string): unknown {
    const normalized = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
        return JSON.parse(normalized);
    } catch {
        const objectMatch = normalized.match(/\{[\s\S]*\}/);
        if (!objectMatch) {
            throw new Error("The fal text endpoint did not return JSON.");
        }
        return JSON.parse(objectMatch[0]);
    }
}

function normalizeImageAsset(value: unknown): PodcastAsset {
    const images = getField(value, ["images"]);
    const candidate = Array.isArray(images) && images.length > 0
        ? images[0]
        : getField(value, ["image", "image_url", "url"]);
    const asset = normalizeUrlOrBinary(candidate);
    if (asset === undefined) {
        throw new Error("The fal image endpoint did not return an image URL or binary image.");
    }
    return asset;
}

async function normalizeVideoAsset(value: unknown): Promise<PodcastAsset> {
    const candidate = getField(value, ["video", "video_url", "file", "output"]);
    if (candidate === undefined) {
        throw new Error("The fal video endpoint did not return a video asset.");
    }
    const asset = normalizeUrlOrBinary(candidate);
    if (asset !== undefined) {
        return asset;
    }
    return await materializeMedia(candidate);
}

function normalizeMotionRepresentation(value: unknown): PodcastLipSyncRepresentation {
    if (isRecord(value)) {
        if (value.video !== undefined || value.video_url !== undefined || value.videos !== undefined) {
            throw new Error(
                "The configured Stage 1 fal endpoint returned final video. "
                + "Configure an endpoint that returns motion representation data instead."
            );
        }
        const representation = getField(value, ["representation", "motion", "blendshapes", "landmarks", "coefficients"]);
        if (representation !== undefined) {
            return representation as PodcastLipSyncRepresentation;
        }
        return value;
    }
    if (Array.isArray(value) || typeof value === "string" || value instanceof Uint8Array) {
        return value as PodcastLipSyncRepresentation;
    }
    throw new Error("The configured Stage 1 fal endpoint did not return a motion representation.");
}

function normalizeUrlOrBinary(value: unknown): PodcastAsset | undefined {
    if (typeof value === "string" || value instanceof Uint8Array) {
        return value;
    }
    if (isBlob(value)) {
        return undefined;
    }
    if (isRecord(value)) {
        if (typeof value.url === "string") {
            return value.url;
        }
        if (typeof value.file_data === "string") {
            return value.file_data;
        }
    }
    return undefined;
}

async function uploadMedia(media: unknown, contentType: string): Promise<string> {
    if (typeof media === "string" && /^(https?:|data:)/.test(media)) {
        return media;
    }
    const bytes = await materializeMedia(media);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return await fal.storage.upload(new Blob([buffer], { type: contentType }), {
        lifecycle: { expiresIn: "1h" }
    });
}

async function materializeMedia(media: unknown): Promise<Uint8Array> {
    if (media instanceof Uint8Array) {
        return media;
    }
    if (isBlob(media)) {
        return new Uint8Array(await media.arrayBuffer());
    }
    if (typeof media === "string") {
        if (/^(https?:|data:)/.test(media)) {
            const response = await fetch(media);
            if (!response.ok) {
                throw new Error(`Unable to download fal media: ${response.status}`);
            }
            return new Uint8Array(await response.arrayBuffer());
        }
        return new Uint8Array(await readFile(media));
    }
    if (Array.isArray(media)) {
        return combineBinaryChunks(await Promise.all(media.map((chunk) => materializeMedia(chunk))));
    }
    if (isAsyncIterable(media)) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of media) {
            chunks.push(await materializeMedia(chunk));
        }
        return combineBinaryChunks(chunks);
    }
    if (isReadableStream(media)) {
        const reader = media.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
            const next = await reader.read();
            if (next.done) {
                break;
            }
            chunks.push(await materializeMedia(next.value));
        }
        return combineBinaryChunks(chunks);
    }
    if (isRecord(media) && media.url !== undefined) {
        return await materializeMedia(media.url);
    }
    throw new Error("The fal adapter received unsupported media output.");
}

function isBlob(value: unknown): value is Blob {
    return typeof Blob !== "undefined" && value instanceof Blob;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return typeof value === "object"
        && value !== null
        && Symbol.asyncIterator in value
        && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> {
    return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

function combineBinaryChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return combined;
}
