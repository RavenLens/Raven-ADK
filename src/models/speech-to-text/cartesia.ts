import { requestAudioText } from "./http";
import { SpeechToTextConfig, SpeechToTextModel, SpeechToTextOptions } from "./stt.mutual";

export class CartesiaSTT implements SpeechToTextModel {
    typeAPI: "model" = "model";
    apiName = "Cartesia" as const;
    config: SpeechToTextConfig;

    constructor(config: SpeechToTextConfig) { this.config = config; }

    transcribe(speechFile: Blob | File | Buffer, options: SpeechToTextOptions = {}): Promise<string> {
        return requestAudioText(this.config.baseURL ?? "https://api.cartesia.ai/stt", this.config.apiKey, speechFile, {
            model_id: this.config.model,
            ...(options.language ?? this.config.language ? { language: options.language ?? this.config.language } : {})
        }, options.signal);
    }

    stt(speechFile: Blob | File | Buffer, options?: SpeechToTextOptions): Promise<string> { return this.transcribe(speechFile, options); }
}