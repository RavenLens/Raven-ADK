import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReActAgent } from "../agent/ReAct.agent";
import type { MessagesVariations } from "../agent/state";
import type { StandardLLMShema } from "../models/mutual";
import type { TextToSpeechModel, TextToSpeechOptions } from "../models/text-to-speech/tts.mutual";

export type PodcastOutputFormat = "mp4" | "wav" | "webm" | "mp3";
export type PodcastAsset = string | Uint8Array;
/** Provider-defined motion data such as landmarks, 3DMM coefficients, or latent embeddings. */
export type PodcastLipSyncRepresentation =
    | PodcastAsset
    | Record<string, unknown>
    | readonly unknown[];
export type PodcastStream<TChunk> = AsyncIterable<TChunk> | ReadableStream<TChunk>;
export type PodcastMedia = PodcastAsset | PodcastStream<PodcastAsset>;
export type PodcastModelResult<TOutput> =
    | TOutput
    | Promise<TOutput | PodcastStream<TOutput>>
    | PodcastStream<TOutput>;

export type PodcastModel<TRequest, TOutput, TOptions = unknown> = (
    request: TRequest,
    options?: TOptions
) => PodcastModelResult<TOutput>;

export interface PodcastTranscriptSegment {
    speaker: string;
    text: string;
    startTime?: number;
    endTime?: number;
}

export interface PodcastTranscript {
    segments: PodcastTranscriptSegment[];
    text?: string;
}

export interface PodcastTranscriptFragment {
    transcript: PodcastTranscript | string;
    durationSeconds?: number;
}

export interface PodcastCharacter {
    name: string;
    role?: string;
    voice?: string;
    voiceSample?: PodcastAsset;
    face?: string;
    avatarImage?: PodcastAsset;
}

export interface PodcastTextToTextRequest {
    prompt: string;
    transcript?: PodcastTranscript;
    characters?: PodcastCharacter[];
    priorFragments?: PodcastTranscriptFragment[];
    targetDurationSeconds?: number;
}

export type PodcastTextToTextModel =
    | StandardLLMShema
    | PodcastModel<PodcastTextToTextRequest, PodcastTranscript | string>;

export interface PodcastTextToSpeechRequest {
    text: string;
    character?: PodcastCharacter;
}

export type PodcastTextToSpeechModel =
    | TextToSpeechModel
    | PodcastModel<PodcastTextToSpeechRequest, Uint8Array, TextToSpeechOptions>;

export interface PodcastSpeechSegment {
    speaker: string;
    text: string;
    audio: PodcastMedia;
    startTime?: number;
    endTime?: number;
}

export interface PodcastImageRequest {
    prompt: string;
    character?: PodcastCharacter;
    backgroundImage?: PodcastAsset;
}

export type PodcastImageModel = PodcastModel<PodcastImageRequest, PodcastAsset>;

/**
 * Input passed to the provider that renders or assembles the final podcast video.
 *
 * The request contains the complete transcript and the resolved character assets.
 * Direct avatar models can receive ordered audio in `speech`. When a lip-sync
 * model is configured, `lipSync` contains the staged motion representations and
 * the workflow omits `speech` so Stage 2 remains independent of voice audio.
 */
export interface PodcastAvatarRequest {
    /** Complete transcript used to preserve dialogue, speaker order, and timing. */
    transcript: PodcastTranscript;
    /** Characters resolved for the transcript speakers, including voices and avatar images. */
    characters: PodcastCharacter[];
    /** Ordered speech segments for direct avatar models. Omitted from two-stage requests when `lipSync` is present. */
    speech?: PodcastSpeechSegment[];
    /** Optional Stage 1 lip-sync representations generated from the corresponding speech audio. */
    lipSync?: PodcastLipSyncSegment[];
    /** Optional image used as the shared background for avatar rendering or composition. */
    backgroundImage?: PodcastAsset;
}

/** Stage 2 provider model that turns motion representations and character assets into the final video. */
export type PodcastAvatarModel = PodcastModel<PodcastAvatarRequest, PodcastAsset>;

/** Input passed to the Stage 1 audio-to-motion lip-sync model. */
export interface PodcastLipSyncRequest {
    /** Complete transcript used to preserve the episode context and segment order. */
    transcript: PodcastTranscript;
    /** Text spoken by the current segment. */
    text: string;
    /** TTS audio whose phonemes are converted into facial motion data. */
    audio: PodcastMedia;
    /** Complete generated speech segment for the current speaker. */
    speech: PodcastSpeechSegment;
    /** Character metadata used to select or condition the motion model. */
    character: PodcastCharacter;
}

/** One ordered speech segment paired with the Stage 1 motion representation consumed by Stage 2. */
export interface PodcastLipSyncSegment extends PodcastSpeechSegment {
    /** Provider-defined landmarks, blendshapes, 3DMM data, or latent facial-motion embeddings. */
    representation: PodcastLipSyncRepresentation;
}

/**
 * Stage 1 model that converts generated speech audio into facial-motion data.
 *
 * This model must not be responsible for rendering the final video. Its result
 * is passed to `PodcastAvatarModel` together with the matching character asset.
 */
export type PodcastLipSyncModel = PodcastModel<
    PodcastLipSyncRequest,
    PodcastLipSyncRepresentation,
    { signal?: AbortSignal }
>;

export interface PodcastAudioCompositionRequest {
    transcript: PodcastTranscript;
    segments: PodcastSpeechSegment[];
    format: Extract<PodcastOutputFormat, "mp3" | "wav">;
}

export type PodcastAudioComposer = PodcastModel<PodcastAudioCompositionRequest, PodcastAsset>;

export interface PodcastFactCheckRequest {
    transcript: PodcastTranscript;
}

export interface PodcastFactCheckResult {
    passed: boolean;
    issues?: string[];
    correctedTranscript?: PodcastTranscript;
}

export type PodcastFactChecker =
    | ReActAgent<any, any, any, any>
    | StandardLLMShema
    | PodcastModel<PodcastFactCheckRequest, PodcastFactCheckResult>;

export type PodcastTranscriptGenerator =
    | ReActAgent<any, any, any, any>
    | StandardLLMShema
    | PodcastModel<PodcastTextToTextRequest, PodcastTranscript | string>;

export interface PodcastOutputConfig {
    format: PodcastOutputFormat;
    filePath?: string;
    composeAudio?: PodcastAudioComposer;
}

export interface PodcastGenerationRequest {
    transcript?: PodcastTranscript;
    subject?: string;
    description?: string;
    instruction?: string;
    /** Fact-check the transcript unless explicitly disabled. */
    factChecking?: boolean;
    signal?: AbortSignal;
}

export interface PodcastGeneratedAsset {
    /** Original media returned by the configured provider. */
    readonly media: PodcastMedia;

    
    /** Saves the generated media to the requested file path. */
    save(filePath: string): Promise<void>;
}

export interface PodcastGeneratedOutput {
    format: PodcastOutputFormat;
    contentType: string;
    asset?: PodcastGeneratedAsset;
    segments?: PodcastSpeechSegment[];
    filePath?: string;
}

/**
 * Ordered result of a complete podcast generation run.
 *
 * The workflow exposes intermediate transcript and speech stages alongside the
 * final output so callers can inspect, persist, or pass those assets to another
 * media pipeline. `lipSync` is present only for video runs that configure a
 * lip-sync model.
 */
export interface PodcastGenerationResult {
    /** Validated transcript used for speech and video generation. */
    transcript: PodcastTranscript;
    /** Ordered speech assets generated for each transcript segment. */
    speech: PodcastSpeechSegment[];
    /** Optional ordered Stage 1 motion representations, one for each speech segment. */
    lipSync?: PodcastLipSyncSegment[];
    /** Final audio or video output, including its format and saveable asset when available. */
    output: PodcastGeneratedOutput;
}

interface PodcastInvokableModel {
    invoke(options?: {
        messages?: MessagesVariations[];
        abort?: AbortSignal;
    }): Promise<unknown>;
}

class SaveablePodcastAsset implements PodcastGeneratedAsset {
    private materialized?: Promise<Uint8Array>;

    constructor(
        public readonly media: PodcastMedia,
        private readonly materialize: (media: PodcastMedia) => Promise<Uint8Array>
    ) {}

    async save(filePath: string): Promise<void> {
        const bytes = await (this.materialized ??= this.materialize(this.media));
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, bytes);
    }
}

export interface PodcastWorkflowConfig {
    /** Models used to generate the podcast. */
    models: {
        /** Model used to generate text. */
        textToText?: PodcastTextToTextModel;
        /** Model used to generate speech. */
        textToSpeech?: PodcastTextToSpeechModel;
        /** 
         * Model used to generate images
         * Like:
         *  - Avatar base image - when user didn't specify the avatar for the model and prompts to do it
         *  - Background - it may be used to generate the background for images
        */
        textToImage?: PodcastImageModel;
        /** Model used to generate avatars. */
        avatarVideos?: PodcastAvatarModel;
        /** Optional model used to lip-sync each speech segment to its character. */
        lipSync?: PodcastLipSyncModel;
    };
    /** Transcript generation and fact-checking options. */
    transcript?: {
        /** Generator used to create the transcript. */
        generator?: PodcastTranscriptGenerator;
        /** Checker used to validate the transcript. */
        factChecker?: PodcastFactChecker;
        /** Desired transcript duration in seconds. */
        targetDurationSeconds?: number;
        /** Transcript fragments to use as prior context. */
        priorFragments?: PodcastTranscriptFragment[];
    };
    /** Characters included in the podcast. */
    characters?: PodcastCharacter[];
    /** Optional background image for the podcast. */
    backgroundImage?: PodcastAsset;
    /** Output format and destination configuration. */
    output: PodcastOutputConfig;
}

export class PodcastWorkflow {
    /** Configuration used by the podcast workflow. */
    config: PodcastWorkflowConfig;

    /** Stores the providers and settings used by the workflow. */
    constructor(config: PodcastWorkflowConfig) {
        this.config = config;
    }

    /** Synthesizes transcript segments into ordered speech assets. */
    private async transcriptToSpeech(
        transcript: PodcastTranscript,
        options: { signal?: AbortSignal } = {}
    ): Promise<PodcastSpeechSegment[]> {
        this.validateTranscript(transcript);

        const textToSpeech = this.config.models.textToSpeech;
        if (!textToSpeech) {
            throw new Error("Podcast textToSpeech model is required.");
        }

        const audioFormat = this.config.output.format === "wav" ? "wav" : "mp3";
        const characters = this.config.characters ?? [];

        const speech: PodcastSpeechSegment[] = [];
        for (const segment of transcript.segments) {
            this.throwIfAborted(options.signal);

            const character = characters.find(({ name }) => name === segment.speaker);
            const request: PodcastTextToSpeechRequest = {
                text: segment.text,
                character
            };
            const speechOptions: TextToSpeechOptions = {
                voice: character?.voice,
                outputFormat: audioFormat,
                signal: options.signal
            };

            let audio: PodcastMedia;
            if (typeof textToSpeech === "function") {
                audio = await textToSpeech(request, speechOptions);
            } else {
                audio = await textToSpeech.synthesize(segment.text, speechOptions);
            }

            speech.push({
                speaker: segment.speaker,
                text: segment.text,
                audio,
                startTime: segment.startTime,
                endTime: segment.endTime
            });
        }

        return speech;
    }

    /** Generates a complete podcast from a transcript or subject. */
    async generatePodcast(
        request: PodcastGenerationRequest = {}
    ): Promise<PodcastGenerationResult> {
        this.throwIfAborted(request.signal);
        const factChecking = request.factChecking !== false;
        const transcriptWasGenerated = !request.transcript;

        const transcript = request.transcript
            ? this.validateTranscript(request.transcript)
            : await this.generateTranscript({
                subject: request.subject,
                description: request.description,
                instruction: request.instruction,
                factChecking: false,
                signal: request.signal
            });

        const factCheckedTranscript = factChecking
            ? await this.factCheckTranscript(transcript, request.signal)
            : transcript;
        const finalTranscript = transcriptWasGenerated
            ? this.validateConfiguredSpeakers(factCheckedTranscript)
            : factCheckedTranscript;
        const speech = await this.transcriptToSpeech(finalTranscript, {
            signal: request.signal
        });
        const pipeline = await this.createOutput(finalTranscript, speech, request.signal);

        return {
            transcript: finalTranscript,
            speech,
            lipSync: pipeline.lipSync,
            output: pipeline.output
        };
    }

    /** Generates and optionally fact-checks a podcast transcript. */
    async generateTranscript(
        config: {
            /** Subject to generate content */
            subject?: string;
            /** Gennerated content description */
            description?: string;
            /** Instruction to generate content */
            instruction?: string;
            /** Fact-check the generated transcript unless explicitly disabled. */
            factChecking?: boolean;
            signal?: AbortSignal;
        }
    ): Promise<PodcastTranscript> {
        const subject = config.subject?.trim();
        const description = config.description?.trim();
        if (!subject || !description) {
            throw new Error("subject and description are required to generate a transcript.");
        }

        const generator = this.config.transcript?.generator ?? this.config.models.textToText;
        if (!generator) {
            throw new Error("Podcast transcript generator is required.");
        }

        const configuredCharacters = this.config.characters ?? [];
        const characterInstructions = configuredCharacters.length > 0
            ? [
                "Use only the configured character names as speaker values.",
                "Configured characters:",
                ...configuredCharacters.map(({ name, role }) => `- ${name}${role ? `: ${role}` : ""}`)
            ].join("\n")
            : "Use a clear speaker name for every transcript segment.";
        const prompt = [
            "Generate a podcast transcript.",
            `Subject: ${subject}`,
            `Description: ${description}`,
            config.instruction ? `Additional instruction: ${config.instruction}` : undefined,
            characterInstructions,
            "Return only JSON in the form {\"segments\":[{\"speaker\":\"...\",\"text\":\"...\"}]}.",
            "Keep each segment assigned to a named speaker and target the configured duration."
        ].filter((part): part is string => !!part).join("\n");

        const textRequest: PodcastTextToTextRequest = {
            prompt,
            characters: configuredCharacters,
            priorFragments: this.config.transcript?.priorFragments,
            targetDurationSeconds: this.config.transcript?.targetDurationSeconds
        };

        const generated = typeof generator === "function"
            ? await generator(textRequest, { signal: config.signal })
            : await (generator as PodcastInvokableModel).invoke({
                messages: [{ type: "user", content: prompt }],
                abort: config.signal
            });
        const generatedValue = await this.resolveModelValue(generated);
        const defaultSpeaker = this.config.characters?.[0]?.name ?? "Host";
        const transcript = this.validateTranscript(this.normalizeTranscript(generatedValue, defaultSpeaker));
        const checkedTranscript = config.factChecking === false
            ? transcript
            : await this.factCheckTranscript(transcript, config.signal);

        return this.validateConfiguredSpeakers(checkedTranscript);
    }

    /** Validates a transcript and applies any fact-check corrections. */
    private async factCheckTranscript(
        transcript: PodcastTranscript,
        signal?: AbortSignal
    ): Promise<PodcastTranscript> {
        const factChecker = this.config.transcript?.factChecker;
        if (!factChecker) {
            throw new Error("Podcast factChecker is required when factChecking is enabled.");
        }

        const prompt = [
            "Fact-check this podcast transcript.",
            "Return only JSON in the form {\"passed\":boolean,\"issues\":string[],\"correctedTranscript\":{\"segments\":[...]}}.",
            JSON.stringify(transcript)
        ].join("\n\n");

        const checked = typeof factChecker === "function"
            ? await factChecker({ transcript }, { signal })
            : await (factChecker as PodcastInvokableModel).invoke({
                messages: [{ type: "user", content: prompt }],
                abort: signal
            });
        const result = await this.parseFactCheckResult(await this.resolveModelValue(checked));
        const refinedTranscript = result.correctedTranscript ?? transcript;

        this.validateTranscript(refinedTranscript);
        if (!result.passed && !result.correctedTranscript) {
            const issues = result.issues?.filter(Boolean).join("; ") || "No corrected transcript was returned.";
            throw new Error(`Podcast transcript failed fact checking: ${issues}`);
        }

        return refinedTranscript;
    }

    /** Builds the configured audio or video podcast output. */
    private async createOutput(
        transcript: PodcastTranscript,
        speech: PodcastSpeechSegment[],
        signal?: AbortSignal
    ): Promise<{
        output: PodcastGeneratedOutput;
        lipSync?: PodcastLipSyncSegment[];
    }> {
        const { format } = this.config.output;
        if (format === "mp3" || format === "wav") {
            let asset: PodcastMedia | undefined;
            if (speech.length === 1) {
                asset = speech[0].audio;
            } else if (this.config.output.composeAudio) {
                asset = await this.config.output.composeAudio({
                    transcript,
                    segments: speech,
                    format
                }, { signal });
            }

            if (!asset) {
                if (this.config.output.filePath) {
                    throw new Error("composeAudio is required to write multiple speech segments to one audio file.");
                }

                return {
                    output: {
                        format,
                        contentType: contentTypeFor(format),
                        segments: speech
                    }
                };
            }

            return {
                output: await this.completeOutput(asset)
            };
        }

        const avatarVideos = this.config.models.avatarVideos;
        if (!avatarVideos) {
            throw new Error(`Podcast avatarVideos model is required for ${format} output.`);
        }

        const characters = await this.resolveAvatarCharacters(transcript, signal);
        const lipSync = this.config.models.lipSync
            ? await this.generateLipSync(transcript, speech, characters, signal)
            : undefined;
        const avatarRequest: PodcastAvatarRequest = {
            transcript,
            characters,
            lipSync,
            backgroundImage: this.config.backgroundImage
        };
        if (!lipSync) {
            avatarRequest.speech = speech;
        }
        const avatar = await avatarVideos(avatarRequest, { signal });

        return {
            lipSync,
            output: await this.completeOutput(avatar)
        };
    }

    /** Generates Stage 1 lip-sync representations from ordered speech and characters. */
    private async generateLipSync(
        transcript: PodcastTranscript,
        speech: PodcastSpeechSegment[],
        characters: PodcastCharacter[],
        signal?: AbortSignal
    ): Promise<PodcastLipSyncSegment[]> {
        const lipSyncModel = this.config.models.lipSync;
        if (!lipSyncModel) {
            return [];
        }

        const lipSyncedSegments: PodcastLipSyncSegment[] = [];
        for (const speechSegment of speech) {
            this.throwIfAborted(signal);
            const character = characters.find(({ name }) => name === speechSegment.speaker);
            if (!character) {
                throw new Error(`No character is configured for speaker "${speechSegment.speaker}".`);
            }

            const representation = await this.resolveModelValue(await lipSyncModel({
                transcript,
                text: speechSegment.text,
                audio: speechSegment.audio,
                speech: speechSegment,
                character
            }, { signal }));
            if (!isPodcastLipSyncRepresentation(representation)) {
                throw new Error("Podcast lipSync model must return a motion representation.");
            }

            lipSyncedSegments.push({
                ...speechSegment,
                representation
            });
        }

        return lipSyncedSegments;
    }

    /** Resolves character voices and avatar images for video output. */
    private async resolveAvatarCharacters(
        transcript: PodcastTranscript,
        signal?: AbortSignal
    ): Promise<PodcastCharacter[]> {
        const configuredCharacters = this.config.characters ?? [];
        const imageModel = this.config.models.textToImage;
        const speakers = [...new Set(transcript.segments.map(({ speaker }) => speaker))];

        return await Promise.all(speakers.map(async (speaker) => {
            const character = configuredCharacters.find(({ name }) => name === speaker);
            if (!character) {
                throw new Error(`No character is configured for speaker "${speaker}".`);
            }
            if (!character.voice) {
                throw new Error(`Character "${speaker}" needs a voice for avatar output.`);
            }

            if (character.avatarImage) {
                return character;
            }
            if (!imageModel) {
                throw new Error(`Character "${speaker}" needs an avatarImage or a textToImage model.`);
            }

            this.throwIfAborted(signal);
            const image = await imageModel({
                prompt: `Create a podcast avatar portrait for the speaker named ${speaker}.`,
                character,
                backgroundImage: this.config.backgroundImage
            }, { signal });
            const avatarImage = await this.resolveSingleAsset(await this.resolveModelValue(image));

            return {
                ...character,
                avatarImage
            };
        }));
    }

    /** Adds output metadata and optionally writes media to disk. */
    private async completeOutput(asset: PodcastMedia): Promise<PodcastGeneratedOutput> {
        const { format, filePath } = this.config.output;
        const saveableAsset = new SaveablePodcastAsset(
            asset,
            (media) => this.materializeMedia(media)
        );
        if (!filePath) {
            return {
                format,
                contentType: contentTypeFor(format),
                asset: saveableAsset
            };
        }

        const bytes = await this.materializeMedia(asset);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, bytes);

        return {
            format,
            contentType: contentTypeFor(format),
            asset: new SaveablePodcastAsset(
                bytes,
                (media) => this.materializeMedia(media)
            ),
            filePath
        };
    }

    /** Converts a media asset or stream into file bytes. */
    private async materializeMedia(asset: PodcastMedia): Promise<Uint8Array> {
        const resolved = await this.resolveModelValue(asset);
        if (Array.isArray(resolved)) {
            if (resolved.length === 1) {
                return await this.materializeMedia(resolved[0] as PodcastMedia);
            }
            if (resolved.every((chunk) => chunk instanceof Uint8Array)) {
                return combineBinaryChunks(resolved as Uint8Array[]);
            }
            throw new Error("A media stream must contain binary chunks to be written to a file.");
        }
        if (resolved instanceof Uint8Array) {
            return resolved;
        }
        if (typeof resolved !== "string") {
            throw new Error("The podcast output is not a supported media asset.");
        }

        if (/^(https?:|data:)/.test(resolved)) {
            const response = await fetch(resolved);
            if (!response.ok) {
                throw new Error(`Unable to download podcast output: ${response.status}`);
            }
            return new Uint8Array(await response.arrayBuffer());
        }

        return new Uint8Array(await readFile(resolved));
    }

    /** Normalizes a model response into one media asset. */
    private async resolveSingleAsset(value: unknown): Promise<PodcastAsset> {
        if (value instanceof Uint8Array || typeof value === "string") {
            return value;
        }
        if (Array.isArray(value) && value.length === 1) {
            return await this.resolveSingleAsset(value[0]);
        }
        throw new Error("The image model must return one image URL or binary image asset.");
    }

    /** Awaits provider results and collects supported streams. */
    private async resolveModelValue(value: unknown): Promise<unknown> {
        const resolved = await value;
        if (isAsyncIterable(resolved)) {
            return await collectStream(resolved);
        }
        if (isReadableStream(resolved)) {
            return await collectStream(resolved);
        }
        return resolved;
    }

    /** Converts model output into a normalized podcast transcript. */
    private normalizeTranscript(value: unknown, defaultSpeaker: string): PodcastTranscript {
        const modelValue = isRecord(value) && typeof value.output === "string"
            ? value.output
            : value;
        if (isRecord(modelValue) && Array.isArray(modelValue.segments)) {
            return modelValue as unknown as PodcastTranscript;
        }

        const text = typeof modelValue === "string"
            ? modelValue
            : this.extractModelText(modelValue);
        const parsed = parseJson(text);
        if (isRecord(parsed) && Array.isArray(parsed.segments)) {
            return parsed as unknown as PodcastTranscript;
        }

        return {
            segments: [{
                speaker: defaultSpeaker,
                text
            }]
        };
    }

    /** Parses a fact-checker response into its expected result shape. */
    private async parseFactCheckResult(value: unknown): Promise<PodcastFactCheckResult> {
        const modelValue = isRecord(value) && typeof value.output === "string"
            ? value.output
            : value;
        const parsedValue = isRecord(modelValue) && ("passed" in modelValue || "correctedTranscript" in modelValue)
            ? modelValue
            : parseJson(this.extractModelText(modelValue));
        if (!isRecord(parsedValue) || typeof parsedValue.passed !== "boolean") {
            throw new Error("Fact checker must return a JSON object with a boolean passed property.");
        }

        return parsedValue as unknown as PodcastFactCheckResult;
    }

    /** Extracts readable text from common model response shapes. */
    private extractModelText(value: unknown): string {
        if (typeof value === "string") {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map((chunk) => this.extractModelText(chunk)).join("");
        }
        if (!isRecord(value)) {
            throw new Error("The text model did not return readable text.");
        }
        if (typeof value.output === "string") {
            return value.output;
        }
        if (typeof value.content === "string") {
            return value.content;
        }
        if (value.structuredOutput !== undefined) {
            return JSON.stringify(value.structuredOutput);
        }
        if (Array.isArray(value.messages)) {
            return this.extractModelText(value.messages[value.messages.length - 1]);
        }
        if (Array.isArray(value.answer)) {
            return this.extractModelText(value.answer[value.answer.length - 1]);
        }
        throw new Error("The text model did not return readable text.");
    }

    /** Validates the required transcript segment fields and timings. */
    private validateTranscript(transcript: PodcastTranscript): PodcastTranscript {
        if (!transcript || !Array.isArray(transcript.segments) || transcript.segments.length === 0) {
            throw new Error("Podcast transcript must contain at least one segment.");
        }

        transcript.segments.forEach((segment, index) => {
            if (!segment
                || typeof segment.speaker !== "string"
                || typeof segment.text !== "string"
                || !segment.speaker.trim()
                || !segment.text.trim()) {
                throw new Error(`Podcast transcript segment ${index} needs a speaker and text.`);
            }
            if (segment.startTime !== undefined && segment.startTime < 0) {
                throw new Error(`Podcast transcript segment ${index} has an invalid startTime.`);
            }
            if (segment.endTime !== undefined && segment.endTime < 0) {
                throw new Error(`Podcast transcript segment ${index} has an invalid endTime.`);
            }
            if (segment.startTime !== undefined && segment.endTime !== undefined && segment.endTime <= segment.startTime) {
                throw new Error(`Podcast transcript segment ${index} must end after it starts.`);
            }
        });

        return transcript;
    }

    /** Ensures generated transcript speakers match configured character names. */
    private validateConfiguredSpeakers(transcript: PodcastTranscript): PodcastTranscript {
        const configuredCharacters = this.config.characters ?? [];
        if (configuredCharacters.length === 0) {
            return transcript;
        }

        const configuredNames = new Set(configuredCharacters.map(({ name }) => name));
        const unknownSpeakers = [...new Set(
            transcript.segments
                .map(({ speaker }) => speaker)
                .filter((speaker) => !configuredNames.has(speaker))
        )];
        if (unknownSpeakers.length > 0) {
            throw new Error(
                `Podcast transcript uses unconfigured speakers: ${unknownSpeakers.join(", ")}. `
                + "Use the configured character names exactly."
            );
        }

        return transcript;
    }

    /** Throws when the supplied abort signal has been cancelled. */
    private throwIfAborted(signal?: AbortSignal): void {
        if (signal?.aborted) {
            throw new Error("Podcast generation was aborted.");
        }
    }
}

function contentTypeFor(format: PodcastOutputFormat): string {
    return {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        mp4: "video/mp4",
        webm: "video/webm"
    }[format];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isPodcastLipSyncRepresentation(value: unknown): value is PodcastLipSyncRepresentation {
    return typeof value === "string"
        || value instanceof Uint8Array
        || (typeof value === "object" && value !== null);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return typeof value === "object"
        && value !== null
        && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function";
}

function isReadableStream(value: unknown): value is ReadableStream<unknown> {
    return typeof value === "object"
        && value !== null
        && typeof (value as { getReader?: unknown }).getReader === "function";
}

async function collectStream(stream: AsyncIterable<unknown> | ReadableStream<unknown>): Promise<unknown[]> {
    if (isAsyncIterable(stream)) {
        const chunks: unknown[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        return chunks;
    }

    const chunks: unknown[] = [];
    const reader = (stream as ReadableStream<unknown>).getReader();
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) {
                return chunks;
            }
            chunks.push(result.value);
        }
    } finally {
        reader.releaseLock();
    }
}

function combineBinaryChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((length, chunk) => length + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return combined;
}

function parseJson(value: string): unknown {
    const normalized = value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
    try {
        return JSON.parse(normalized);
    } catch {
        return undefined;
    }
}
