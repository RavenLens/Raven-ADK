import { requestAudio } from "./http";
import { TextToSpeechConfig, TextToSpeechModel, TextToSpeechOptions } from "./tts.mutual";

export class ElevenLabsTTS implements TextToSpeechModel {
    typeAPI: "model" = "model";
    apiName = "ElevenLabs" as const;
    config: TextToSpeechConfig;

    constructor(config: TextToSpeechConfig) { this.config = config; }

    synthesize(text: string, options: TextToSpeechOptions = {}): Promise<Buffer> {
        const voice = options.voice ?? this.config.voice;
        if (!voice) throw new Error("ElevenLabs TTS requires a voice or config.voice.");
        return requestAudio(`${this.config.baseURL ?? "https://api.elevenlabs.io/v1/text-to-speech"}/${encodeURIComponent(voice)}`, this.config.apiKey, {
            text,
            model_id: this.config.model,
            ...(options.speed === undefined ? {} : { voice_settings: { speed: options.speed } })
        }, { "xi-api-key": this.config.apiKey ?? "" }, options.signal);
    }

    tts(text: string, options?: TextToSpeechOptions): Promise<Buffer> { return this.synthesize(text, options); }
}