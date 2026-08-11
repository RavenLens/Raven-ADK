import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
    PodcastAudioCompositionRequest,
    PodcastAvatarRequest,
    PodcastFactCheckRequest,
    PodcastLipSyncRequest,
    PodcastRealtimeAvatarRequest,
    PodcastRealtimeAvatarSession,
    PodcastTextToSpeechRequest,
    PodcastTextToTextRequest,
    PodcastWorkflow
} from "../../src/podcast/podcast";
import type { TextToSpeechOptions } from "../../src/models/text-to-speech/tts.mutual";

describe("PodcastWorkflow", () => {
    it("fact-checks generated transcripts before sequential speech synthesis", async () => {
        const generator = vi.fn(async (request: PodcastTextToTextRequest) => {
            expect(request.characters?.map(({ name }) => name)).toStrictEqual(["Host", "Guest"]);
            expect(request.prompt).toContain("Use only the configured character names as speaker values.");
            return JSON.stringify({
                segments: [
                    { speaker: "Host", text: "Unverified claim" },
                    { speaker: "Guest", text: "Another claim" }
                ]
            });
        });
        const factChecker = vi.fn(async ({ transcript }: PodcastFactCheckRequest) => {
            expect(transcript.segments[0].text).toBe("Unverified claim");
            return {
                passed: true,
                correctedTranscript: {
                    segments: [
                        { speaker: "Host", text: "Verified claim" },
                        { speaker: "Guest", text: "Corrected claim" }
                    ]
                }
            };
        });

        let activeSpeechCalls = 0;
        let maximumActiveSpeechCalls = 0;
        const speechTexts: string[] = [];
        const textToSpeech = vi.fn(async (
            { text }: PodcastTextToSpeechRequest,
            _options?: TextToSpeechOptions
        ) => {
            activeSpeechCalls += 1;
            maximumActiveSpeechCalls = Math.max(maximumActiveSpeechCalls, activeSpeechCalls);
            speechTexts.push(text);
            await Promise.resolve();
            activeSpeechCalls -= 1;
            return new Uint8Array([speechTexts.length]);
        });

        const workflow = new PodcastWorkflow({
            models: { textToText: generator, textToSpeech },
            transcript: { factChecker },
            characters: [
                { name: "Host", voice: "host-voice" },
                { name: "Guest", voice: "guest-voice" }
            ],
            output: { format: "mp3" }
        });

        const result = await workflow.generatePodcast({
            subject: "A test subject",
            description: "A test description"
        });

        expect(generator).toHaveBeenCalledOnce();
        expect(factChecker).toHaveBeenCalledOnce();
        expect(textToSpeech).toHaveBeenCalledTimes(2);
        expect(speechTexts).toStrictEqual(["Verified claim", "Corrected claim"]);
        expect(maximumActiveSpeechCalls).toBe(1);
        expect(result.transcript.segments[0].text).toBe("Verified claim");
        expect(result.output.segments).toHaveLength(2);
        expect(result.output.asset).toBeUndefined();
    });

    it("rejects generated transcript speakers that are not configured characters", async () => {
        const generator = vi.fn(async (_request: PodcastTextToTextRequest) => ({
            segments: [{ speaker: "Narrator", text: "Unknown speaker" }]
        }));
        const workflow = new PodcastWorkflow({
            models: { textToText: generator },
            characters: [{ name: "Host", role: "presenter", voice: "host-voice" }],
            output: { format: "mp3" }
        });

        await expect(workflow.generateTranscript({
            subject: "Subject",
            description: "Description",
            factChecking: false
        })).rejects.toThrow("unconfigured speakers: Narrator");
    });

    it("does not synthesize a transcript that fails fact checking without a correction", async () => {
        const factChecker = vi.fn(async (_request: PodcastFactCheckRequest) => ({
            passed: false,
            issues: ["The claim cannot be verified"]
        }));
        const textToSpeech = vi.fn(async (_request: PodcastTextToSpeechRequest) => new Uint8Array([1]));

        const workflow = new PodcastWorkflow({
            models: { textToSpeech },
            transcript: { factChecker },
            output: { format: "mp3" }
        });

        await expect(workflow.generatePodcast({
            transcript: {
                segments: [{ speaker: "Host", text: "Questionable claim" }]
            }
        })).rejects.toThrow("The claim cannot be verified");
        expect(textToSpeech).not.toHaveBeenCalled();
    });

    it("fact-checks generated transcripts by default and supports opting out", async () => {
        const generator = vi.fn(async (_request: PodcastTextToTextRequest) => ({
            segments: [{ speaker: "Host", text: "Generated transcript" }]
        }));
        const factChecker = vi.fn(async ({ transcript }: PodcastFactCheckRequest) => {
            return {
                passed: true,
                correctedTranscript: {
                    segments: [{
                        speaker: transcript.segments[0].speaker,
                        text: "Fact-checked transcript"
                    }]
                }
            };
        });

        const workflow = new PodcastWorkflow({
            models: { textToText: generator },
            transcript: { factChecker },
            output: { format: "mp3" }
        });

        const checked = await workflow.generateTranscript({
            subject: "Subject",
            description: "Description"
        });
        const unchecked = await workflow.generateTranscript({
            subject: "Subject",
            description: "Description",
            factChecking: false
        });

        expect(factChecker).toHaveBeenCalledOnce();
        expect(checked.segments[0].text).toBe("Fact-checked transcript");
        expect(unchecked.segments[0].text).toBe("Generated transcript");
    });

    it("passes ordered speech segments to an audio composer", async () => {
        const composeAudio = vi.fn(async ({ segments, format }: PodcastAudioCompositionRequest) => {
            expect(format).toBe("wav");
            expect(segments.map((segment) => segment.speaker)).toStrictEqual(["Host", "Guest"]);
            return new Uint8Array([segments.length]);
        });
        const textToSpeech = vi.fn(async ({ text }: PodcastTextToSpeechRequest) => new Uint8Array([text.length]));

        const workflow = new PodcastWorkflow({
            models: { textToSpeech },
            characters: [
                { name: "Host", voice: "host-voice" },
                { name: "Guest", voice: "guest-voice" }
            ],
            output: { format: "wav", composeAudio }
        });

        const result = await workflow.generatePodcast({
            transcript: {
                segments: [
                    { speaker: "Host", text: "First" },
                    { speaker: "Guest", text: "Second" }
                ]
            },
            factChecking: false
        });

        expect(composeAudio).toHaveBeenCalledOnce();
        expect(result.output.asset?.media).toEqual(new Uint8Array([2]));
        expect(result.output.contentType).toBe("audio/wav");
    });

    it("provides a save method for generated assets", async () => {
        const directory = await mkdtemp(join(tmpdir(), "raven-podcast-"));
        try {
            const textToSpeech = vi.fn(async (_request: PodcastTextToSpeechRequest) => (
                new Uint8Array([1, 2, 3])
            ));
            const workflow = new PodcastWorkflow({
                models: { textToSpeech },
                output: { format: "mp3" }
            });

            const result = await workflow.generatePodcast({
                transcript: {
                    segments: [{ speaker: "Host", text: "Save this episode." }]
                },
                factChecking: false
            });
            const asset = result.output.asset;
            const filePath = join(directory, "nested", "episode.mp3");

            expect(asset).toBeDefined();
            await asset!.save(filePath);

            expect(new Uint8Array(await readFile(filePath))).toEqual(new Uint8Array([1, 2, 3]));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("streams speech into a real-time avatar and saves its captured video", async () => {
        const directory = await mkdtemp(join(tmpdir(), "raven-podcast-"));
        try {
            const events: string[] = [];
            const textToSpeech = vi.fn(async ({ text }: PodcastTextToSpeechRequest) => (
                new Uint8Array([text.length])
            ));
            const session: PodcastRealtimeAvatarSession = {
                sendSpeech: vi.fn(async ({ text }) => {
                    events.push(`speech:${text}`);
                }),
                capture: vi.fn(async ({ format }) => {
                    events.push(`capture:${format}`);
                    return new Uint8Array([4, 5, 6]);
                }),
                close: vi.fn(async () => {
                    events.push("close");
                })
            };
            const realtimeAvatar = vi.fn(async ({
                transcript,
                characters
            }: PodcastRealtimeAvatarRequest) => {
                expect(transcript.segments.map(({ speaker }) => speaker)).toStrictEqual(["Host", "Guest"]);
                expect(characters.map(({ name }) => name)).toStrictEqual(["Host", "Guest"]);
                events.push("start");
                return session;
            });
            const filePath = join(directory, "nested", "live-podcast.mp4");
            const workflow = new PodcastWorkflow({
                models: { textToSpeech, realtimeAvatar },
                characters: [
                    { name: "Host", voice: "host-voice", avatarImage: "host.png" },
                    { name: "Guest", voice: "guest-voice", avatarImage: "guest.png" }
                ],
                output: {
                    format: "mp4",
                    composeVideoAudio: false,
                    filePath
                }
            });

            const result = await workflow.generatePodcast({
                transcript: {
                    segments: [
                        { speaker: "Host", text: "Welcome." },
                        { speaker: "Guest", text: "Thanks." }
                    ]
                },
                factChecking: false
            });

            expect(realtimeAvatar).toHaveBeenCalledOnce();
            expect(session.sendSpeech).toHaveBeenCalledTimes(2);
            expect(session.capture).toHaveBeenCalledOnce();
            expect(session.close).toHaveBeenCalledOnce();
            expect(events).toStrictEqual([
                "start",
                "speech:Welcome.",
                "speech:Thanks.",
                "capture:mp4",
                "close"
            ]);
            expect(result.output.filePath).toBe(filePath);
            expect(new Uint8Array(await readFile(filePath))).toEqual(new Uint8Array([4, 5, 6]));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("returns the muxed video asset when video audio composition is enabled", async () => {
        const textToSpeech = vi.fn(async (_request: PodcastTextToSpeechRequest) => (
            new Uint8Array([1, 2, 3])
        ));
        const avatarVideos = vi.fn(async (_request: PodcastAvatarRequest) => (
            new Uint8Array([4, 5, 6])
        ));
        const workflow = new PodcastWorkflow({
            models: { textToSpeech, avatarVideos },
            characters: [{ name: "Host", voice: "host-voice", avatarImage: "host.png" }],
            output: { format: "mp4" }
        });
        const generateSoundtrack = vi.spyOn(workflow, "generateSoundtrack")
            .mockImplementation(async (_speech, outputPath) => {
                await writeFile(outputPath, new Uint8Array([7, 8, 9]));
                return outputPath;
            });
        const combineVideoWithAudio = vi.spyOn(workflow, "combineVideoWithAudio")
            .mockImplementation(async (_video, _soundtrack, outputPath) => {
                await writeFile(outputPath, new Uint8Array([10, 11, 12]));
                return outputPath;
            });

        const result = await workflow.generatePodcast({
            transcript: {
                segments: [{ speaker: "Host", text: "The final video has sound." }]
            },
            factChecking: false
        });

        expect(generateSoundtrack).toHaveBeenCalledOnce();
        expect(combineVideoWithAudio).toHaveBeenCalledOnce();
        expect(result.output.asset?.media).toEqual(new Uint8Array([10, 11, 12]));
    });

    it("uses the supplied soundtrack when combining a direct avatar video", async () => {
        const workflow = new PodcastWorkflow({
            models: {},
            mediaTools: { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" },
            output: { format: "mp4" }
        });
        const privateWorkflow = workflow as unknown as {
            inspectMedia: (filePath: string) => Promise<{ audio: boolean; video: boolean }>;
            runMediaTool: (command: string, argumentsList: string[]) => Promise<string>;
        };
        vi.spyOn(privateWorkflow, "inspectMedia").mockResolvedValue({ audio: true, video: true });
        const runMediaTool = vi.spyOn(privateWorkflow, "runMediaTool").mockResolvedValue("");
        const directory = await mkdtemp(join(tmpdir(), "raven-podcast-"));
        try {
            await workflow.combineVideoWithAudio(
                new Uint8Array([1]),
                new Uint8Array([2]),
                join(directory, "episode.mp4")
            );

            const ffmpegArguments = runMediaTool.mock.calls[0][1];
            expect(ffmpegArguments).toContain("1:a:0");
            expect(ffmpegArguments).not.toContain("0:a:0");
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("runs optional lip sync as a second stage before avatar video generation", async () => {
        const textToSpeech = vi.fn(async ({ text }: PodcastTextToSpeechRequest) => (
            new Uint8Array([text.length])
        ));
        const lipSync = vi.fn(async ({
            character,
            text,
            audio
        }: PodcastLipSyncRequest) => {
            expect(character.name).toBe(text === "Welcome." ? "Host" : "Guest");
            expect(audio).toEqual(new Uint8Array([text.length]));
            return { blendshapes: [text.length, 7] };
        });
        const avatarVideos = vi.fn(async ({
            characters,
            speech,
            lipSync: lipSyncedSegments
        }: PodcastAvatarRequest) => {
            expect(characters.map(({ name }) => name)).toStrictEqual(["Host", "Guest"]);
            expect(speech).toBeUndefined();
            expect(lipSyncedSegments?.map(({ speaker, representation }) => [speaker, representation])).toStrictEqual([
                ["Host", { blendshapes: [8, 7] }],
                ["Guest", { blendshapes: [7, 7] }]
            ]);
            return new Uint8Array([9]);
        });

        const workflow = new PodcastWorkflow({
            models: { textToSpeech, lipSync, avatarVideos },
            characters: [
                { name: "Host", voice: "host-voice", avatarImage: "host.png" },
                { name: "Guest", voice: "guest-voice", avatarImage: "guest.png" }
            ],
            output: { format: "mp4", composeVideoAudio: false }
        });

        const result = await workflow.generatePodcast({
            transcript: {
                segments: [
                    { speaker: "Host", text: "Welcome." },
                    { speaker: "Guest", text: "Thanks." }
                ]
            },
            factChecking: false
        });

        expect(lipSync).toHaveBeenCalledTimes(2);
        expect(avatarVideos).toHaveBeenCalledOnce();
        expect(result.lipSync).toHaveLength(2);
        expect(result.output.asset?.media).toEqual(new Uint8Array([9]));
    });
});
