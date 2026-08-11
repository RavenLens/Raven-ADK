import { LLMConfig } from "../mutual";

export interface SpeechToTextConfig extends Omit<LLMConfig, "messages" | "tools"> {
    model: string;
    baseURL?: string;
    language?: string;
}

export interface SpeechToTextOptions {
    language?: string;
    prompt?: string;
    mimeType?: string;
    filename?: string;
    signal?: AbortSignal;
    [key: string]: unknown;
}

export interface SpeechToTextModel {
    typeAPI: "model";
    apiName: "OpenAI" | "Google" | "Cartesia" | "ElevenLabs" | { custom: string };
    config: SpeechToTextConfig;
    transcribe(speechFile: Blob | File | Buffer, options?: SpeechToTextOptions): Promise<string>;
    stt(speechFile: Blob | File | Buffer, options?: SpeechToTextOptions): Promise<string>;
}