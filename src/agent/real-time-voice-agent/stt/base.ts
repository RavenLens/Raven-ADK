export type STTMode = "interim" | "volatile";

export interface STTChunkOptions {
    /** Audio format/encoding e.g. "pcm16", "opus", "wav", "mp3" */
    encoding?: string;
    /** Sample rate in Hz, e.g. 16000, 48000 */
    sampleRate?: number;
    /** Language code e.g. "en-US", "en" */
    language?: string;
    /** Additional provider-specific parameters */
    extraOptions?: Record<string, any>;
}

export interface STTResponse {
    /** Final or interim transcript text */
    text: string;
    /** Indicates whether this transcript result is final */
    isFinal: boolean;
    /** Optional confidence score between 0 and 1 */
    confidence?: number;
    /** Optional word-level timing or metadata */
    words?: Array<{
        word: string;
        start?: number;
        end?: number;
        confidence?: number;
    }>;
    /** Raw provider payload if needed */
    raw?: any;
}

export interface BaseSTTModelConfig {
    apiKey?: string;
    model?: string;
    language?: string;
    sampleRate?: number;
    encoding?: string;
    extraOptions?: Record<string, any>;
}

/**
 * Interface defining STT model capabilities:
 * - Interim: Accepts full audio payload (Buffer or Blob/File) and returns complete response.
 * - Volatile: Accepts a stream of subchunks (AsyncIterable<Buffer> or Chunk emitter) and yields real-time transcripts.
 */
export interface STTModel {
    readonly provider: string;
    readonly modelName: string;

    /**
     * Interim approach: model gets full response/audio buffer at once.
     * @param audio Full audio buffer or File/Blob
     * @param options Execution/Chunk options
     */
    transcribeInterim(audio: Buffer | Blob | ArrayBuffer, options?: STTChunkOptions): Promise<STTResponse>;

    /**
     * Volatile approach: model gets stream of subchunks and generates output on the fly.
     * @param audioStream Async iterable emitting audio chunk buffers
     * @param options Execution/Chunk options
     * @returns AsyncIterable of partial/interim and final STT responses as audio arrives
     */
    transcribeVolatile(
        audioStream: AsyncIterable<Buffer>,
        options?: STTChunkOptions
    ): AsyncIterable<STTResponse>;
}
