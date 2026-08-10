import { LLMConfig } from "../mutual";

export interface TextToSpeechConfig extends Omit<LLMConfig, "messages" | "tools"> {
    model: string;
    baseURL?: string;
    voice?: string;
    outputFormat?: string;
}

export interface TextToSpeechOptions {
    voice?: string;
    voiceClone?: {
        sample: Blob | File | Buffer | Uint8Array;
        mimeType?: string;
        consent?: {
            granted: true;
            subjectId?: string;
        };
    };
    outputFormat?: string;
    speed?: number;
    language?: string;
    signal?: AbortSignal;
    [key: string]: unknown;
}

export interface TextToSpeechCapabilities {
    voiceCloning: {
        supported: boolean;
        sampleRequired: boolean;
        consentRequired: boolean;
    };
    alignment: {
        wordTimestamps: boolean;
        phonemeTimestamps: boolean;
        visemeTimestamps: boolean;
    };
    streaming: boolean;
}

export interface TextToSpeechModel {
    typeAPI: "model";
    apiName: "OpenAI" | "Google" | "Cartesia" | "ElevenLabs" | { custom: string };
    config: TextToSpeechConfig;
    capabilities?: TextToSpeechCapabilities;
    synthesize(text: string, options?: TextToSpeechOptions): Promise<Buffer>;
    tts(text: string, options?: TextToSpeechOptions): Promise<Buffer>;
}