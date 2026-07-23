import { BaseSTTModelConfig, STTChunkOptions, STTModel, STTResponse } from "./base";
import { DeepgramClient } from "@deepgram/sdk";

export interface DeepgramSTTConfig extends BaseSTTModelConfig {
    /**
     * Deepgram API Key. Defaults to process.env.DEEPGRAM_API_KEY
     */
    apiKey?: string;
    /**
     * Model name e.g. "nova-3", "nova-2", "flux"
     * Default: "nova-3"
     */
    model?: string;
    /**
     * API endpoint or WebSocket URL base
     * Default: "https://api.deepgram.com/v1"
     */
    baseUrl?: string;
}

export class DeepgramSTTModel implements STTModel {
    readonly provider = "Deepgram";
    readonly modelName: string;
    private client: DeepgramClient;

    constructor(config: DeepgramSTTConfig = {}) {
        this.modelName = config.model ?? "nova-3";
        this.client = new DeepgramClient({
            apiKey: config.apiKey ?? process.env.DEEPGRAM_API_KEY ?? "",
            baseUrl: config.baseUrl
        });
    }

    /**
     * Interim approach: POST complete audio buffer to Deepgram REST endpoint using DeepgramClient passthrough/fetch
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
            throw new Error("Invalid audio format for DeepgramSTTModel.transcribeInterim");
        }

        const encoding = options?.encoding ?? "m4a";
        const sampleRate = options?.sampleRate ?? 16000;
        const language = options?.language ?? "en";

        const url = new URL("https://api.deepgram.com/v1/listen");
        url.searchParams.append("model", this.modelName);
        url.searchParams.append("language", language);
        url.searchParams.append("sample_rate", sampleRate.toString());
        url.searchParams.append("punctuate", "true");
        url.searchParams.append("smart_format", "true");

        if (options?.extraOptions) {
            for (const [key, val] of Object.entries(options.extraOptions)) {
                url.searchParams.append(key, String(val));
            }
        }

        const response = await this.client.fetch(url.toString(), {
            method: "POST",
            headers: {
                "Content-Type": `audio/${encoding}`
            },
            body: new Uint8Array(buffer) as any
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Deepgram STT failed (${response.status}): ${errText}`);
        }

        const json = await response.json() as any;
        const alt = json?.results?.channels?.[0]?.alternatives?.[0];
        const text = alt?.transcript ?? "";
        const confidence = alt?.confidence ?? 0;
        const words = alt?.words?.map((w: any) => ({
            word: w.word,
            start: w.start,
            end: w.end,
            confidence: w.confidence
        }));

        return {
            text,
            isFinal: true,
            confidence,
            words,
            raw: json
        };
    }

    /**
     * Volatile approach: Establishes a Deepgram live WebSocket connection via official Deepgram SDK
     * for real-time subchunk processing as audio arrives on the fly.
     */
    async *transcribeVolatile(
        audioStream: AsyncIterable<Buffer>,
        options?: STTChunkOptions
    ): AsyncIterable<STTResponse> {
        const sampleRate = options?.sampleRate ?? 16000;
        const encoding = options?.encoding ?? "linear16";
        const language = options?.language ?? "en";

        const socket = await this.client.listen.v1.connect({
            model: this.modelName,
            language,
            encoding,
            sample_rate: sampleRate,
            interim_results: "true" as any,
            smart_format: "true" as any,
            ...options?.extraOptions
        });

        const responses: STTResponse[] = [];
        let resolver: (() => void) | null = null;
        let isClosed = false;

        socket.on("Results" as any, (data: any) => {
            const alt = data.channel?.alternatives?.[0] || data.results?.channels?.[0]?.alternatives?.[0];
            if (alt && alt.transcript) {
                responses.push({
                    text: alt.transcript,
                    isFinal: Boolean(data.is_final),
                    confidence: alt.confidence,
                    words: alt.words?.map((w: any) => ({
                        word: w.word,
                        start: w.start,
                        end: w.end,
                        confidence: w.confidence
                    })),
                    raw: data
                });
                if (resolver) {
                    resolver();
                    resolver = null;
                }
            }
        });

        socket.on("Close" as any, () => {
            isClosed = true;
            if (resolver) {
                resolver();
                resolver = null;
            }
        });

        socket.on("Error" as any, () => {
            isClosed = true;
            if (resolver) {
                resolver();
                resolver = null;
            }
        });

        // Send audio chunks as they arrive
        (async () => {
            try {
                for await (const chunk of audioStream) {
                    socket.sendMedia(chunk);
                }
                socket.sendCloseStream({ type: "CloseStream" });
            } catch {
                try {
                    socket.sendCloseStream({ type: "CloseStream" });
                } catch {}
            }
        })();

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
