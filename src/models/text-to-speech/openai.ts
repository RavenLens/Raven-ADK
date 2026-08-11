import { OpenAI as OpenAIStandalone } from "openai";
import { TextToSpeechConfig, TextToSpeechModel, TextToSpeechOptions } from "./tts.mutual";

export class OpenAITTS implements TextToSpeechModel {
    typeAPI: "model" = "model";
    apiName = "OpenAI" as const;
    private readonly client: OpenAIStandalone;
    config: TextToSpeechConfig;

    constructor(config: TextToSpeechConfig) {
        this.config = config;
        this.client = new OpenAIStandalone({ apiKey: config.apiKey, baseURL: config.baseURL });
    }

    async synthesize(text: string, options: TextToSpeechOptions = {}): Promise<Buffer> {
        const response = await this.client.audio.speech.create({
            model: this.config.model,
            voice: (options.voice ?? this.config.voice ?? "alloy") as any,
            input: text,
            response_format: (options.outputFormat ?? this.config.outputFormat) as any,
            speed: options.speed,
        });
        return Buffer.from(await response.arrayBuffer());
    }

    tts(text: string, options?: TextToSpeechOptions): Promise<Buffer> {
        return this.synthesize(text, options);
    }
}