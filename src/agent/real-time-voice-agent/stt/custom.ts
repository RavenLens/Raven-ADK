import { BaseSTTModelConfig, STTChunkOptions, STTModel, STTResponse } from "./base";

export interface CustomSTTConfig extends BaseSTTModelConfig {
    providerName?: string;
    modelName?: string;
    /**
     * Handler for batch/non-streaming audio transcription.
     * Receives a complete audio buffer/blob and returns the transcribed text result.
     *
     * @param audio The complete audio payload as a Buffer, Blob, or ArrayBuffer.
     * @param options Optional chunk configuration (e.g. sampleRate, encoding).
     * @returns A promise resolving to the final transcription response.
     */
    transcribeInterimFn: (audio: Buffer | Blob | ArrayBuffer, options?: STTChunkOptions) => Promise<STTResponse>;
    /**
     * Optional handler for live streaming / volatile audio transcription.
     * Continuously processes incoming audio chunks and yields partial/interim transcription responses.
     *
     * @param audioStream An async iterable stream of real-time audio chunk buffers.
     * @param options Optional chunk configuration (e.g. sampleRate, encoding).
     * @returns An async iterable yielding interim transcription responses.
     */
    transcribeVolatileFn?: (audioStream: AsyncIterable<Buffer>, options?: STTChunkOptions) => AsyncIterable<STTResponse>;
}

export class CustomSTTModel implements STTModel {
    readonly provider: string;
    readonly modelName: string;
    private customInterimFn: (audio: Buffer | Blob | ArrayBuffer, options?: STTChunkOptions) => Promise<STTResponse>;
    private customVolatileFn?: (audioStream: AsyncIterable<Buffer>, options?: STTChunkOptions) => AsyncIterable<STTResponse>;

    constructor(config: CustomSTTConfig) {
        this.provider = config.providerName ?? "Custom";
        this.modelName = config.modelName ?? "custom-stt";
        this.customInterimFn = config.transcribeInterimFn;
        this.customVolatileFn = config.transcribeVolatileFn;
    }

    /**
     * Transcribes a static/complete audio payload asynchronously.
     * Invokes the underlying `transcribeInterimFn` handler.
     *
     * @param audio The complete audio payload (Buffer, Blob, or ArrayBuffer).
     * @param options Optional chunk options such as sample rate and encoding.
     * @returns Promise resolving to the STTResponse object.
     */
    async transcribeInterim(audio: Buffer | Blob | ArrayBuffer, options?: STTChunkOptions): Promise<STTResponse> {
        return this.customInterimFn(audio, options);
    }

    /**
     * Transcribes a real-time stream of audio chunks.
     * Delegates to `transcribeVolatileFn` if configured, or falls back to accumulating
     * the stream chunks and running batch transcription via `transcribeInterim`.
     *
     * @param audioStream An async iterable stream of audio buffer chunks.
     * @param options Optional chunk options such as sample rate and encoding.
     * @returns AsyncIterable yielding partial or final STTResponse objects.
     */
    async *transcribeVolatile(
        audioStream: AsyncIterable<Buffer>,
        options?: STTChunkOptions
    ): AsyncIterable<STTResponse> {
        if (this.customVolatileFn) {
            yield* this.customVolatileFn(audioStream, options);
        } else {
            // Default fallback if volatile custom fn is not provided
            const chunks: Buffer[] = [];
            for await (const chunk of audioStream) {
                chunks.push(chunk);
            }
            const fullBuffer = Buffer.concat(chunks);
            const result = await this.transcribeInterim(fullBuffer, options);
            yield result;
        }
    }
}
