import { BaseSTTModelConfig, STTChunkOptions, STTModel, STTResponse } from "./base";
import OpenAIStandalone from "openai";

export interface OpenAISTTConfig extends BaseSTTModelConfig {
    /**
     * OpenAI API Key. Defaults to process.env.OPENAI_API_KEY
     */
    apiKey?: string;
    /**
     * Model to use for speech-to-text.
     * Default: "whisper-1"
     */
    model?: string;
    /**
     * Base URL for custom endpoints / proxies / Azure
     */
    baseURL?: string;
}

export class OpenAISTTModel implements STTModel {
    readonly provider = "OpenAI";
    readonly modelName: string;
    private client: OpenAIStandalone;

    constructor(config: OpenAISTTConfig = {}) {
        this.modelName = config.model ?? "whisper-1";
        this.client = new OpenAIStandalone({
            apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
            baseURL: config.baseURL
        });
    }

    /**
     * Interim approach: sends complete audio buffer to OpenAI Whisper API.
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
            throw new Error("Invalid audio type provided to OpenAISTTModel.transcribeInterim");
        }

        const encoding = options?.encoding ?? "wav";
        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const file = new File(
            [ab as any],
            `audio.${encoding}`,
            { type: `audio/${encoding}` }
        );

        const response = await this.client.audio.transcriptions.create({
            file,
            model: this.modelName,
            language: options?.language,
            response_format: "verbose_json",
            ...options?.extraOptions
        });

        const verbose = response as any;
        return {
            text: verbose.text ?? "",
            isFinal: true,
            confidence: 1.0,
            words: verbose.words?.map((w: any) => ({
                word: w.word,
                start: w.start,
                end: w.end
            })),
            raw: verbose
        };
    }

    /**
     * Volatile approach: OpenAI Whisper REST endpoint is stateless per request.
     * For stream of subchunks, we accumulate PCM/audio subchunks on the fly,
     * emitting interim hypotheses periodically (or as window accumulates),
     * and yielding final transcript when stream completes.
     */
    async *transcribeVolatile(
        audioStream: AsyncIterable<Buffer>,
        options?: STTChunkOptions
    ): AsyncIterable<STTResponse> {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        // Interval chunk limit (e.g., emit interim hypothesis roughly every ~16KB or ~0.5s of PCM)
        const interimThresholdBytes = 16000 * 2 * 0.5; // ~0.5 sec at 16kHz 16-bit mono

        for await (const chunk of audioStream) {
            chunks.push(chunk);
            totalBytes += chunk.length;

            if (totalBytes >= interimThresholdBytes) {
                const currentBuffer = Buffer.concat(chunks);
                try {
                    const interimResult = await this.transcribeInterim(currentBuffer, options);
                    yield {
                        text: interimResult.text,
                        isFinal: false,
                        confidence: interimResult.confidence,
                        raw: interimResult.raw
                    };
                } catch {
                    // Suppress interim errors for tiny incomplete audio frames
                }
            }
        }

        if (chunks.length > 0) {
            const fullBuffer = Buffer.concat(chunks);
            const finalResult = await this.transcribeInterim(fullBuffer, options);
            yield {
                text: finalResult.text,
                isFinal: true,
                confidence: finalResult.confidence,
                words: finalResult.words,
                raw: finalResult.raw
            };
        }
    }
}
