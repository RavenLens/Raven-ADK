import { LLMConfig } from "../mutual";

export interface TextToSpeechConfig extends Omit<LLMConfig, "messages" | "tools"> {
    model: string;
    baseURL?: string;
    voice?: string;
    outputFormat?: string;
}

export interface TextToSpeechOptions {
    voice?: string;
    outputFormat?: string;
    speed?: number;
    language?: string;
    signal?: AbortSignal;
    [key: string]: unknown;
}

export interface TextToSpeechModel {
    typeAPI: "model";
    apiName: "OpenAI" | "Google" | "Cartesia" | "ElevenLabs" | { custom: string };
    config: TextToSpeechConfig;
    synthesize(text: string, options?: TextToSpeechOptions): Promise<Buffer>;
    tts(text: string, options?: TextToSpeechOptions): Promise<Buffer>;
}