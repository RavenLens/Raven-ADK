import { requestAudio } from "./http";
import { TextToSpeechConfig, TextToSpeechModel, TextToSpeechOptions } from "./tts.mutual";

export class CartesiaTTS implements TextToSpeechModel {
    typeAPI: "model" = "model";
    apiName = "Cartesia" as const;
    config: TextToSpeechConfig;

    constructor(config: TextToSpeechConfig) { this.config = config; }

    synthesize(text: string, options: TextToSpeechOptions = {}): Promise<Buffer> {
        return requestAudio(this.config.baseURL ?? "https://api.cartesia.ai/tts/bytes", this.config.apiKey, {
            model_id: this.config.model,
            transcript: text,
            voice: { mode: "id", id: options.voice ?? this.config.voice },
            output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 }
        }, { "Cartesia-Version": "2024-06-10" }, options.signal);
    }

    tts(text: string, options?: TextToSpeechOptions): Promise<Buffer> { return this.synthesize(text, options); }
}