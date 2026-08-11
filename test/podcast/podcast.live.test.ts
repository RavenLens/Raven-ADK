import "dotenv/config";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
    PodcastGenerationResult,
    PodcastImageRequest,
    PodcastLipSyncModel,
    PodcastLipSyncRepresentation,
    PodcastModel,
    PodcastTextToSpeechRequest,
    PodcastTextToTextRequest,
    PodcastTranscript,
    PodcastWorkflowConfig
} from "../../src/podcast/podcast";
import { PodcastWorkflow } from "../../src/podcast/podcast";

const falKey = process.env.FAL_KEY?.trim() || process.env.FAI_API_KEY?.trim();
const hasFalKey = Boolean(falKey);
const liveDescribe = hasFalKey ? describe : describe.skip;

const textModelId = process.env.FAL_PODCAST_TEXT_MODEL?.trim() || "fal-ai/bytedance/seed/v2/mini";
const llmModelId = process.env.FAL_PODCAST_LLM_MODEL?.trim() || "google/gemini-2.5-flash-lite";
const textToSpeechModelId = process.env.FAL_PODCAST_TTS_MODEL?.trim() || "fal-ai/inworld-tts";
const textToImageModelId = process.env.FAL_PODCAST_IMAGE_MODEL?.trim() || "fal-ai/flux/schnell";
const directAvatarModelId = process.env.FAL_PODCAST_AVATAR_MODEL?.trim() || "fal-ai/sadtalker";
const lipSyncModelId = process.env.FAL_PODCAST_LIPSYNC_MODEL?.trim();
const stagedAvatarModelId = process.env.FAL_PODCAST_AVATAR_STAGE2_MODEL?.trim();
const audioComposerModelId = process.env.FAL_PODCAST_AUDIO_COMPOSER_MODEL?.trim();
const liveTimeout = Number(process.env.FAL_PODCAST_LIVE_TIMEOUT_MS) || 180_000;
const falRequestTimeout = positiveDuration(
    process.env.FAL_PODCAST_REQUEST_TIMEOUT_MS,
    165_000
);
const avatarRequestTimeout = positiveDuration(
    process.env.FAL_PODCAST_AVATAR_REQUEST_TIMEOUT_MS,
    300_000
);
const avatarTestTimeout = positiveDuration(
    process.env.FAL_PODCAST_AVATAR_TEST_TIMEOUT_MS,
    Math.max(liveTimeout, avatarRequestTimeout + 15_000)
);
const artifactRoot = resolve(
    process.env.FAL_PODCAST_OUTPUT_DIR?.trim() || join("test", "podcast", "artifacts")
);
const ffmpegCommand = process.env.FAL_PODCAST_FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobeCommand = process.env.FAL_PODCAST_FFPROBE_PATH?.trim() || "ffprobe";
const artifactRunId = safeArtifactName(
    process.env.FAL_PODCAST_OUTPUT_RUN_ID?.trim()
        || `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`
);
const artifactDirectory = join(artifactRoot, artifactRunId);
let artifactDirectoryReady: Promise<void> | undefined;
let artifactSequence = 0;
let lastDirectAvatarProviderPath: string | undefined;
const execFileAsync = promisify(execFile);

function getLastDirectAvatarProviderPath(): string | undefined {
    return lastDirectAvatarProviderPath;
}

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

const hostVoice = process.env.FAL_PODCAST_HOST_VOICE?.trim() || "Sarah (en)";
const guestVoice = process.env.FAL_PODCAST_GUEST_VOICE?.trim() || "Ethan (en)";
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

async function ensureArtifactDirectory(): Promise<void> {
    artifactDirectoryReady ??= (async () => {
        await mkdir(artifactDirectory, { recursive: true });
        await writeFile(
            join(artifactDirectory, "manifest.json"),
            `${JSON.stringify({
                generatedAt: new Date().toISOString(),
                models: {
                    text: textModelId,
                    llm: textModelId.startsWith("openrouter/") ? llmModelId : undefined,
                    textToSpeech: textToSpeechModelId,
                    textToImage: textToImageModelId,
                    directAvatar: directAvatarModelId,
                    lipSync: lipSyncModelId,
                    stagedAvatar: stagedAvatarModelId,
                    audioComposer: audioComposerModelId,
                    ffmpeg: ffmpegCommand,
                    ffprobe: ffprobeCommand
                },
                characters,
                outputDirectory: artifactDirectory
            }, artifactJsonReplacer, 2)}\n`,
            "utf8"
        );
        console.info(`[fal.ai podcast] Generated artifacts: ${artifactDirectory}`);
    })();
    await artifactDirectoryReady;
}

function nextArtifactName(kind: string, label: string): string {
    artifactSequence += 1;
    return `${kind}-${String(artifactSequence).padStart(3, "0")}-${safeArtifactName(label)}`;
}

async function saveArtifactText(fileName: string, content: string): Promise<void> {
    await ensureArtifactDirectory();
    await writeFile(join(artifactDirectory, fileName), content, "utf8");
}

async function saveArtifactJson(fileName: string, value: unknown): Promise<void> {
    await saveArtifactText(
        fileName,
        `${JSON.stringify(value, artifactJsonReplacer, 2) ?? "null"}\n`
    );
}

async function saveArtifactBytes(fileName: string, bytes: Uint8Array): Promise<Uint8Array> {
    await ensureArtifactDirectory();
    await writeFile(join(artifactDirectory, fileName), bytes);
    return bytes;
}

async function saveArtifactMedia(fileName: string, media: unknown): Promise<Uint8Array> {
    return await saveArtifactBytes(fileName, await materializeMedia(media));
}

async function artifactFile(fileName: string): Promise<string> {
    await ensureArtifactDirectory();
    return join(artifactDirectory, fileName);
}

interface MediaInspection {
    audio: boolean;
    video: boolean;
    audioSampleRate?: number;
    audioChannels?: number;
    audioDefault?: boolean;
}

async function inspectMedia(filePath: string): Promise<MediaInspection> {
    const output = await runMediaTool(ffprobeCommand, [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,sample_rate,channels:stream_disposition=default",
        "-of",
        "json",
        filePath
    ]);
    const parsed = JSON.parse(output) as {
        streams?: Array<{
            codec_type?: unknown;
            sample_rate?: unknown;
            channels?: unknown;
            disposition?: { default?: unknown };
        }>;
    };
    const streamTypes = parsed.streams?.map(({ codec_type }) => codec_type) ?? [];
    const audioStream = parsed.streams?.find(({ codec_type }) => codec_type === "audio");
    return {
        audio: streamTypes.includes("audio"),
        video: streamTypes.includes("video"),
        audioSampleRate: audioStream && Number(audioStream.sample_rate),
        audioChannels: audioStream && Number(audioStream.channels),
        audioDefault: audioStream?.disposition?.default === 1
    };
}

async function expectMediaStreams(
    filePath: string,
    expected: Partial<MediaInspection>
): Promise<void> {
    const streams = await inspectMedia(filePath);
    if (expected.audio !== undefined) {
        expect(streams.audio).toBe(expected.audio);
    }
    if (expected.video !== undefined) {
        expect(streams.video).toBe(expected.video);
    }
    if (expected.audioSampleRate !== undefined) {
        expect(streams.audioSampleRate).toBe(expected.audioSampleRate);
    }
    if (expected.audioChannels !== undefined) {
        expect(streams.audioChannels).toBe(expected.audioChannels);
    }
    if (expected.audioDefault !== undefined) {
        expect(streams.audioDefault).toBe(expected.audioDefault);
    }
}

async function runMediaTool(command: string, argumentsList: string[]): Promise<string> {
    try {
        const result = await execFileAsync(command, argumentsList, { windowsHide: true });
        return result.stdout;
    } catch (error) {
        const stderr = isRecord(error) && typeof error.stderr === "string"
            ? error.stderr.trim()
            : error instanceof Error
                ? error.message
                : String(error);
        throw new Error(`Media command "${command}" failed: ${stderr}`, { cause: error });
    }
}

async function saveGenerationResult(
    fileName: string,
    result: PodcastGenerationResult
): Promise<void> {
    await saveArtifactJson(fileName, {
        transcript: result.transcript,
        speech: result.speech.map((segment) => ({
            speaker: segment.speaker,
            text: segment.text,
            startTime: segment.startTime,
            endTime: segment.endTime,
            audio: describeArtifactMedia(segment.audio)
        })),
        lipSync: result.lipSync?.map((segment) => ({
            speaker: segment.speaker,
            text: segment.text,
            startTime: segment.startTime,
            endTime: segment.endTime,
            representation: segment.representation
        })),
        output: {
            format: result.output.format,
            contentType: result.output.contentType,
            filePath: result.output.filePath,
            segments: result.output.segments?.map(({ speaker, text, startTime, endTime }) => ({
                speaker,
                text,
                startTime,
                endTime
            })),
            asset: result.output.asset ? { persisted: true } : undefined
        }
    });
}

async function runFalEndpoint(
    endpointId: string,
    input: FalRecord,
    signal?: AbortSignal,
    timeoutMs = falRequestTimeout
): Promise<unknown> {
    const timedSignal = createTimedSignal(signal, timeoutMs);
    const startedAt = Date.now();
    let lastQueueStatus: string | undefined;
    console.info(`[fal.ai podcast] ${endpointId} request started (timeout ${timeoutMs} ms).`);
    try {
        const result = await fal.subscribe(endpointId, {
            input,
            ...requestOptions(timedSignal.signal),
            timeout: timeoutMs,
            onEnqueue: (requestId) => {
                console.info(`[fal.ai podcast] ${endpointId} enqueued (${requestId}).`);
            },
            onQueueUpdate: (status) => {
                const statusValue = getField(status, ["status"]);
                const statusLabel = typeof statusValue === "string" ? statusValue : "updated";
                if (statusLabel !== lastQueueStatus) {
                    lastQueueStatus = statusLabel;
                    console.info(`[fal.ai podcast] ${endpointId} queue status: ${statusLabel}.`);
                }
            }
        });
        console.info(`[fal.ai podcast] ${endpointId} completed in ${Date.now() - startedAt} ms.`);
        return result.data;
    } catch (error) {
        const status = getField(error, ["status", "statusCode"]);
        const statusText = status === undefined ? "" : ` (${String(status)})`;
        const message = timedSignal.didTimeout()
            ? `timed out after ${timeoutMs} ms${lastQueueStatus ? ` in ${lastQueueStatus}` : ""}`
            : error instanceof Error
                ? error.message
                : String(error);
        throw new Error(`fal endpoint "${endpointId}" failed${statusText}: ${message}`, { cause: error });
    } finally {
        timedSignal.dispose();
    }
}

async function requestFalText(
    prompt: string,
    signal: AbortSignal | undefined,
    operation: string
): Promise<string> {
    const artifactName = nextArtifactName("text", operation);
    await saveArtifactText(`${artifactName}.prompt.txt`, prompt);

    const input: FalRecord = {
        model: llmModelId,
        prompt,
        system_prompt: "Return only the requested JSON. Do not use Markdown fences.",
        temperature: 0
    };
    if (textModelId.startsWith("openrouter/")) {
        input.max_tokens = 700;
    } else {
        delete input.model;
        input.max_completion_tokens = 700;
        input.thinking = "disabled";
        input.reasoning_effort = "minimal";
    }

    const response = await runFalEndpoint(textModelId, input, signal);
    await saveArtifactJson(`${artifactName}.response.json`, response);

    const output = getField(response, ["output", "content"]);
    if (typeof output === "string") {
        await saveArtifactText(`${artifactName}.output.txt`, output);
        return output;
    }
    if (typeof response === "string") {
        await saveArtifactText(`${artifactName}.output.txt`, response);
        return response;
    }
    throw new Error("The configured fal text endpoint did not return a string output.");
}

const falTextToText: PodcastModel<
    PodcastTextToTextRequest,
    PodcastTranscript | string,
    unknown
> = async (request, options) => {
    return await requestFalText(request.prompt, signalFrom(options), "transcript");
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
    ].join("\n\n"), signalFrom(options), "fact-check");

    const parsed = parseJsonObject(response);
    if (!isRecord(parsed) || typeof parsed.passed !== "boolean") {
        throw new Error("The configured fal fact-check endpoint did not return the expected JSON shape.");
    }

    const result = {
        passed: parsed.passed,
        issues: Array.isArray(parsed.issues)
            ? parsed.issues.filter((issue): issue is string => typeof issue === "string")
            : undefined,
        correctedTranscript: isRecord(parsed.correctedTranscript)
            ? parsed.correctedTranscript as unknown as PodcastTranscript
            : undefined
    };
    await saveArtifactJson(
        `${nextArtifactName("fact-check", "result")}.json`,
        result
    );
    return result;
};

const falTextToSpeech: PodcastModel<
    PodcastTextToSpeechRequest,
    Uint8Array,
    TextToSpeechOptions
> = async (request, options) => {
    const artifactName = nextArtifactName(
        "speech",
        request.character?.name || request.character?.voice || "unknown-speaker"
    );
    const input: FalRecord = {
        text: request.text,
        voice: request.character?.voice || options?.voice || hostVoice
    };
    if (textToSpeechModelId === "fal-ai/inworld-tts") {
        input.sample_rate_hertz = 24000;
    } else {
        input.language_code = "en";
    }
    await saveArtifactJson(`${artifactName}.request.json`, {
        text: request.text,
        speaker: request.character?.name,
        voice: input.voice,
        model: textToSpeechModelId
    });
    const response = await runFalEndpoint(textToSpeechModelId, input, options?.signal);
    await saveArtifactJson(`${artifactName}.response.json`, response);
    const audio = getField(response, ["audio", "audio_url", "file", "output"]);
    if (audio === undefined) {
        throw new Error("The configured fal TTS endpoint did not return audio.");
    }
    return await saveArtifactMedia(`${artifactName}.mp3`, audio);
};

const falTextToImage: PodcastModel<PodcastImageRequest, PodcastAsset> = async (
    request,
    options
) => {
    const artifactName = nextArtifactName(
        "image",
        request.character?.name || "character"
    );
    await saveArtifactJson(`${artifactName}.request.json`, {
        prompt: request.prompt,
        character: request.character
            ? { name: request.character.name, role: request.character.role }
            : undefined,
        model: textToImageModelId
    });
    const response = await runFalEndpoint(textToImageModelId, {
        prompt: request.prompt,
        image_size: "portrait_4_3",
        num_images: 1,
        output_format: "jpeg"
    }, signalFrom(options));
    await saveArtifactJson(`${artifactName}.response.json`, response);
    const asset = normalizeImageAsset(response);
    return await saveArtifactMedia(`${artifactName}.jpeg`, asset);
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
    const drivenAudioUrl = await uploadMedia(request.speech[0].audio, "audio/wav");
    console.info(`[fal.ai podcast] ${directAvatarModelId} submitting direct-avatar video request.`);
    const response = await runFalEndpoint(directAvatarModelId, {
        source_image_url: sourceImageUrl,
        driven_audio_url: drivenAudioUrl,
        preprocess: "full",
        still_mode: true
    }, signalFrom(options), avatarRequestTimeout);
    const artifactName = nextArtifactName("direct-avatar", character.name);
    await saveArtifactJson(`${artifactName}.response.json`, response);
    const providerArtifactName = `${artifactName}-provider.mp4`;
    lastDirectAvatarProviderPath = await artifactFile(providerArtifactName);
    return await saveArtifactMedia(providerArtifactName, await normalizeVideoAsset(response));
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
        const artifactName = nextArtifactName("composed-audio", format);
        await saveArtifactJson(`${artifactName}.response.json`, response);
        const audio = getField(response, ["audio", "audio_url", "file", "output"]);
        if (audio === undefined) {
            throw new Error("The configured fal audio-composer endpoint did not return audio.");
        }
        return await saveArtifactMedia(`${artifactName}.${format}`, audio);
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
        const artifactName = nextArtifactName("lip-sync", request.character.name);
        await saveArtifactJson(`${artifactName}.response.json`, response);
        const representation = normalizeMotionRepresentation(response);
        await saveArtifactJson(`${artifactName}.representation.json`, representation);
        return representation;
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
        const artifactName = nextArtifactName("staged-avatar", request.characters[0]?.name || "podcast");
        await saveArtifactJson(`${artifactName}.response.json`, response);
        return await saveArtifactMedia(`${artifactName}.mp4`, await normalizeVideoAsset(response));
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

        const request = {
            subject: "how a microphone turns sound into a digital signal",
            description: "A short educational exchange between a science host and a skeptical co-host.",
            instruction: "Return exactly two short segments: one by Maya and one by Noah. Keep the claims easy to verify."
        };
        await saveArtifactJson("01-transcript.request.json", request);
        const transcript = await workflow.generateTranscript(request);
        await saveArtifactJson("01-transcript.json", transcript);

        expect(transcript.segments.length).toBeGreaterThanOrEqual(2);
        expect(transcript.segments.slice(0, 2).map(({ speaker }) => speaker))
            .toStrictEqual(["Maya", "Noah"]);
        expect(transcript.segments.every(({ speaker }) => characters.some(({ name }) => name === speaker)))
            .toBe(true);
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

        await saveArtifactJson("02-multi-character-speech.request.json", {
            transcript,
            factChecking: false
        });
        const result = await workflow.generatePodcast({ transcript, factChecking: false });
        await saveGenerationResult("02-multi-character-speech.result.json", result);

        expect(result.speech.map(({ speaker }) => speaker)).toStrictEqual(["Maya", "Noah"]);
        expect(result.speech.every(({ audio }) => audio instanceof Uint8Array && audio.byteLength > 0)).toBe(true);
        expect(result.output.segments?.map(({ speaker }) => speaker)).toStrictEqual(["Maya", "Noah"]);
        expect(result.output.asset).toBeUndefined();
    }, liveTimeout);

    it("saves a single generated audio asset to disk", async () => {
        const workflow = new PodcastWorkflow({
            models: { textToSpeech: falTextToSpeech },
            characters: [characters[0]],
            output: { format: "mp3" }
        });
        const request = {
            transcript: {
                segments: [{ speaker: "Maya", text: "This episode is persisted from a live fal audio asset." }]
            },
            factChecking: false
        };
        await saveArtifactJson("03-single-audio.request.json", request);
        const result = await workflow.generatePodcast(request);
        await saveGenerationResult("03-single-audio.result.json", result);
        const filePath = await artifactFile("03-single-audio-output.mp3");

        expect(result.output.asset).toBeDefined();
        await result.output.asset!.save(filePath);
        const savedFile = await stat(filePath);
        expect(savedFile.size).toBeGreaterThan(0);
        expect((await readFile(filePath)).byteLength).toBe(savedFile.size);
    }, liveTimeout);

    it("generates an avatar video, soundtrack, and muxed outcome", async () => {
        lastDirectAvatarProviderPath = undefined;
        const workflowOutputPath = await artifactFile("04-direct-avatar-workflow-output.mp4");
        const workflow = new PodcastWorkflow({
            models: {
                textToSpeech: falTextToSpeech,
                textToImage: falTextToImage,
                avatarVideos: falDirectAvatar
            },
            characters: [{ ...characters[0], avatarImage: undefined }],
            mediaTools: { ffmpegPath: ffmpegCommand, ffprobePath: ffprobeCommand },
            output: {
                format: "mp4",
                filePath: workflowOutputPath,
                composeVideoAudio: true
            }
        });
        const request = {
            transcript: {
                segments: [{ speaker: "Maya", text: "This is a direct audio-driven avatar test." }]
            },
            factChecking: false
        };
        await saveArtifactJson("04-direct-avatar.request.json", request);
        const result = await workflow.generatePodcast(request);
        await saveGenerationResult("04-direct-avatar.result.json", result);
        const providerVideoPath = getLastDirectAvatarProviderPath();
        const soundtrackPath = await artifactFile("04-direct-avatar-soundtrack.mp3");
        const finalVideoPath = await artifactFile("04-direct-avatar-with-sound.mp4");

        if (!providerVideoPath) {
            throw new Error("The direct-avatar provider artifact was not persisted.");
        }
        const finalAvatarPath = providerVideoPath.replace(/-provider\.mp4$/, ".mp4");
        expect(result.output.asset).toBeDefined();
        expect(result.output.contentType).toBe("video/mp4");
        expect(result.output.filePath).toBe(workflowOutputPath);
        expect((await stat(workflowOutputPath)).size).toBeGreaterThan(0);
        await result.output.asset!.save(finalAvatarPath);
        expect((await stat(finalAvatarPath)).size).toBeGreaterThan(0);

        await workflow.generateSoundtrack(result.speech, soundtrackPath);
        expect((await stat(soundtrackPath)).size).toBeGreaterThan(0);

        await workflow.combineVideoWithAudio(providerVideoPath, soundtrackPath, finalVideoPath);
        expect((await stat(finalVideoPath)).size).toBeGreaterThan(0);
        await saveArtifactJson("04-direct-avatar.media.json", {
            providerVideo: providerVideoPath,
            finalAvatar: finalAvatarPath,
            workflowOutput: workflowOutputPath,
            soundtrack: soundtrackPath,
            finalVideo: finalVideoPath,
            providerStreams: await inspectMedia(providerVideoPath),
            soundtrackStreams: await inspectMedia(soundtrackPath),
            finalStreams: await inspectMedia(finalVideoPath)
        });
        await expectMediaStreams(providerVideoPath, { video: true });
        await expectMediaStreams(workflowOutputPath, {
            audio: true,
            video: true,
            audioSampleRate: 48000,
            audioChannels: 2,
            audioDefault: true
        });
        await expectMediaStreams(finalAvatarPath, {
            audio: true,
            video: true,
            audioSampleRate: 48000,
            audioChannels: 2,
            audioDefault: true
        });
        await expectMediaStreams(soundtrackPath, {
            audio: true,
            audioSampleRate: 48000,
            audioChannels: 2
        });
        await expectMediaStreams(finalVideoPath, {
            audio: true,
            video: true,
            audioSampleRate: 48000,
            audioChannels: 2,
            audioDefault: true
        });
    }, avatarTestTimeout);

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

            const request = {
                transcript: {
                    segments: [{ speaker: "Maya", text: "This segment becomes facial motion data before rendering." }]
                },
                factChecking: false
            };
            await saveArtifactJson("05-staged-avatar.request.json", request);
            const result = await workflow.generatePodcast(request);
            await saveGenerationResult("05-staged-avatar.result.json", result);
            const filePath = await artifactFile("05-staged-avatar-output.mp4");

            expect(result.lipSync).toHaveLength(1);
            expect(result.lipSync?.[0].representation).toBeDefined();
            expect(stagedRequests).toHaveLength(1);
            expect(stagedRequests[0].speech).toBeUndefined();
            expect(stagedRequests[0].lipSync?.[0].representation).toEqual(result.lipSync?.[0].representation);
            expect(result.output.asset).toBeDefined();
            await result.output.asset!.save(filePath);
            expect((await stat(filePath)).size).toBeGreaterThan(0);
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
            const request = {
                transcript: {
                    segments: [
                        { speaker: "Maya", text: "The first audio segment is generated live." },
                        { speaker: "Noah", text: "The second segment is composed after synthesis." }
                    ]
                },
                factChecking: false
            };
            await saveArtifactJson("06-composed-audio.request.json", request);
            const result = await workflow.generatePodcast(request);
            await saveGenerationResult("06-composed-audio.result.json", result);
            const filePath = await artifactFile("06-composed-audio-output.mp3");

            expect(result.output.asset).toBeDefined();
            expect(result.output.contentType).toBe("audio/mpeg");
            await result.output.asset!.save(filePath);
            expect((await stat(filePath)).size).toBeGreaterThan(0);
        }, liveTimeout);
    });
});

function safeArtifactName(value: string): string {
    const sanitized = value
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return sanitized || "artifact";
}

function positiveDuration(value: string | undefined, fallback: number): number {
    const duration = Number(value);
    return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function createTimedSignal(
    parent: AbortSignal | undefined,
    timeoutMs: number
): {
    signal: AbortSignal;
    didTimeout: () => boolean;
    dispose: () => void;
} {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    const abortFromParent = () => controller.abort(parent?.reason);

    if (parent) {
        if (parent.aborted) {
            abortFromParent();
        } else {
            parent.addEventListener("abort", abortFromParent, { once: true });
        }
    }

    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        dispose: () => {
            clearTimeout(timer);
            parent?.removeEventListener("abort", abortFromParent);
        }
    };
}

function artifactJsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Uint8Array) {
        return { type: "Uint8Array", byteLength: value.byteLength };
    }
    if (isBlob(value)) {
        return { type: "Blob", contentType: value.type, byteLength: value.size };
    }
    if (typeof value === "bigint") {
        return `${value}n`;
    }
    return value;
}

function describeArtifactMedia(media: unknown): unknown {
    if (media instanceof Uint8Array) {
        return { type: "Uint8Array", byteLength: media.byteLength };
    }
    if (isBlob(media)) {
        return { type: "Blob", contentType: media.type, byteLength: media.size };
    }
    if (typeof media === "string") {
        return { type: "string", value: media };
    }
    if (isRecord(media) && typeof media.url === "string") {
        return { type: "url", value: media.url };
    }
    return { type: typeof media };
}

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
