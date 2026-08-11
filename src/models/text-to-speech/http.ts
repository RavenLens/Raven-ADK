export async function requestAudio(url: string, apiKey: string | undefined, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Buffer> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers },
        body: JSON.stringify(body),
        signal
    });
    if (!response.ok) throw new Error(`Text-to-speech request failed (${response.status}): ${await response.text()}`);
    return Buffer.from(await response.arrayBuffer());
}