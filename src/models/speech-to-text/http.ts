export async function readAudioInput(input: Blob | File | Buffer): Promise<Blob> {
    return input instanceof Blob ? input : new Blob([Uint8Array.from(input)]);
}

export async function requestAudioText(url: string, apiKey: string | undefined, input: Blob | File | Buffer, fields: Record<string, string>, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append("file", await readAudioInput(input), "audio.bin");
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    const response = await fetch(url, { method: "POST", headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined, body: form, signal });
    if (!response.ok) throw new Error(`Speech-to-text request failed (${response.status}): ${await response.text()}`);
    const result = await response.json() as { text?: string };
    if (typeof result.text !== "string") throw new Error("Speech-to-text provider returned no text.");
    return result.text;
}