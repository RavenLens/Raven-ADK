import { BaseSTTModelConfig, STTChunkOptions, STTModel, STTResponse } from "./base";
import { ElevenLabsClient } from "elevenlabs";

export interface ElevenLabsSTTConfig extends BaseSTTModelConfig {
    /**
     * ElevenLabs API Key. Defaults to process.env.ELEVENLABS_API_KEY
     */
    apiKey?: string;
    /**
     * Model ID for ElevenLabs Speech-to-Text / Scribe.
     * Default: "scribe_v1"
     */
    model?: string;
    /**
     * Base URL for ElevenLabs API.
     * Default: "https://api.elevenlabs.io/v1"
     */
    baseUrl?: string;
}

export class ElevenLabsSTTModel implements STTModel {
    readonly provider = "ElevenLabs";
    readonly modelName: string;
    private client: ElevenLabsClient;

    constructor(config: ElevenLabsSTTConfig = {}) {
        this.modelName = config.model ?? "scribe_v1";
        this.client = new ElevenLabsClient({
            apiKey: config.apiKey ?? process.env.ELEVENLABS_API_KEY,
            baseUrl: config.baseUrl
        });
    }

    /**
     * Interim approach: sends full audio buffer to ElevenLabs Speech-to-Text via ElevenLabsClient.
     */
    async transcribeInterim(
        audio: Buffer | Blob | ArrayBuffer,
        options?: STTChunkOptions
    ): Promise<STTResponse> {
        let buffer: Buffer;
        if (Buffer.isBuffer(audio)) {
            buffer = audio;
        } else if (audio instanceof ArrayBuffer) {
            buffer = Buffer.from(audio);
        } else if (typeof Blob !== "undefined" && audio instanceof Blob) {
            const arrayBuffer = await audio.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } else {
            throw new Error("Invalid audio format for ElevenLabsSTTModel.transcribeInterim");
        }

        const encoding = options?.encoding ?? "mp3";
        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const file = new File(
            [ab as any],
            `audio.${encoding}`,
            { type: `audio/${encoding}` }
        );

        const response = await this.client.speechToText.convert({
            file,
            model_id: this.modelName,
            language_code: options?.language,
            ...options?.extraOptions
        });

        const text = response.text ?? "";
        const words = (response as any).words?.map((w: any) => ({
            word: w.text ?? w.word,
            start: w.start,
            end: w.end
        }));

        return {
            text,
            isFinal: true,
            confidence: (response as any).confidence ?? 1.0,
            words,
            raw: response
        };
    }

    /**
     * Volatile approach: Streams subchunks dynamically over ElevenLabs WebSocket/stream connection,
     * generating real-time transcription on the fly as audio subchunks arrive.
     */
    async *transcribeVolatile(
        audioStream: AsyncIterable<Buffer>,
        options?: STTChunkOptions
    ): AsyncIterable<STTResponse> {
        const WebSocketClass = (globalThis as any).WebSocket || (await import("ws")).default;

        const baseUrl = (this.client as any)._options?.baseUrl || "https://api.elevenlabs.io/v1";
        const wsUrl = new URL(baseUrl.replace(/^http/, "ws") + "/speech-to-text/stream");
        wsUrl.searchParams.append("model_id", this.modelName);
        if (options?.language) {
            wsUrl.searchParams.append("language_code", options.language);
        }

        const responses: STTResponse[] = [];
        let resolver: (() => void) | null = null;
        let isClosed = false;

        const apiKey = (this.client as any)._options?.apiKey || process.env.ELEVENLABS_API_KEY || "";

        const ws = new WebSocketClass(wsUrl.toString(), {
            headers: {
                "xi-api-key": apiKey
            }
        });

        ws.onopen = async () => {
            try {
                for await (const chunk of audioStream) {
                    if (ws.readyState === ws.OPEN) {
                        const base64Chunk = chunk.toString("base64");
                        ws.send(JSON.stringify({ audio_base64: base64Chunk }));
                    }
                }
                if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify({ flush: true }));
                }
            } catch {
                ws.close();
            }
        };

        ws.onmessage = (event: any) => {
            try {
                const data = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
                if (data.text || data.transcript) {
                    responses.push({
                        text: data.text || data.transcript,
                        isFinal: Boolean(data.is_final),
                        confidence: data.confidence,
                        words: data.words?.map((w: any) => ({
                            word: w.text ?? w.word,
                            start: w.start,
                            end: w.end
                        })),
                        raw: data
                    });
                    if (resolver) {
                        resolver();
                        resolver = null;
                    }
                }
            } catch {
                // Ignore non-json frames
            }
        };

        ws.onclose = () => {
            isClosed = true;
            if (resolver) {
                resolver();
                resolver = null;
            }
        };

        ws.onerror = () => {
            isClosed = true;
            if (resolver) {
                resolver();
                resolver = null;
            }
        };

        while (!isClosed || responses.length > 0) {
            if (responses.length > 0) {
                yield responses.shift()!;
            } else {
                await new Promise<void>((resolve) => {
                    resolver = resolve;
                });
            }
        }
    }
}
