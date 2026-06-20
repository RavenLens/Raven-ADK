import { describe, expect, it } from "vitest";
import * as path from "path";
import { loadFileForModel, loadTextFile, loadFileAsDataUrl } from "../../src/utils/files";

describe("Files utils", () => {
    it("should load text file", async () => {
        const licensePath = path.resolve(__dirname, "../../LICENSE");
        const content = await loadTextFile(licensePath);
        expect(content).toContain("Apache License");
    });

    it("should load file as data URL", async () => {
        const licensePath = path.resolve(__dirname, "../../LICENSE");
        const dataUrl = await loadFileAsDataUrl(licensePath);
        expect(dataUrl).toContain("data:text/plain;base64,");
    });

    it("should load file for model based on type (text)", async () => {
        const licensePath = path.resolve(__dirname, "../../LICENSE");
        const result = await loadFileForModel(licensePath);
        expect(result.type).toBe("text");
        expect(result.content).toContain("Apache License");
        expect(result.filename).toBe("LICENSE");
    });

    it("should handle unknown extensions as binary", async () => {
        const pkgPath = path.resolve(__dirname, "../../package.json");
        const result = await loadFileForModel(pkgPath);
        expect(result.type).toBe("text");
        expect(result.mimeType).toBe("application/json");
    });
});
