import { OpenAI } from "./text-to-text/openai";
import { OpenAIEmbedding } from "./embeddings/openai";
import { Google } from "./text-to-text/google";
import { GoogleEmbedding } from "./embeddings/google.embedding";
import { OpenAISTT } from "./speech-to-text/openai";
import { GoogleSTT } from "./speech-to-text/google";
import { CartesiaSTT } from "./speech-to-text/cartesia";
import { ElevenLabsSTT } from "./speech-to-text/elevenlabs";
import { OpenAITTS } from "./text-to-speech/openai";
import { GoogleTTS } from "./text-to-speech/google";
import { CartesiaTTS } from "./text-to-speech/cartesia";
import { ElevenLabsTTS } from "./text-to-speech/elevenlabs";

export { OpenAI } from "./text-to-text/openai";
export { OpenAIEmbedding } from "./embeddings/openai";
export { Anthropic } from "./text-to-text/anthropic";
export { VoyageEmbedding } from "./embeddings/voyageai";
export { Google } from "./text-to-text/google";
export { GoogleEmbedding } from "./embeddings/google.embedding";
export { RunPod } from "./text-to-text/runpod";
export { OpenAISTT } from "./speech-to-text/openai";
export { GoogleSTT } from "./speech-to-text/google";
export { OpenAITTS } from "./text-to-speech/openai";
export { GoogleTTS } from "./text-to-speech/google";
export { CartesiaSTT } from "./speech-to-text/cartesia";
export { ElevenLabsSTT } from "./speech-to-text/elevenlabs";
export { CartesiaTTS } from "./text-to-speech/cartesia";
export { ElevenLabsTTS } from "./text-to-speech/elevenlabs";
export {
	assertPodcastVideoCompatibility,
	assertRealtimeVideoCompatibility,
	assertVideoCompatibility,
	getPodcastVideoCompatibilityIssues,
	getRealtimeVideoCompatibilityIssues,
	getVideoCompatibilityIssues,
	supportsVideoRequest
} from "./video";
export type * from "./speech-to-text/stt.mutual";
export type * from "./text-to-speech/tts.mutual";
export type * from "./video/video.mutual";

export const Providers = {
	OpenAI: {
		textToText: OpenAI,
		embedding: OpenAIEmbedding,
		speechToText: OpenAISTT,
		textToSpeech: OpenAITTS
	},
	Google: {
		textToText: Google,
		embedding: GoogleEmbedding,
		speechToText: GoogleSTT,
		textToSpeech: GoogleTTS
	},
	Cartesia: {
		speechToText: CartesiaSTT,
		textToSpeech: CartesiaTTS
	},
	ElevenLabs: {
		speechToText: ElevenLabsSTT,
		textToSpeech: ElevenLabsTTS
	}
} as const;
export * as Mutual from "./mutual";
export * as StructuredOutput from "./text-to-text/structuredOutput";

export { MessagesVariations, SystemMessage, UserMessage, AIMessage, ReasoningMessage, ToolMessage, CompactionMessage } from "../agent/state";
