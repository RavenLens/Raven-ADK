import { describe, expect, it, vi } from "vitest";
import { FactChecker, TruthnessState } from "../../src/agent/abstract/factchecker/factchecker";

describe("FactChecker", () => {
    it("runs a single verifier against the configured text", async () => {
        const verifier = vi.fn(async (fact: string): Promise<TruthnessState> => ({
            from: 0,
            to: fact.length,
            truthy: true,
            baseOnRecource: "verified source"
        }));
        const checker = new FactChecker({ toCheck: "A fact", verifiers: verifier });

        await expect(checker.check()).resolves.toEqual([{
            from: 0,
            to: 6,
            truthy: true,
            baseOnRecource: "verified source"
        }]);
        expect(verifier).toHaveBeenCalledWith("A fact");
    });

    it("runs multiple verifiers concurrently and preserves their order", async () => {
        const first = vi.fn(async (): Promise<TruthnessState> => ({
            from: 0,
            to: 1,
            truthy: true,
            baseOnRecource: "first source"
        }));
        const second = vi.fn(async (): Promise<TruthnessState> => ({
            from: 1,
            to: 2,
            truthy: false,
            baseOnRecource: "second source"
        }));
        const checker = new FactChecker({ toCheck: "AB", verifiers: [first, second] });

        await expect(checker.check()).resolves.toEqual([
            await first.mock.results[0]?.value,
            await second.mock.results[0]?.value
        ]);
        expect(first).toHaveBeenCalledWith("AB");
        expect(second).toHaveBeenCalledWith("AB");
    });

    it("replaces untruthful ranges from right to left and leaves truthful ranges unchanged", async () => {
        const original = "Alpha beta gamma";
        const checker = new FactChecker({
            toCheck: original,
            verifiers: (vi.fn()) as any
        });

        const improved = await checker.improve([
            { from: 0, to: 5, truthy: true, baseOnRecource: "ignored" },
            { from: 6, to: 10, truthy: false, baseOnRecource: "BETA" }
        ]);

        expect(improved).toBe("Alpha BETA gamma");
        expect(checker.config.toCheck).toBe(original);
    });
});