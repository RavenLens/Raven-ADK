import { OpenAI as OpenAIStandalone } from "openai";
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
        const response = await this.client.audio.transcriptions.create({
            file: speechFile as File,
            model: this.config.model,
            language: options.language ?? this.config.language,
            prompt: options.prompt,
        });
        return response.text;
    }

    stt(speechFile: Blob | File | Buffer, options?: SpeechToTextOptions): Promise<string> {
        return this.transcribe(speechFile, options);
    }
}