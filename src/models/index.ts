import { OpenAI } from "./text-to-text/openai.js";
import { OpenAIEmbedding } from "./embeddings/openai.js";
import { Google } from "./text-to-text/google.js";
import { GoogleEmbedding } from "./embeddings/google.embedding.js";
import { OpenAISTT } from "./speech-to-text/openai.js";
import { GoogleSTT } from "./speech-to-text/google.js";
import { CartesiaSTT } from "./speech-to-text/cartesia.js";
import { ElevenLabsSTT } from "./speech-to-text/elevenlabs.js";
import { OpenAITTS } from "./text-to-speech/openai.js";
import { GoogleTTS } from "./text-to-speech/google.js";
import { CartesiaTTS } from "./text-to-speech/cartesia.js";
import { ElevenLabsTTS } from "./text-to-speech/elevenlabs.js";

export { OpenAI } from "./text-to-text/openai.js";
export { OpenAIEmbedding } from "./embeddings/openai.js";
export { Anthropic } from "./text-to-text/anthropic.js";
export { VoyageEmbedding } from "./embeddings/voyageai.js";
export { Google } from "./text-to-text/google.js";
export { DummyModel } from "./text-to-text/dummy.js";
export { GoogleEmbedding } from "./embeddings/google.embedding.js";
export { OpenAISTT } from "./speech-to-text/openai.js";
export { GoogleSTT } from "./speech-to-text/google.js";
export { OpenAITTS } from "./text-to-speech/openai.js";
export { GoogleTTS } from "./text-to-speech/google.js";
export { CartesiaSTT } from "./speech-to-text/cartesia.js";
export { ElevenLabsSTT } from "./speech-to-text/elevenlabs.js";
export { CartesiaTTS } from "./text-to-speech/cartesia.js";
export { ElevenLabsTTS } from "./text-to-speech/elevenlabs.js";
export type * from "./speech-to-text/stt.mutual.js";
export type * from "./text-to-speech/tts.mutual.js";

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
export * as Mutual from "./mutual.js";
export * as StructuredOutput from "./text-to-text/structuredOutput.js";

export { MessagesVariations, SystemMessage, UserMessage, AIMessage, ReasoningMessage, ToolMessage, CompactionMessage } from "../agent/state.js";
