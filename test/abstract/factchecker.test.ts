import { describe, expect, it, vi } from "vitest";
import { FactChecker, TruthnessState } from "../../src/agent/abstract/factchecker/factchecker";

vi.mock("../../src/agent/abstract/aeval/aeval", () => ({
    AgenticEvaluator: class MockAgenticEvaluator {
        constructor(private readonly messages: { content: string }[]) {}

        async evaluate() {
            const candidate = JSON.parse(this.messages.at(-1)!.content) as TruthnessState;
            return {
                result: {
                    score: candidate.truthy ? 0.9 : 0.2,
                    verdict: candidate.truthy ? "BEST" : "REJECTED",
                    reasoning: "The mocked judge selected the truthy candidate.",
                    metrics: {}
                },
                messages: []
            };
        }
    }
}));

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

    it("requires a judge when overlapping verifiers disagree", async () => {
        const checker = new FactChecker({
            toCheck: "A fact",
            verifiers: [
                async (): Promise<TruthnessState> => ({
                    from: 0,
                    to: 6,
                    truthy: true,
                    baseOnRecource: "truthy evidence"
                }),
                async (): Promise<TruthnessState> => ({
                    from: 0,
                    to: 6,
                    truthy: false,
                    baseOnRecource: "corrected evidence"
                })
            ]
        });

        await expect(checker.check()).rejects.toThrow(
            "Configure a `judge` to resolve overlapping truthiness conflicts"
        );
    });

    it("uses the AgenticEvaluator judge to select the strongest conflicting result", async () => {
        const checker = new FactChecker({
            toCheck: "A fact",
            verifiers: [
                async (): Promise<TruthnessState> => ({
                    from: 0,
                    to: 6,
                    truthy: false,
                    baseOnRecource: "corrected evidence"
                }),
                async (): Promise<TruthnessState> => ({
                    from: 0,
                    to: 6,
                    truthy: true,
                    baseOnRecource: "verified evidence"
                })
            ],
            judge: { model: {} as any }
        });

        await expect(checker.check()).resolves.toEqual([{
            from: 0,
            to: 6,
            truthy: true,
            baseOnRecource: "verified evidence"
        }]);
    });

    it("does not treat disjoint ranges with different verdicts as a conflict", async () => {
        const ratings: TruthnessState[] = [
            { from: 0, to: 1, truthy: true, baseOnRecource: "A" },
            { from: 1, to: 2, truthy: false, baseOnRecource: "B" }
        ];
        const checker = new FactChecker({
            toCheck: "AB",
            verifiers: [
                async () => ratings[0],
                async () => ratings[1]
            ]
        });

        await expect(checker.check()).resolves.toEqual(ratings);
    });
});