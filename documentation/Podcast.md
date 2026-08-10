# Podcast Workflow

## Contents

- [Overview](#overview)
- [How the workflow works](#how-the-workflow-works)
- [Configuration](#configuration)
- [Methods](#methods)
  - [constructor](#constructor)
  - [generateTranscript](#generatetranscript)
  - [generatePodcast](#generatepodcast)
  - [Private pipeline methods](#private-pipeline-methods)
- [Usage recipes](#usage-recipes)
- [fal.ai configuration](#falai-configuration)
- [Output behavior and requirements](#output-behavior-and-requirements)
	- [Saving generated assets](#saving-generated-assets)
- [Troubleshooting](#troubleshooting)

## Overview

`PodcastWorkflow` is the provider-agnostic orchestration layer for turning a subject or an existing transcript into an audio or video podcast. It coordinates the following model capabilities:

- Text-to-text generation for a transcript.
- Fact checking and optional transcript correction.
- Text-to-speech generation for every transcript segment.
- Optional character image generation.
- Optional per-segment lip-sync generation from speech audio and character images.
- Avatar video generation for video output.
- Optional audio composition for a single multi-speaker audio file.
- Optional materialization of the generated media to a local file.

The workflow does not call fal.ai, OpenAI, or another provider directly. Each provider is supplied as a callback or an existing Raven ADK model object. This keeps the workflow independent from provider-specific request and response formats.

## Benefits

Using `PodcastWorkflow` provides an orchestration layer around the standalone APIs that generate text, speech, images, and video:

- **One end-to-end workflow:** Generate or accept a transcript, fact-check it, synthesize speech, compose multi-speaker audio, and create avatar video through one consistent entry point.
- **Provider flexibility:** Replace a text, speech, image, avatar, or fact-checking provider without rewriting the podcast pipeline. Providers are connected through Raven ADK callbacks or model contracts instead of provider-specific calls throughout the application.
- **Reliable sequencing:** Transcript segments are converted to speech in order, with each speaker matched to the configured character and voice. Standalone API calls would otherwise require the application to coordinate ordering and speaker metadata itself.
- **Built-in transcript quality controls:** Transcripts are validated and fact-checked by default, with support for corrected transcripts and an explicit opt-out for fictional or intentionally unverified content.
- **Consistent media handling:** URLs, local paths, binary data, asynchronous iterables, and readable streams are normalized through the same workflow. The application can keep generated media in memory and save it later with `output.asset.save(...)`, or configure `output.filePath` for automatic writing.
- **Safe multi-segment output:** The workflow does not pretend that concatenating independent compressed audio responses creates a valid episode. Configure `composeAudio` when a real combined audio file is required, or consume the ordered segments individually.
- **Shared cancellation and error behavior:** Abort signals and validation rules are applied across the generation stages, so callers do not need to implement separate lifecycle and failure handling for every standalone API request.

## How the workflow works

The complete `generatePodcast()` path is:

1. Check the optional `AbortSignal` before starting generation.
2. Select the source transcript: validate `request.transcript` when one is supplied, or call `generateTranscript()` with `factChecking: false` when the transcript must be generated from `subject` and `description`.
3. Fact-check the selected transcript unless `request.factChecking` is exactly `false`; use a returned `correctedTranscript` for all remaining stages.
4. Convert each transcript segment to speech sequentially with `transcriptToSpeech()`, matching each speaker to its configured character and voice.
5. For video output, optionally call `models.lipSync` once per speech segment to convert the generated voice audio into a provider-defined facial-motion representation.
6. Build the configured output with `createOutput()`.
7. For `mp3` or `wav`, use the one speech asset directly or call `composeAudio` to combine multiple ordered speech segments.
8. For `mp4` or `webm`, resolve character images, pass the optional Stage 1 motion representations to `avatarVideos`, and use its returned Stage 2 video asset.
9. Wrap the final provider asset in a saveable `PodcastGeneratedAsset`. When `output.filePath` is configured, also materialize the asset to bytes, create the parent directory, and write the file; otherwise keep the asset or ordered speech segments in memory.
10. Return a `PodcastGenerationResult` containing the transcript, ordered speech segments, optional lip-sync segments, and output metadata.

There are two important fact-checking rules:

1. Fact checking is enabled by default. Both public generation methods use fact checking unless the call contains `factChecking: false`.
2. When `generatePodcast()` creates the transcript internally, it calls `generateTranscript()` with fact checking temporarily disabled and then performs one fact-checking pass at the podcast level. The same transcript is therefore not checked twice.

If fact checking is enabled and `config.transcript.factChecker` is missing, the workflow throws an error. Configure a checker or explicitly pass `factChecking: false` for a call that does not need fact checking.

## Configuration

Create a workflow with a `PodcastWorkflowConfig` object. The `output` property is required; model properties are selected according to the output and the method being called.

```typescript
import { PodcastWorkflow } from "@ravenlens/raven-adk";

const workflow = new PodcastWorkflow({
	models: {
		textToText: generateText,
		textToSpeech: generateSpeech,
		textToImage: generateCharacterImage,
		avatarVideos: generateAvatarVideo
	},
	transcript: {
		generator: generateText,
		factChecker: checkFacts,
		targetDurationSeconds: 300,
		priorFragments: []
	},
	characters: [
		{
			name: "Host",
			voice: "host-voice",
			avatarImage: "https://example.com/host.png"
		}
	],
	backgroundImage: "https://example.com/studio-background.png",
	output: {
		format: "mp4",
		filePath: "./output/podcast.mp4"
	}
});
```

### The `models` object

| Property | Used by | What it must do |
| --- | --- | --- |
| `textToText` | `generateTranscript()` when `transcript.generator` is not set | Generate transcript text or a `PodcastTranscript`. It may be a callback, `StandardLLMShema`, or `ReActAgent`. |
| `textToSpeech` | Every podcast generation | Synthesize one transcript segment at a time. It may be a callback or a Raven ADK `TextToSpeechModel`. |
| `textToImage` | Video output when a character has no `avatarImage` | Generate one image asset for a character. |
| `lipSync` | Video output when configured. Some video models do not consume voice audio | Stage 1: convert one generated speech segment into provider-defined facial motion, such as landmarks, 3DMM coefficients, or latent embeddings. |
| `avatarVideos` | `mp4` and `webm` output | Stage 2: render or assemble the final avatar video from the transcript, characters, motion representations, and optional background. Direct avatar paths without `lipSync` may also receive speech. |

### The `transcript` object

`transcript.generator` takes precedence over `models.textToText`. It receives a `PodcastTextToTextRequest` containing:

- `prompt`: the generated podcast prompt.
- `characters`: the configured characters, including their names and optional roles.
- `priorFragments`: configured previous transcript fragments.
- `targetDurationSeconds`: the configured target duration.

When characters are configured, the prompt instructs the generator to use their exact names as transcript speaker values. Generated transcripts with an unconfigured speaker are rejected before speech synthesis so voice and avatar selection cannot silently fall back to an unspecified character.

`transcript.factChecker` is required for the default fact-checking behavior. It receives:

```typescript
type PodcastFactCheckRequest = {
	transcript: {
		segments: Array<{
			speaker: string;
			text: string;
			startTime?: number;
			endTime?: number;
		}>;
		text?: string;
	};
};
```

The checker must return an object with a boolean `passed` property. It may also return `issues` and a `correctedTranscript`.

### Characters and transcript speakers

Each `PodcastTranscriptSegment.speaker` is matched to `PodcastCharacter.name` using an exact string match. For reliable voice and avatar selection, use the same names in both places.

```typescript
const transcript = {
	segments: [
		{ speaker: "Host", text: "Welcome to the episode." },
		{ speaker: "Guest", text: "Thanks for having me." }
	]
};

const characters = [
	{ name: "Host", role: "presenter", voice: "host-voice", avatarImage: "https://example.com/host.png" },
	{ name: "Guest", role: "subject-matter expert", voice: "guest-voice", avatarImage: "https://example.com/guest.png" }
];
```

The optional `role` is included in transcript-generation instructions. It helps the text model assign the right lines to each configured character; the exact `name` is still the value used for voice and avatar matching.

For audio output, an unknown speaker can still be sent to the TTS provider without a matching character, but the provider will not receive a configured `voice`. For avatar output, every speaker must have a configured character with a voice and either an `avatarImage` or a configured `textToImage` model.

### Provider return values

The provider callbacks are designed to accept common asynchronous return shapes:

- A direct value.
- A promise of a value.
- An async iterable or `ReadableStream`.
- Text, a transcript object, a URL, a local file path, or binary `Uint8Array` media, depending on the stage.

The workflow resolves supported streams before normalizing the transcript or writing a file. It does not combine separate compressed audio files by simply joining their bytes; use `output.composeAudio` to create one valid multi-segment audio file.

## Methods

### `constructor`

```typescript
new PodcastWorkflow(config: PodcastWorkflowConfig)
```

#### What it does

The constructor stores the supplied configuration on the workflow. It does not generate text, call a provider, create an image, synthesize audio, or write a file.

#### Step by step

1. Receive the model, transcript, character, background, and output configuration.
2. Store the configuration as `workflow.config`.
3. Wait for a public method to start the generation pipeline.

#### When to use it

Instantiate one workflow for a consistent podcast configuration, then reuse it for multiple subjects or transcripts. Create a new workflow when the providers, characters, output format, or output destination change.

### `generateTranscript`

```typescript
await workflow.generateTranscript({
	subject: string,
	description: string,
	instruction?: string,
	factChecking?: boolean,
	signal?: AbortSignal
}): Promise<PodcastTranscript>
```

#### What it does

`generateTranscript()` is the transcript-only entry point. It generates and validates a transcript and, by default, sends it through the configured fact checker. It does not synthesize speech, generate avatars, compose audio, or write output files.

#### Step by step

1. Trim `subject` and `description`.
2. Throw if either required value is empty.
3. Select `transcript.generator`, falling back to `models.textToText`.
4. Build a prompt containing the subject, description, optional instruction, configured character names and roles, JSON output shape, and target duration guidance.
5. Pass `characters`, `priorFragments`, and `targetDurationSeconds` to callback-based text models.
6. Invoke the callback or call `.invoke()` on an invokable model.
7. Resolve promises and supported streams.
8. Normalize the model response. Structured transcript objects are used directly; JSON text is parsed; plain text becomes one segment assigned to the first configured character or the default speaker `Host`.
9. Validate that the transcript contains at least one non-empty segment.
10. Fact-check the validated transcript unless `factChecking` is exactly `false`.
11. If the checker returns a `correctedTranscript`, validate it and return it in place of the original transcript.
12. Verify that generated speaker names match configured character names when characters are configured.
13. If the checker returns `passed: false` without a correction, throw an error containing the reported issues.

#### When to use it

Use `generateTranscript()` when you need to inspect, edit, save, or approve the transcript before generating speech. Its result can be passed to `generatePodcast()` later.

```typescript
const transcript = await workflow.generateTranscript({
	subject: "The history of renewable energy",
	description: "Explain the major milestones in a five-minute episode.",
	instruction: "Use two speakers and keep the tone accessible."
});

// The returned transcript has already been fact-checked by default.
console.log(transcript.segments);
```

Use the explicit opt-out for fictional or intentionally unverified content:

```typescript
const fictionalTranscript = await workflow.generateTranscript({
	subject: "A fictional city on Mars",
	description: "Create a short fictional conversation between two explorers.",
	factChecking: false
});
```

### `generatePodcast`

```typescript
await workflow.generatePodcast({
	transcript?: PodcastTranscript,
	subject?: string,
	description?: string,
	instruction?: string,
	factChecking?: boolean,
	signal?: AbortSignal
}): Promise<PodcastGenerationResult>
```

#### What it does

`generatePodcast()` is the complete end-to-end entry point. It accepts an existing transcript or generates one from a subject and description, then creates speech and the configured audio or video output.

#### Step by step

1. Check the optional abort signal.
2. If `request.transcript` exists, validate it and use it as the source transcript.
3. Otherwise, call `generateTranscript()` with the subject, description, and instruction. Internal transcript fact checking is disabled at this step so the complete method can perform one top-level check.
4. Fact-check the source transcript unless `factChecking` is exactly `false`.
5. Use the corrected transcript, if the checker returned one, for every following stage.
6. Convert the transcript segments to speech sequentially. The exact speaker name selects the matching character and voice.
7. For video output with `models.lipSync`, generate one Stage 1 motion representation per speech segment.
8. Select the output path based on `output.format`:
   - `mp3` or `wav`: use one segment directly or call `composeAudio` for multiple segments.
	- `mp4` or `webm`: resolve character images, pass optional motion representations to `avatarVideos`, and invoke it for Stage 2 video generation or assembly.
9. If `output.filePath` is configured, resolve the final asset to bytes, create its parent directory, and write the file.
10. Return the corrected or original transcript, ordered speech segments, optional lip-sync segments, and generated output metadata. When a single final asset exists, `output.asset` exposes the provider media through `media` and can save it with `save(filePath)`.

#### When to use it

Use `generatePodcast()` when you want the complete generation pipeline in one call.

Generate a transcript and then pass it into the pipeline:

```typescript
const transcript = await workflow.generateTranscript({
	subject: "Renewable energy",
	description: "Explain the history and current technologies."
});

const result = await workflow.generatePodcast({
	transcript,
	// The transcript was checked by the previous call, so avoid a second pass.
	factChecking: false
});

await result.output.asset?.save("./output/episode.mp3");
```

Generate everything in one call:

```typescript
const result = await workflow.generatePodcast({
	subject: "Renewable energy",
	description: "Explain the history and current technologies in five minutes.",
	instruction: "Label every speaker clearly."
});
```

The returned result has this shape:

```typescript
{
	transcript: PodcastTranscript;
	speech: PodcastSpeechSegment[];
	lipSync?: PodcastLipSyncSegment[];
	output: {
		format: "mp3" | "wav" | "mp4" | "webm";
		contentType: string;
		asset?: PodcastGeneratedAsset;
		segments?: PodcastSpeechSegment[];
		filePath?: string;
	};
}
```

`PodcastGeneratedAsset.media` is the original provider media, such as a URL, local path, binary value, or stream. Use `save()` when the generated result was kept in memory:

```typescript
const result = await workflow.generatePodcast({
	subject: "Renewable energy",
	description: "Explain the history and current technologies.",
	factChecking: false
});

await result.output.asset?.save("./output/episode.mp3");
```

`output.filePath` remains supported when generation should write the final file automatically.

### Private pipeline methods

These methods are implementation details and cannot be called directly. They are listed here because they explain what happens after a public method starts the workflow.

#### `transcriptToSpeech`

**Role:** Convert every transcript segment into a `PodcastSpeechSegment`.

**Steps:**

1. Validate the transcript.
2. Require `models.textToSpeech`.
3. Select `wav` only when the configured output format is `wav`; all other output formats request `mp3` speech.
4. Iterate through transcript segments in order.
5. Match each segment speaker to a character by exact name.
6. Call the function adapter or `textToSpeech.synthesize()` with the segment text, voice, output format, and abort signal.
7. Append the result with the original speaker and timing metadata.

Calls are intentionally sequential. This preserves speech order and prevents overlapping provider calls from changing the order in which segments are produced.

#### `factCheckTranscript`

**Role:** Validate factual claims and optionally replace the transcript with a corrected version.

**Steps:**

1. Require `config.transcript.factChecker`.
2. Build a JSON-oriented fact-check prompt for invokable models.
3. Invoke the callback or model with the transcript and abort signal.
4. Resolve the response and parse an object with boolean `passed`.
5. Validate `correctedTranscript` when one is returned.
6. Return the corrected transcript when provided.
7. Throw when `passed` is false and no correction is available.

Use the public `factChecking` option to control this stage; do not try to call this private method directly.

#### `generateLipSync`

**Role:** Convert each generated speech segment into a facial-motion representation for its configured character.

The optional `models.lipSync` callback receives a `PodcastLipSyncRequest` containing:

```typescript
{
	transcript: PodcastTranscript;
	text: string;
	audio: PodcastMedia;
	speech: PodcastSpeechSegment;
	character: PodcastCharacter;
}
```

The workflow calls the model sequentially in transcript order and returns the results as `result.lipSync`. The model is responsible for uploading binary or streamed audio when its provider requires a URL, and for returning one provider-defined motion representation per request. It does not render the final video.

#### `createOutput`

**Role:** Turn ordered speech into the configured audio or video output.

**Audio steps (`mp3` and `wav`):**

1. If there is one speech segment, use its audio directly.
2. If there are multiple segments and `composeAudio` exists, pass the original transcript and ordered speech segments to the composer.
3. If there are multiple segments and no composer exists, return the ordered segments without pretending they are one valid audio file.
4. If `filePath` is configured for multiple segments without a composer, throw because the workflow cannot safely create one audio file.

**Video steps (`mp4` and `webm`):**

1. Require `models.avatarVideos`.
2. Resolve one character for every unique transcript speaker.
3. If `models.lipSync` is configured, generate one Stage 1 motion representation per speech segment.
4. Pass the transcript, resolved characters, optional motion representations, and background image to the Stage 2 avatar provider. When representations are present, omit speech audio so the video model remains voice-independent.
5. Complete the output as an asset or local file.

#### `resolveAvatarCharacters`

**Role:** Prepare the character data required by an avatar provider.

**Steps:**

1. Collect unique speaker names from the transcript.
2. Find a configured character for each speaker.
3. Require a voice for every video character.
4. Reuse `avatarImage` when it is already configured.
5. Otherwise require `models.textToImage` and request a portrait for the character.
6. Normalize the generated image to one URL or binary asset.

Use `avatarImage` when you already have stable character art. Configure `textToImage` when the workflow should create missing portraits.

#### `completeOutput`

**Role:** Add output metadata and optionally write the final media to disk.

**Steps:**

1. Return a `PodcastGeneratedAsset` containing the provider asset and content type immediately when no `filePath` is configured.
2. Materialize the asset to `Uint8Array` when a path is configured.
3. Create the parent directory recursively.
4. Write the bytes to the requested path.
5. Return the materialized bytes in a `PodcastGeneratedAsset`, together with the content type, format, and `filePath`.

#### `materializeMedia`

**Role:** Convert supported media forms into bytes for file output.

**Supported behavior:**

- A `Uint8Array` is returned directly.
- A stream is collected before processing.
- An array containing binary chunks is combined in order.
- An `http`, `https`, or `data` URL is fetched.
- Any other string is treated as a local file path.

The method rejects unsupported values and streams that contain non-binary chunks.

#### `resolveSingleAsset`

**Role:** Normalize one image result.

It accepts a URL string, a `Uint8Array`, or an array containing exactly one of those values. It rejects multiple or unsupported image results because one character needs one image asset.

#### `resolveModelValue`

**Role:** Await provider output and collect asynchronous streams.

It first awaits the value, then collects either an async iterable or a `ReadableStream`. Direct values pass through unchanged.

#### `normalizeTranscript`

**Role:** Convert common text-model response shapes into `PodcastTranscript`.

**Steps:**

1. Unwrap a string `output` property when present.
2. Use an object that already has a `segments` array.
3. Extract readable text from strings, arrays, `content`, `structuredOutput`, `messages`, or `answer` responses.
4. Parse JSON when possible.
5. Fall back to one segment with the first configured character as speaker, or `Host` when no character is configured.

#### `parseFactCheckResult`

**Role:** Convert a fact-checker response into `PodcastFactCheckResult`.

It accepts a direct object or JSON text extracted from an `output`, `content`, structured output, message, or answer response. It rejects results without a boolean `passed` property.

#### `extractModelText`

**Role:** Read text from the common response shapes used by text models.

It handles strings, arrays of chunks, `output`, `content`, `structuredOutput`, the last message, and the last answer. It throws when no readable text can be found.

#### `validateTranscript`

**Role:** Enforce the transcript invariants used by speech and video providers.

It requires at least one segment. Every segment must contain non-empty `speaker` and `text` strings. Optional `startTime` and `endTime` values must be non-negative, and `endTime` must be greater than `startTime` when both are present.

#### `throwIfAborted`

**Role:** Stop work when the caller's `AbortSignal` has already been aborted.

The signal is checked before generation, before each speech segment, and before generated avatar images. Provider adapters also receive the signal where their callback contract supports options.

## Usage recipes

### Transcript-only generation

Use this when a human or another system must review the script before audio generation.

```typescript
const transcript = await workflow.generateTranscript({
	subject: "The history of computing",
	description: "Create an educational five-minute transcript.",
	instruction: "Use a host and a guest."
});
```

### Existing transcript to podcast

Use this when the script already exists or was produced by another system.

```typescript
const result = await workflow.generatePodcast({
	transcript: {
		segments: [
			{ speaker: "Host", text: "Welcome." },
			{ speaker: "Guest", text: "Thank you." }
		]
	},
	factChecking: false
});
```

Set `factChecking: true` or omit the option when an existing transcript should be checked before speech synthesis.

### Multiple speakers and composed audio

The workflow creates one speech segment per transcript segment. Configure `composeAudio` when the final result must be one playable file:

```typescript
const workflow = new PodcastWorkflow({
	models: {
		textToSpeech: generateSpeech
	},
	characters: [
		{ name: "Host", voice: "host-voice" },
		{ name: "Guest", voice: "guest-voice" }
	],
	output: {
		format: "wav",
		composeAudio: async ({ segments }) => {
			return composeWavSegments(segments);
		},
		filePath: "./output/episode.wav"
	}
});
```

Without `composeAudio`, a multi-segment audio request returns `output.segments`. It does not return a single `output.asset` because concatenating independent MP3 or WAV files as raw bytes does not reliably produce a valid file.

### Two-stage lip-sync video

Configure `models.lipSync` when the Stage 2 video model does not consume voice audio directly. The workflow separates audio-to-motion alignment from video synthesis:

```text
[TTS Audio] ──> (Stage 1: lip-sync model) ──> [Facial Motion Representation]
														   │
[Character Image / Base Video] ────────────────────────────┴──> (Stage 2: avatarVideos) ──> [Avatar Video]
```

1. **Stage 1 (audio to representation):** `models.lipSync` receives the generated speech audio and returns provider-defined motion data such as landmarks, 3DMM facial blendshapes, or latent facial-motion embeddings.
2. **Stage 2 (representation to video):** `models.avatarVideos` receives the transcript, resolved character assets, and the Stage 1 representations, then renders or assembles the synchronized avatar video without needing the speech audio.

The workflow first creates one speech asset per transcript segment, calls Stage 1 sequentially in transcript order, stores the representations in `result.lipSync`, and passes them to Stage 2. Neither stage is forced to use a provider-specific upload or representation format.

```typescript
const workflow = new PodcastWorkflow({
	models: {
		textToSpeech: generateSpeech,
		lipSync: async ({ character, audio }) => {
			const audioUrl = await uploadToProvider(audio);
			return generateFacialMotion({ audioUrl, character: character.name });
		},
		avatarVideos: async ({ characters, lipSync }) => {
			return renderVideoFromMotion({
				characters,
				segments: lipSync?.map(({ speaker, representation }) => ({ speaker, representation })) ?? []
			});
		}
	},
	characters: [
		{ name: "Host", role: "presenter", voice: "host-voice", avatarImage: "host.png" },
		{ name: "Guest", role: "guest expert", voice: "guest-voice", avatarImage: "guest.png" }
	],
	output: { format: "mp4" }
});

const result = await workflow.generatePodcast({
	transcript: {
		segments: [
			{ speaker: "Host", text: "Welcome to the episode." },
			{ speaker: "Guest", text: "Thanks for having me." }
		]
	},
	factChecking: false
});

console.log(result.lipSync?.map(({ speaker, representation }) => ({ speaker, representation })));
await result.output.asset?.save("./output/episode.mp4");
```

`uploadToProvider`, `generateFacialMotion`, and `renderVideoFromMotion` are provider-specific adapter functions. The workflow keeps the text-to-speech audio and speaker-to-character mapping aligned; the adapters decide how to upload media, encode motion representations, condition the Stage 2 video model with the character image or base video, and compose the final result.

### Video with existing avatar images

Use this when every speaker already has a portrait:

```typescript
const workflow = new PodcastWorkflow({
	models: {
		textToSpeech: generateSpeech,
		avatarVideos: generateAvatarVideo
	},
	characters: [
		{
			name: "Host",
			voice: "host-voice",
			avatarImage: "https://example.com/host.png"
		}
	],
	output: {
		format: "mp4",
		filePath: "./output/episode.mp4"
	}
});
```

### Video with generated avatar images

Omit a character's `avatarImage` and configure `models.textToImage`. The workflow generates a portrait prompt for that character, then passes the resolved image to `avatarVideos`.

## fal.ai configuration

The podcast contracts are provider agnostic, so fal.ai is connected by wrapping each fal endpoint in a callback. Run this code in a server-side process or job. Do not expose `FAL_KEY` in browser code.

### Install and configure credentials

```bash
npm install @fal-ai/client
```

```powershell
$env:FAL_KEY = "your-fal-key"
```

The example below follows the fal.ai configuration from `src/podcast/README.md`:

| Podcast stage | fal.ai endpoint | Output used by the workflow |
| --- | --- | --- |
| Transcript and fact checking | [`fal-ai/any-llm`](https://fal.ai/models/fal-ai/any-llm) with a Google or other supported model | Text |
| Text to speech | [`fal-ai/kling-video/v1/tts`](https://fal.ai/models/fal-ai/kling-video/v1/tts) | MP3 URL |
| Character image | [`fal-ai/flux/schnell`](https://fal.ai/models/fal-ai/flux/schnell) | Image URL |
| Stage 1 audio-to-motion | Provider-specific adapter | Facial-motion representation |
| Stage 2 motion-to-video | Provider-specific conditioned video adapter | MP4 URL |

### Complete fal.ai adapter example

```typescript
import { fal } from "@fal-ai/client";
import {
	PodcastWorkflow,
	type PodcastAvatarRequest,
	type PodcastFactCheckRequest,
	type PodcastFactCheckResult,
	type PodcastImageRequest,
	type PodcastLipSyncRequest,
	type PodcastLipSyncRepresentation,
	type PodcastTextToSpeechRequest,
	type PodcastTextToTextRequest,
	type PodcastTranscript,
	type PodcastWorkflowConfig
} from "@ravenlens/raven-adk";

const falKey = process.env.FAL_KEY;
if (!falKey) {
	throw new Error("FAL_KEY is required");
}

fal.config({ credentials: falKey });

type FalTextResult = {
	output: string;
};

type FalAudioResult = {
	audio: {
		url: string;
	};
};

type FalImageResult = {
	images: Array<{
		url: string;
	}>;
};

type FalMotionResult = {
	representation: PodcastLipSyncRepresentation;
};

function transcriptText(transcript: PodcastTranscript): string {
	return transcript.text ?? transcript.segments
		.map((segment) => `${segment.speaker}: ${segment.text}`)
		.join("\n");
}

async function generateText({ prompt }: PodcastTextToTextRequest): Promise<string> {
	const result = await fal.subscribe("fal-ai/any-llm", {
		input: {
			model: "google/gemini-pro-1.5",
			prompt
		}
	});

	return (result.data as FalTextResult).output;
}

async function checkFacts({ transcript }: PodcastFactCheckRequest): Promise<PodcastFactCheckResult> {
	const result = await fal.subscribe("fal-ai/any-llm", {
		input: {
			model: "google/gemini-pro-1.5",
			prompt: [
				"Check the following podcast transcript for factual claims.",
				"Return only JSON matching { passed: boolean, issues?: string[] }.",
				transcriptText(transcript)
			].join("\n\n")
		}
	});

	return JSON.parse((result.data as FalTextResult).output) as PodcastFactCheckResult;
}

async function synthesizeAudioUrl({ text, character }: PodcastTextToSpeechRequest): Promise<string> {
	const result = await fal.subscribe("fal-ai/kling-video/v1/tts", {
		input: {
			text,
			voice_id: character?.voice ?? "reader_en_m-v1",
			voice_speed: 1
		}
	});

	return (result.data as FalAudioResult).audio.url;
}

async function generateSpeech(request: PodcastTextToSpeechRequest): Promise<Uint8Array> {
	const response = await fetch(await synthesizeAudioUrl(request));
	if (!response.ok) {
		throw new Error(`Unable to download generated audio: ${response.status}`);
	}

	return new Uint8Array(await response.arrayBuffer());
}

async function generateCharacterImage({ prompt }: PodcastImageRequest): Promise<string> {
	const result = await fal.subscribe("fal-ai/flux/schnell", {
		input: {
			prompt,
			image_size: "portrait_4_3",
			output_format: "png"
		}
	});
	const image = (result.data as FalImageResult).images[0];
	if (!image) {
		throw new Error("fal.ai did not return a character image");
	}

	return image.url;
}

async function generateLipSync({
	character,
	audio
}: PodcastLipSyncRequest): Promise<PodcastLipSyncRepresentation> {
	const audioUrl = await uploadToProvider(audio);
	const result = await callAudioToMotionProvider({
		audioUrl,
		character: character.name
	});

	return (result.data as FalMotionResult).representation;
}

async function generateAvatar({ characters, lipSync }: PodcastAvatarRequest): Promise<string> {
	const segments = lipSync?.map(({ speaker, representation }) => {
		const character = characters.find(({ name }) => name === speaker);
		if (!character || typeof character.avatarImage !== "string") {
			throw new Error(`A provider avatarImage URL is required for ${speaker}`);
		}

		return {
			speaker,
			imageUrl: character.avatarImage,
			representation
		};
	}) ?? [];
	if (segments.length === 0) {
		throw new Error("No Stage 1 motion representations were provided");
	}

	return renderVideoFromMotion(segments);
}

async function createPodcastWorkflow(): Promise<PodcastWorkflow> {
	const hostImage = await generateCharacterImage({
		prompt: "A friendly professional podcast host, head and shoulders portrait, studio lighting, neutral background"
	});

	const config: PodcastWorkflowConfig = {
		models: {
			textToText: generateText,
			textToSpeech: generateSpeech,
			textToImage: generateCharacterImage,
			lipSync: generateLipSync,
			avatarVideos: generateAvatar
		},
		transcript: {
			generator: generateText,
			factChecker: checkFacts,
			targetDurationSeconds: 300,
			priorFragments: []
		},
		characters: [
			{
				name: "Host",
				voice: "reader_en_m-v1",
				avatarImage: hostImage
			}
		],
		backgroundImage: "https://example.com/podcast-studio-background.jpg",
		output: {
			format: "mp4",
			filePath: "./output/podcast.mp4"
		}
	};

	return new PodcastWorkflow(config);
}

async function main(): Promise<void> {
	const workflow = await createPodcastWorkflow();
	const result = await workflow.generatePodcast({
		subject: "The history of renewable energy",
		description: "A five-minute conversation explaining the key milestones and current technologies.",
		instruction: "Use the prior fragments when extending the episode and label every speaker clearly."
	});

	console.log(result.output);
}

void main();
```

The adapter uses the following sequence:

1. `generateText` calls `fal-ai/any-llm` to generate transcript text.
2. `checkFacts` calls the same endpoint and converts its JSON text into `PodcastFactCheckResult`.
3. `synthesizeAudioUrl` calls Kling TTS and returns the hosted MP3 URL.
4. `generateSpeech` downloads that URL because the workflow's TTS callback returns binary audio.
5. `generateCharacterImage` calls FLUX and returns one image URL.
6. `generateLipSync` uploads the generated audio and calls the provider-specific Stage 1 audio-to-motion adapter.
7. `generateAvatar` passes each character image and Stage 1 representation to the provider-specific Stage 2 video adapter.
8. `generatePodcast` writes the returned MP4 bytes to `./output/podcast.mp4` because `filePath` is configured.

For a production adapter, keep a hosted URL when the next provider accepts a URL, or upload binary data to provider storage before passing it to another endpoint. For multiple characters, keep one entry per speaker in `characters` and adapt `generateAvatar` to render each character or transcript segment from its base image and Stage 1 representation. The workflow does not assume that the Stage 2 video model accepts voice audio.

## Output behavior and requirements

### Audio output

Use `mp3` or `wav` when the result should be an audio podcast.

- One transcript segment: its speech asset becomes `output.asset`.
- Multiple transcript segments with `composeAudio`: the composer creates `output.asset`.
- Multiple transcript segments without `composeAudio`: the result contains ordered `output.segments` instead of a combined asset.
- Multiple transcript segments with `filePath` but without `composeAudio`: the workflow throws because it cannot create one valid file.

The workflow requests MP3 speech for `mp3`, `mp4`, and `webm` configurations, and WAV speech only for `wav` configuration.

### Video output

Use `mp4` or `webm` when the result should contain avatar video.

The configuration must provide `models.avatarVideos`. Every unique speaker must have a character with a voice and either an existing `avatarImage` or a usable `models.textToImage` model. Add `models.lipSync` when the Stage 2 video model needs separate audio-driven motion representations. The staged representations are returned in `result.lipSync` and passed to `avatarVideos`.

### Local files and remote assets

When `output.filePath` is absent, `output.asset` keeps the provider asset, such as a URL or binary value, in its `media` property. Calling `output.asset.save(filePath)` resolves remote URLs with `fetch`, reads local paths with the filesystem, collects binary streams, and writes the final bytes. When `output.filePath` is present, the workflow performs the same materialization and write automatically.

### Saving generated assets

Use the saveable asset when generation should remain in memory until the caller chooses a destination:

```typescript
const result = await workflow.generatePodcast({
	transcript,
	factChecking: false
});

if (result.output.asset) {
	await result.output.asset.save("./output/episode.mp3");
}
```

The `save()` method creates missing parent directories and supports the same URLs, local paths, binary values, and streams accepted by the workflow. Multi-segment audio without `composeAudio` still returns ordered `output.segments` rather than one saveable asset.

### Cancellation

Pass an `AbortSignal` to either public method:

```typescript
const controller = new AbortController();

const generation = workflow.generatePodcast({
	subject: "A long episode",
	description: "Explain the subject in detail.",
	signal: controller.signal
});

controller.abort();
await generation;
```

`generatePodcast()` checks the signal before starting. The workflow checks it before each speech segment and before generated avatar images, while `generateTranscript()` forwards it to the configured text generator. Provider callbacks receive the signal through their options when the callback contract supports it.

## Troubleshooting

### `Podcast factChecker is required when factChecking is enabled.`

Fact checking defaults to enabled. Add `transcript.factChecker` to the workflow configuration or pass `factChecking: false` for that call.

### `Podcast transcript generator is required.`

Add `transcript.generator` or `models.textToText` before calling `generateTranscript()` or calling `generatePodcast()` without an existing transcript.

### `Podcast textToSpeech model is required.`

Add `models.textToSpeech`. Speech is required for both audio and avatar video output.

### `Podcast avatarVideos model is required for ... output.`

The configured output is `mp4` or `webm`. Add `models.avatarVideos`, or change the output format to `mp3` or `wav` when video is not needed.

### Lip-sync representations are missing from the avatar request

Configure `models.lipSync`. The workflow only creates `result.lipSync` when the optional Stage 1 model is configured; `avatarVideos` must still render or assemble the final output from the supplied transcript, speech, characters, and motion representations.

### `No character is configured for speaker ...`

Add a `characters` entry whose `name` exactly matches the transcript segment's `speaker` value. This is required for avatar output.

### `composeAudio is required to write multiple speech segments to one audio file.`

Configure `output.composeAudio`, or omit `output.filePath` and consume the ordered `output.segments` yourself.

### Fact checking runs twice

When a transcript was already generated and checked with `generateTranscript()`, pass that transcript to `generatePodcast()` with `factChecking: false`. A single `generatePodcast()` call does not perform duplicate checking for its internally generated transcript.
