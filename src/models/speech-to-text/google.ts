import { GoogleGenAI } from "@google/genai";
import { SpeechToTextConfig, SpeechToTextModel, SpeechToTextOptions } from "./stt.mutual";

export class GoogleSTT implements SpeechToTextModel {
    typeAPI: "model" = "model";
    apiName = "Google" as const;
    private readonly client: GoogleGenAI;
    config: SpeechToTextConfig;

    constructor(config: SpeechToTextConfig) {
        this.config = config;
        this.client = new GoogleGenAI({ apiKey: config.apiKey });
    }

    async transcribe(speechFile: Blob | File | Buffer, options: SpeechToTextOptions = {}): Promise<string> {
        const bytes = Buffer.from(await new Blob([speechFile as Blob]).arrayBuffer()).toString("base64");
        const response = await this.client.models.generateContent({
            model: this.config.model,
            contents: [
                {
                    role: "user",
                    parts: [
                        { inlineData: { mimeType: options.mimeType ?? "audio/wav", data: bytes } },
                        { text: options.prompt ?? "Transcribe this audio accurately. Return only the transcription." }
                    ]
                }]
        });
        return response.text ?? "";
    }

    stt(speechFile: Blob | File | Buffer, options?: SpeechToTextOptions): Promise<string> {
        return this.transcribe(speechFile, options);
    }
}