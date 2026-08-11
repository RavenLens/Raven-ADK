import { AgenticEvaluator } from "../aeval/aeval";
import type { AgentModel } from "../../ReAct.agent";
import type { MessagesVariations } from "../../state";
import type { Tool } from "../../tools/tools";
import { recordEventWithData, withTelemetry } from "../../../telemetry/telemetry";

export interface TruthnessState { 
    from: number;
    to: number;
    truthy: boolean; 
    baseOnRecource: string;
};

export type FactSentry = (fact: string) => TruthnessState | Promise<TruthnessState>;

export interface FactCheckerJudgeConfig {
    /** Model used by AgenticEvaluator to compare conflicting verifier results. */
    model: AgentModel;
    /** Additional instructions for the conflict judge. */
    systemPrompt?: string;
    /** Optional tools the AgenticEvaluator may use to inspect evidence. */
    tools?: Tool<any, any>[];
}

export interface FactCheckerConfig {
    toCheck: string;
    verifiers: FactSentry | FactSentry[];
    /** Required when overlapping verifier ranges disagree about truthiness. */
    judge?: FactCheckerJudgeConfig;
}

const DEFAULT_JUDGE_PROMPT = [
    "You are the conflict judge for a factual verification pipeline.",
    "Compare the candidate verifier result in the AI response with the claim and the competing verifier results in the conversation.",
    "Judge the quality and relevance of the evidence, not the position of a candidate in the list and not a majority vote alone.",
    "A higher score means that the candidate is the strongest supported resolution of the conflict.",
    "Use configured tools when additional evidence is needed."
].join("\n");

const VERDICT_PRIORITY = {
    REJECTED: 1,
    POOR: 2,
    GOOD: 3,
    BEST: 4
} as const;

export class FactChecker {
    config: FactCheckerConfig;
    
    constructor(config: FactCheckerConfig) {
        this.config = config;
    }

    async check(): Promise<TruthnessState[]> {
        const verifierCount = Array.isArray(this.config.verifiers)
            ? this.config.verifiers.length
            : 1;
        return withTelemetry("factchecker.check", {
            verifier_count: verifierCount,
            claim_length: this.config.toCheck.length,
            has_judge: Boolean(this.config.judge)
        }, async () => this.checkInternal());
    }

    private async checkInternal(): Promise<TruthnessState[]> {
        const verifiers = Array.isArray(this.config.verifiers)
            ? this.config.verifiers
            : [this.config.verifiers];
        const ratings = await Promise.all(verifiers.map(verifier => verifier(this.config.toCheck)));
        const conflictGroups = this.findConflictGroups(ratings);
        const conflictedIndexes = new Set(conflictGroups.flat());

        recordEventWithData("factchecker.verification.completed", {
            verifier_count: verifiers.length,
            rating_count: ratings.length,
            truthful_count: ratings.filter(({ truthy }) => truthy).length,
            conflict_group_count: conflictGroups.length,
            conflicted_rating_count: conflictedIndexes.size
        });

        if (!conflictGroups.length) {
            recordEventWithData("factchecker.check.completed", {
                returned_rating_count: ratings.length,
                conflicts_resolved: 0
            });
            return ratings;
        }

        if (!this.config.judge) {
            recordEventWithData("factchecker.conflict_judge.required", {
                conflict_group_count: conflictGroups.length,
                conflicted_rating_count: conflictedIndexes.size
            });
            throw new Error(
                "FactChecker found conflicting verifier results. Configure a `judge` to resolve overlapping truthiness conflicts."
            );
        }

        const winningIndexes = new Set<number>();
        for (const conflictGroup of conflictGroups) {
            const winningIndex = await this.judgeConflict(ratings, conflictGroup);
            winningIndexes.add(winningIndex);
            recordEventWithData("factchecker.conflict.resolved", {
                candidate_count: conflictGroup.length,
                truthful_candidate_count: conflictGroup.filter(index => ratings[index].truthy).length,
                winner_index: winningIndex
            });
        }

        const resolvedRatings = ratings.filter((_, index) =>
            !conflictedIndexes.has(index) || winningIndexes.has(index)
        );
        recordEventWithData("factchecker.check.completed", {
            returned_rating_count: resolvedRatings.length,
            conflicts_resolved: winningIndexes.size
        });

        return resolvedRatings;
    }

    /** Replaces untruthful ranges with the evidence supplied by their verifiers. */
    async improve(rating: TruthnessState[]): Promise<string> {
        return withTelemetry("factchecker.improve", {
            rating_count: rating.length,
            claim_length: this.config.toCheck.length
        }, async () => this.improveInternal(rating));
    }

    private async improveInternal(rating: TruthnessState[]): Promise<string> {
        let improved = this.config.toCheck;

        const untruthfulRatings = rating
            .map((state, index) => ({ state, index }))
            .filter(({ state }) => !state.truthy)
            .sort((left, right) =>
                right.state.from - left.state.from ||
                right.state.to - left.state.to ||
                right.index - left.index
            );

        for (const { state } of untruthfulRatings) {
            improved = improved.slice(0, state.from) + state.baseOnRecource + improved.slice(state.to);
            recordEventWithData("factchecker.improvement.replacement", {
                from: state.from,
                to: state.to,
                replacement_length: state.baseOnRecource.length
            });
        }

        recordEventWithData("factchecker.improvement.completed", {
            rating_count: rating.length,
            replacement_count: untruthfulRatings.length,
            original_length: this.config.toCheck.length,
            improved_length: improved.length
        });

        return improved;

    }

    private findConflictGroups(ratings: readonly TruthnessState[]): number[][] {
        const parents = ratings.map((_, index) => index);

        const findRoot = (index: number): number => {
            let root = index;
            while (parents[root] !== root) {
                root = parents[root];
            }

            while (parents[index] !== index) {
                const next = parents[index];
                parents[index] = root;
                index = next;
            }

            return root;
        };

        const merge = (left: number, right: number): void => {
            const leftRoot = findRoot(left);
            const rightRoot = findRoot(right);
            if (leftRoot !== rightRoot) {
                parents[rightRoot] = leftRoot;
            }
        };

        for (let leftIndex = 0; leftIndex < ratings.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < ratings.length; rightIndex += 1) {
                const left = ratings[leftIndex];
                const right = ratings[rightIndex];
                if (
                    left.truthy !== right.truthy &&
                    left.from < right.to &&
                    right.from < left.to
                ) {
                    merge(leftIndex, rightIndex);
                }
            }
        }

        const groups = new Map<number, number[]>();
        ratings.forEach((_, index) => {
            const root = findRoot(index);
            const group = groups.get(root) ?? [];
            group.push(index);
            groups.set(root, group);
        });

        return [...groups.values()].filter(group => group.length > 1);
    }

    private async judgeConflict(
        ratings: readonly TruthnessState[],
        conflictIndexes: readonly number[]
    ): Promise<number> {
        const judgeConfig = this.config.judge!;
        const candidates = conflictIndexes.map(index => ratings[index]);
        const evaluations: {
            index: number;
            score: number;
            verdict: keyof typeof VERDICT_PRIORITY;
        }[] = [];

        for (const index of conflictIndexes) {
            const candidate = ratings[index];
            const messages: MessagesVariations[] = [
                {
                    type: "user",
                    content: [
                        "Resolve a conflict between factual verifiers.",
                        `Claim being checked:\n${this.config.toCheck}`,
                        `Competing verifier results:\n${JSON.stringify(candidates, null, 2)}`,
                        "The AI response below is one candidate result. Evaluate whether it is the strongest evidence-supported resolution."
                    ].join("\n\n")
                },
                {
                    type: "ai",
                    content: JSON.stringify(candidate, null, 2)
                }
            ];
            const evaluator = new AgenticEvaluator(messages, {
                model: judgeConfig.model,
                systemPrompt: judgeConfig.systemPrompt ?? DEFAULT_JUDGE_PROMPT,
                tools: judgeConfig.tools ?? []
            });
            const evaluation = await evaluator.evaluate();
            evaluations.push({
                index,
                score: evaluation.result.score,
                verdict: evaluation.result.verdict
            });
        }

        evaluations.sort((left, right) =>
            right.score - left.score ||
            VERDICT_PRIORITY[right.verdict] - VERDICT_PRIORITY[left.verdict] ||
            left.index - right.index
        );

        return evaluations[0].index;
    }
}
