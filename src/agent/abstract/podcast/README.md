# Podcast
Unified way to generate better podcasts for either sppech and with one or multiple VoiceLiveAvatars

## Benefits
- Use **ReActAgent** to generate the transcript, check the factual correcteness with `FactChecker` and then make the voice out of it
- Models unified - use unififed call interface for text-to-text, text-to-speech, text-to-image and avatar models. Use OpenAI api or HTTP/Websocket call with helpers
- Extend lenght - use Agent with access to prior fragments, duration and transcript to make the larger content
<!-- - Generate avatar image - use agent to generate avatar image from what will be generated avatar -->

## Requirements
- Models Agnostic - use whatever model to generate the outcome - relies on the functions and functions returns the outcome
    - Provider has to return the stream and the stream or the 
- Avatar models - access to avatar models can generate either single user output or multiple characters output
<!-- - Image models - can generate the avatar user -->
- Voice and avatar syncing - avatar with specified name has to talk with specified face and voice - to not confuse roles on video
- Optional lip-sync stage - use generated speech audio and the matching character image when the avatar model cannot render directly from the transcript
- Result has to be the .mp4/.wav/.webm file for the video or the .mp3 for the voice records

## Layers
- Models - can have specified params like background image, voice sample, avatar image

## Fact checking

Fact checking is enabled by default for both `generateTranscript` and `generatePodcast`. Configure `transcript.factChecker` to provide the fact-checking model or callback. Set `factChecking: false` on an individual call when the transcript should be used without fact checking.

```typescript
const transcript = await workflow.generateTranscript({
    subject: "The history of renewable energy",
    description: "Explain the key milestones and current technologies."
});

const uncheckedTranscript = await workflow.generateTranscript({
    subject: "A fictional story",
    description: "Create a short fictional conversation.",
    factChecking: false
});

const output = await workflow.generatePodcast({
    transcript,
    factChecking: false
});
```

When `generatePodcast` generates its own transcript, it performs one fact-checking pass for the complete pipeline. It does not fact-check the internally generated transcript twice.

## fal.ai configuration

The podcast model contracts are provider agnostic, so fal.ai can be connected by wrapping each fal endpoint in a `PodcastModel` callback. Run this code on a server or in a server-side job. Do not expose `FAL_KEY` in browser code.

Install the fal client and configure the key:

```bash
npm install @fal-ai/client
```

```powershell
$env:FAL_KEY = "your-fal-key"
```

The following example uses these fal.ai endpoints:

| Podcast stage | fal.ai endpoint | Output used by the workflow |
| --- | --- | --- |
| Transcript and fact checking | [`fal-ai/bytedance/seed/v2/mini`](https://fal.ai/models/fal-ai/bytedance/seed/v2/mini) | Text; $0.0001 per 1,000 input units, with output tokens weighted at 4 units |
| Text to speech | [`fal-ai/inworld-tts`](https://fal.ai/models/fal-ai/inworld-tts) | Audio file; $0.01 per 1,000 characters |
| Character image | [`fal-ai/flux/schnell`](https://fal.ai/models/fal-ai/flux/schnell) | Image URL; billed by megapixel |
| Direct avatar video | [`fal-ai/sadtalker`](https://fal.ai/models/fal-ai/sadtalker) | Video file |
| Stage 1 lip-sync representation | Provider-specific audio-to-motion adapter | Landmarks, 3DMM coefficients, or latent facial-motion embeddings |
| Stage 2 talking avatar | Provider-specific conditioned video adapter | MP4 URL |
| Google video alternative | [`fal-ai/veo3.1`](https://fal.ai/models/fal-ai/veo3.1) | Video with generated audio |

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
} from "./podcast";

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
    const result = await fal.subscribe("fal-ai/bytedance/seed/v2/mini", {
        input: {
            prompt,
            system_prompt: "Return only the requested JSON. Do not use Markdown fences.",
            temperature: 0,
            max_completion_tokens: 700,
            thinking: "disabled"
        }
    });

    return (result.data as FalTextResult).output;
}

async function checkFacts({ transcript }: PodcastFactCheckRequest): Promise<PodcastFactCheckResult> {
    const result = await fal.subscribe("fal-ai/bytedance/seed/v2/mini", {
        input: {
            prompt: [
                "Check the following podcast transcript for factual claims.",
                "Return only JSON matching { passed: boolean, issues?: string[] }.",
                transcriptText(transcript)
            ].join("\n\n"),
            system_prompt: "Return only the requested JSON. Do not use Markdown fences.",
            temperature: 0,
            max_completion_tokens: 700,
            thinking: "disabled"
        }
    });

    return JSON.parse((result.data as FalTextResult).output) as PodcastFactCheckResult;
}

async function generateSpeech({ text, character }: PodcastTextToSpeechRequest): Promise<Uint8Array> {
    const result = await fal.subscribe("fal-ai/inworld-tts", {
        input: {
            text,
            voice: character?.voice ?? "Sarah (en)",
            sample_rate_hertz: 24000
        }
    });

    const response = await fetch((result.data as FalAudioResult).audio.url);
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
            output_format: "jpeg"
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
    // Upload binary audio to provider storage when the endpoint requires a URL.
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
            throw new Error(`A provider avatar image is required for ${speaker}`);
        }

        return {
            speaker,
            imageUrl: character.avatarImage,
            representation
        };
    }) ?? [];
    if (segments.length === 0) {
        throw new Error("The avatar request did not contain Stage 1 motion representations");
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
                voice: "Sarah (en)",
                avatarImage: hostImage
            }
        ],
        backgroundImage: "https://example.com/podcast-studio-background.jpg",
        output: {
            format: "mp4"
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

    await result.output.asset?.save("./output/podcast.mp4");
}

void main();
```

The example returns a fal-hosted image URL, downloads speech as `Uint8Array` because `PodcastTextToSpeechModel` accepts binary audio, and leaves the audio-to-motion and motion-to-video calls provider-specific. In a production adapter, keep the hosted URL when the next model accepts a URL, or upload binary data to provider storage before passing it to another endpoint.

For multiple characters, keep one entry per speaker in `characters`, generate speech for the matching `speaker`, call the optional audio-to-motion model once per speech segment, and pass the resulting representations plus each character's base image into `avatarVideos`. The workflow exposes the intermediate representations as `result.lipSync`. For longer episodes, split the transcript into duration-bounded segments before Stage 2 video rendering. Google's [`fal-ai/veo3.1`](https://fal.ai/models/fal-ai/veo3.1) can generate video with native audio, but it is a general video model and does not replace the explicit name-to-face-to-voice mapping used by the two-stage adapter.
