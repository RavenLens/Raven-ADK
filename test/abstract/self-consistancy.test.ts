import { describe, expect, it } from "vitest";
import {
    MultipleAnswers,
    type InvokeOptions,
    SelfConsistency
} from "../../src/agent";
import type { MessagesVariations } from "../../src/agent/state";

const messages: MessagesVariations[] = [
    { type: "user", content: "What is the capital of France?" }
];

type CandidateResult = {
    messages: MessagesVariations[];
};

function createCandidates(answers: string[]): MultipleAnswers<CandidateResult> {
    return new MultipleAnswers(
        answers.map(answer => async ({ messages: context }: InvokeOptions) => ({
            messages: [
                ...context,
                { type: "ai", content: answer }
            ]
        }))
    );
}

describe("SelfConsistency", () => {
    it("accepts the strongest normalized answer cluster", async () => {
        const consistency = new SelfConsistency({
            candidates: createCandidates(["Paris", " paris ", "London"]),
            minAgreement: 2 / 3
        });

        const result = await consistency.invoke({ messages });

        expect(result.status).toBe("accepted");
        expect(result.answer).toBe("Paris");
        expect(result.agreement).toBe(2 / 3);
        expect(result.winner?.candidates).toHaveLength(2);
    });

    it("abstains when no cluster reaches the agreement threshold", async () => {
        const consistency = new SelfConsistency({
            candidates: createCandidates(["Paris", "London", "Berlin"]),
            minAgreement: 2 / 3
        });

        const result = await consistency.check({ messages });

        expect(result).toMatchObject({
            status: "abstained",
            answer: undefined,
            reason: "INSUFFICIENT_AGREEMENT",
            agreement: 1 / 3
        });
    });

    it("keeps extraction failures separate from valid candidates", async () => {
        const consistency = new SelfConsistency<string, CandidateResult>({
            candidates: createCandidates(["Paris", "invalid", "Paris"]),
            extract: result => {
                const content = result.messages?.at(-1)?.content;
                if (content === "invalid") {
                    throw new Error("Candidate could not be parsed");
                }
                return String(content);
            }
        });

        const result = await consistency.invoke({ messages });

        expect(result.status).toBe("accepted");
        expect(result.invalidCandidates).toHaveLength(1);
        expect(result.invalidCandidates[0].error.message).toBe("Candidate could not be parsed");
        expect(result.answer).toBe("Paris");
    });
});
