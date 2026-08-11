import { OpenAI as OpenAIStandalone } from "openai";
import { toFile } from "openai/uploads";
import { SpeechToTextConfig, SpeechToTextModel, SpeechToTextOptions } from "./stt.mutual";

export class OpenAISTT implements SpeechToTextModel {
    typeAPI: "model" = "model";
    apiName = "OpenAI" as const;
    private readonly client: OpenAIStandalone;
    config: SpeechToTextConfig;

    constructor(config: SpeechToTextConfig) {
        this.config = config;
        this.client = new OpenAIStandalone({ apiKey: config.apiKey, baseURL: config.baseURL });
    }

    async transcribe(speechFile: Blob | File | Buffer, options: SpeechToTextOptions = {}): Promise<string> {
        const file = await toFile(
            speechFile,
            options.filename ?? "speech.wav",
            { type: options.mimeType ?? "audio/wav" }
        );
        const response = await this.client.audio.transcriptions.create({
            file,
            model: this.config.model,
            language: options.language ?? this.config.language,
            prompt: options.prompt,
        }, { signal: options.signal });
        return response.text;
    }

    stt(speechFile: Blob | File | Buffer, options?: SpeechToTextOptions): Promise<string> {
        return this.transcribe(speechFile, options);
    }
}