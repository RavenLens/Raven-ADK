import { GoogleGenAI } from "@google/genai";
import { TextToSpeechConfig, TextToSpeechModel, TextToSpeechOptions } from "./tts.mutual";

export class GoogleTTS implements TextToSpeechModel {
    typeAPI: "model" = "model";
    apiName = "Google" as const;
    private readonly client: GoogleGenAI;
    config: TextToSpeechConfig;

    constructor(config: TextToSpeechConfig) {
        this.config = config;
        this.client = new GoogleGenAI({ apiKey: config.apiKey });
    }

    async synthesize(text: string, options: TextToSpeechOptions = {}): Promise<Buffer> {
        const response = await this.client.models.generateContent({
            model: this.config.model,
            contents: text,
            config: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: options.voice ?? this.config.voice ?? "Kore" } } }
            } as any
        });
        const data = response.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData)?.inlineData?.data;
        if (!data) throw new Error("Google TTS returned no audio data.");
        return Buffer.from(data, "base64");
    }

    tts(text: string, options?: TextToSpeechOptions): Promise<Buffer> {
        return this.synthesize(text, options);
    }
}