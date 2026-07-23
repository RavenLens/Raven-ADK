import { BaseSTTModelConfig, STTChunkOptions, STTModel, STTResponse } from "./base";

export interface CustomSTTConfig extends BaseSTTModelConfig {
    providerName?: string;
    modelName?: string;
    transcribeInterimFn: (audio: Buffer | Blob | ArrayBuffer, options?: STTChunkOptions) => Promise<STTResponse>;
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

    async transcribeInterim(audio: Buffer | Blob | ArrayBuffer, options?: STTChunkOptions): Promise<STTResponse> {
        return this.customInterimFn(audio, options);
    }

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
