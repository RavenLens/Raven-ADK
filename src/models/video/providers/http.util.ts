import type {
    VideoAsset,
    VideoGenerationOptions,
    VideoGenerationResult,
    VideoSyncResult
} from "../video.mutual";

export interface VideoHttpClientOptions {
    baseURL: string;
    apiKey?: string;
    headers?: Record<string, string>;
    fetch?: typeof fetch;
}

export interface VideoHttpClient {
    request<T>(path: string, init?: RequestInit, options?: VideoGenerationOptions): Promise<T>;
}

export function createVideoHttpClient(options: VideoHttpClientOptions): VideoHttpClient {
    const requestFetch = options.fetch ?? fetch;
    return {
        async request<T>(path: string, init: RequestInit = {}, generationOptions: VideoGenerationOptions | undefined) {
            const controller = new AbortController();
            const signal = generationOptions?.signal;
            const abort = () => controller.abort(signal?.reason);
            
            signal?.addEventListener("abort", abort, { once: true });
            const timeout = generationOptions?.timeoutMs === undefined
                ? undefined
                : setTimeout(() => controller.abort(new Error("Video request timed out.")), generationOptions.timeoutMs);
                
            try {
                const response = await requestFetch(new URL(path, options.baseURL), {
                    ...init,
                    headers: {
                        "Content-Type": "application/json",
                        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
                        ...options.headers,
                        ...init.headers
                    },
                    signal: controller.signal
                });
                if (!response.ok) {
                    throw new Error(`Video provider request failed (${response.status}): ${await response.text()}`);
                }
                return await response.json() as T;
            } finally {
                if (timeout !== undefined) clearTimeout(timeout);
                signal?.removeEventListener("abort", abort);
            }
        }
    };
}

export async function pollVideoOperation<T>(
    read: () => Promise<T>,
    state: (value: T) => "pending" | "completed" | "failed",
    options: VideoGenerationOptions | undefined,
    intervalMs = 2000,
    maxAttempts = 150
): Promise<T> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const value = await read();
        const currentState = state(value);
        if (currentState === "completed") return value;
        if (currentState === "failed") throw new Error("Video provider operation failed.");
        await new Promise<void>((resolve, reject) => {
            const signal = options?.signal;
            if (signal?.aborted) {
                reject(signal.reason ?? new Error("Video generation was cancelled."));
                return;
            }
            const timer = setTimeout(resolve, intervalMs);
            signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(signal.reason ?? new Error("Video generation was cancelled."));
            }, { once: true });
        });
    }
    throw new Error("Video provider operation exceeded the polling limit.");
}

export function requireRemoteAsset(asset: VideoAsset, field: string): string {
    if (asset.source.kind !== "url") {
        throw new Error(`${field} must use a public URL for this provider integration.`);
    }
    return asset.source.url;
}

export function videoResultFromUrl(
    url: string,
    mimeType = "video/mp4",
    sync: Partial<Record<"lipSync" | "gestureSync" | "expressionSync", VideoSyncResult>> = {}
): VideoGenerationResult {
    return {
        video: {
            source: { kind: "url", url },
            mimeType
        },
        sync: {
            lipSync: sync.lipSync ?? "unknown",
            gestureSync: sync.gestureSync ?? "unknown",
            expressionSync: sync.expressionSync ?? "unknown"
        }
    };
}

export function findMediaUrl(value: unknown): string | undefined {
    if (typeof value === "string" && /^(https?:\/\/|gs:\/\/)/.test(value)) return value;
    if (Array.isArray(value)) {
        for (const item of value) {
            const result = findMediaUrl(item);
            if (result) return result;
        }
    }
    if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            if (/^(url|uri|video_url|output)$/.test(key) && typeof item === "string" && /^(https?:\/\/|gs:\/\/)/.test(item)) {
                return item;
            }
            const result = findMediaUrl(item);
            if (result) return result;
        }
    }
    return undefined;
}
