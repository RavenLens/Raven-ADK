import { requestAudioText } from "./http";
import { SpeechToTextConfig, SpeechToTextModel, SpeechToTextOptions } from "./stt.mutual";

export class ElevenLabsSTT implements SpeechToTextModel {
    typeAPI: "model" = "model";
    apiName = "ElevenLabs" as const;
    config: SpeechToTextConfig;

    constructor(config: SpeechToTextConfig) { this.config = config; }

    transcribe(speechFile: Blob | File | Buffer, options: SpeechToTextOptions = {}): Promise<string> {
        return requestAudioText(this.config.baseURL ?? "https://api.elevenlabs.io/v1/speech-to-text", this.config.apiKey, speechFile, {
            model_id: this.config.model,
            ...(options.language ?? this.config.language ? { language_code: options.language ?? this.config.language } : {})
        }, options.signal);
    }

    stt(speechFile: Blob | File | Buffer, options?: SpeechToTextOptions): Promise<string> { return this.transcribe(speechFile, options); }
}