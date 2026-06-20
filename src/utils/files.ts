import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Loads a text file and returns its content.
 * @param filePath Path to the file.
 * @returns Promise resolving to the file's text content.
 */
export async function loadTextFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, "utf-8");
}

/**
 * Loads a file and returns it as a base64 data URL.
 * Useful for images and PDFs to be sent to multimodal models.
 * @param filePath Path to the file.
 * @returns Promise resolving to a base64 data URL.
 */
export async function loadFileAsDataUrl(filePath: string): Promise<string> {
    const data = await fs.readFile(filePath);
    const base64 = data.toString("base64");
    const ext = path.extname(filePath).toLowerCase();

    let mimeType = "application/octet-stream";
    switch (ext) {
        case ".pdf":
            mimeType = "application/pdf";
            break;
        case ".png":
            mimeType = "image/png";
            break;
        case ".jpg":
        case ".jpeg":
            mimeType = "image/jpeg";
            break;
        case ".gif":
            mimeType = "image/gif";
            break;
        case ".webp":
            mimeType = "image/webp";
            break;
        case ".svg":
            mimeType = "image/svg+xml";
            break;
        case ".txt":
            mimeType = "text/plain";
            break;
        case ".md":
            mimeType = "text/markdown";
            break;
        case ".json":
            mimeType = "application/json";
            break;
        default:
            // Handle files without extensions that are usually text
            if (["LICENSE", "NOTICE", "AUTHORS", "README"].includes(path.basename(filePath).toUpperCase())) {
                mimeType = "text/plain";
            }
            break;
    }

    return `data:${mimeType};base64,${base64}`;
}

/**
 * Utility to load PDF or text files for model consumption.
 * It returns the content as plain text for text files, or as a base64 data URL for PDFs.
 * @param filePath Path to the file.
 * @returns Promise resolving to an object with the file content and its type.
 */
export async function loadFileForModel(filePath: string): Promise<{ 
    content: string; 
    mimeType: string; 
    type: "text" | "binary";
    filename: string;
}> {
    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);

    if (ext === ".pdf") {
        const dataUrl = await loadFileAsDataUrl(filePath);
        return {
            content: dataUrl,
            mimeType: "application/pdf",
            type: "binary",
            filename
        };
    }

    // List of extensions to treat as text
    const textExtensions = [".txt", ".md", ".json", ".js", ".ts", ".html", ".css", ".py", ".csv", ".xml", ".yaml", ".yml", ""];
    const textFiles = ["LICENSE", "NOTICE", "AUTHORS", "README"];
    
    if (textExtensions.includes(ext) || textFiles.includes(path.basename(filePath).toUpperCase())) {
        const content = await loadTextFile(filePath);
        let mimeType = "text/plain";
        if (ext === ".md") mimeType = "text/markdown";
        if (ext === ".json") mimeType = "application/json";
        
        return {
            content,
            mimeType,
            type: "text",
            filename
        };
    }

    // For other files (images, etc.), return as binary data URL
    const dataUrl = await loadFileAsDataUrl(filePath);
    const mimeTypeMatch = dataUrl.match(/^data:([^;]+);base64,/);
    
    return {
        content: dataUrl,
        mimeType: mimeTypeMatch ? mimeTypeMatch[1] : "application/octet-stream",
        type: "binary",
        filename
    };
}
