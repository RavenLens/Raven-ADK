import { MultipleAnswers, type InvokeOptions } from "../multianswers";

export type SelfConsistencyAbstentionReason =
	| "NO_VALID_CANDIDATES"
	| "NOT_ENOUGH_CANDIDATES"
	| "INSUFFICIENT_AGREEMENT";

export interface SelfConsistencyCandidateInput<Answer = any, Result = any> {
	id: string;
	result: Result;
	answer: Answer;
	normalizedAnswer: string;
}

export interface SelfConsistencyCandidate<Answer = any, Result = any>
	extends SelfConsistencyCandidateInput<Answer, Result> {
	weight: number;
}

export interface SelfConsistencyInvalidCandidate<Result = any> {
	id: string;
	result: Result;
	error: Error;
}

export interface SelfConsistencyCluster<Answer = any, Result = any> {
	normalizedAnswer: string;
	candidates: SelfConsistencyCandidate<Answer, Result>[];
	weight: number;
	agreement: number;
}

interface SelfConsistencyResultBase<Answer, Result> {
	candidates: SelfConsistencyCandidate<Answer, Result>[];
	invalidCandidates: SelfConsistencyInvalidCandidate<Result>[];
	clusters: SelfConsistencyCluster<Answer, Result>[];
	winner: SelfConsistencyCluster<Answer, Result> | undefined;
	agreement: number;
}

export interface SelfConsistencyAccepted<Answer = any, Result = any>
	extends SelfConsistencyResultBase<Answer, Result> {
	status: "accepted";
	answer: Answer;
}

export interface SelfConsistencyAbstained<Answer = any, Result = any>
	extends SelfConsistencyResultBase<Answer, Result> {
	status: "abstained";
	answer: undefined;
	reason: SelfConsistencyAbstentionReason;
}

export type SelfConsistencyResult<Answer = any, Result = any> =
	| SelfConsistencyAccepted<Answer, Result>
	| SelfConsistencyAbstained<Answer, Result>;


/**
 * Configuration for extracting, comparing, and accepting candidate answers.
 * @typeParam Answer Type of the answer selected from a candidate result. Defaults to `any` when omitted.
	 * @typeParam Result Type returned by each candidate runner. Defaults to `any` for compatibility with untyped runners.
 */
export interface SelfConsistencyOptions<Answer = any, Result = any> {
	/** Candidate runners used to generate independent results. */
	candidates: MultipleAnswers<Result>;
	/** Converts one raw runner result into the answer that should be compared. */
	extract?: (result: Result) => Answer;
	/** Converts an answer into the key used to group candidates into clusters. */
	normalize?: (answer: Answer) => string;
	/** Returns the positive finite influence of a candidate in its cluster. */
	weight?: (candidate: SelfConsistencyCandidateInput<Answer, Result>) => number;
	/** Minimum winning-cluster share required to accept a result, from `0` to `1`. */
	minAgreement?: number;
	/** Minimum number of valid candidates required before accepting a result. */
	minCandidates?: number;
}

export interface SelfConsistencyEvents<Answer = any, Result = any> {
	start: (options: InvokeOptions) => any;
	candidate: (candidate: SelfConsistencyCandidate<Answer, Result>) => any;
	invalid_candidate: (candidate: SelfConsistencyInvalidCandidate<Result>) => any;
	end: (result: SelfConsistencyResult<Answer, Result>) => any;
}

function extractDefaultAnswer<Result, Answer = unknown>(result: Result): Answer {
	if (!result || typeof result !== "object") {
		return result as unknown as Answer;
	}

	const record = result as Record<string, unknown>;
	const messages = record.messages ?? record.answer;
	if (!Array.isArray(messages) || messages.length === 0) {
		return result as unknown as Answer;
	}

	const lastMessage = messages.at(-1);
	if (!lastMessage || typeof lastMessage !== "object") {
		return lastMessage;
	}

	const message = lastMessage as Record<string, unknown>;
	if (message.structuredOutput !== undefined) {
		return message.structuredOutput as unknown as Answer;
	}

	return "content" in message ? (message.content) as unknown as Answer : lastMessage;
}

function serializeForComparison(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value) ?? String(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map(serializeForComparison).join(",")}]`;
	}

	const record = value as Record<string, unknown>;
	const entries = Object.keys(record)
		.sort()
		.map(key => `${JSON.stringify(key)}:${serializeForComparison(record[key])}`);

	return `{${entries.join(",")}}`;
}

function normalizeDefaultAnswer<Answer = any>(answer: Answer): string {
	if (typeof answer === "string") {
		return answer.trim().replace(/\s+/g, " ").toLowerCase();
	}

	return serializeForComparison(answer);
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export class SelfConsistency<Answer = any, Result = any> {
	readonly candidates: MultipleAnswers<Result>;
	readonly minAgreement: number;
	readonly minCandidates: number;

	/**
	 * Extracts the comparable answer from a raw candidate result.
	 * @param result Raw result returned by a candidate runner.
	 * @returns {Answer} Answer value to normalize and compare.
	 */
	private readonly extract: (result: Result) => Answer;
	/**
	 * Converts an answer into the cluster key used for equality comparison.
	 * @param answer Extracted candidate answer.
	 * @returns {string} Normalized answer key.
	 */
	private readonly normalize: (answer: Answer) => string;
	/**
	 * Assigns a candidate's influence when calculating cluster agreement.
	 * @param candidate Candidate data before its weight is assigned.
	 * @returns {number} Positive finite weight for the candidate.
	 */
	private readonly weight: (
		candidate: SelfConsistencyCandidateInput<Answer, Result>
	) => number;
	private readonly eventsListeners: Record<string, ((...args: any[]) => void)[]> = {};

	/**
	 * Creates a self-consistency runner with candidate and comparison policies.
	 * @param options Candidate runner, answer extraction, normalization, weighting, and thresholds.
	 * @throws {RangeError} If `minAgreement` or `minCandidates` is invalid.
	 */
	constructor(options: SelfConsistencyOptions<Answer, Result>) {
		const minAgreement = options.minAgreement ?? 2 / 3;
		const minCandidates = options.minCandidates ?? 2;

		if (!Number.isFinite(minAgreement) || minAgreement < 0 || minAgreement > 1) {
			throw new RangeError("minAgreement must be a number between 0 and 1.");
		}

		if (!Number.isInteger(minCandidates) || minCandidates < 1) {
			throw new RangeError("minCandidates must be a positive integer.");
		}

		this.candidates = options.candidates;
		this.minAgreement = minAgreement;
		this.minCandidates = minCandidates;
		this.extract = (options.extract ?? extractDefaultAnswer) as (result: Result) => Answer;
		this.normalize = (options.normalize ?? normalizeDefaultAnswer) as (answer: Answer) => string;
		this.weight = options.weight ?? (() => 1);
	}

	/**
	 * Registers a listener for a self-consistency lifecycle event.
	 * @param event Event name to observe.
	 * @param listener Callback invoked with the event-specific arguments.
	 * @returns {void} Nothing.
	 */
	onEvent<K extends keyof SelfConsistencyEvents<Answer, Result>>(
		event: K,
		listener: SelfConsistencyEvents<Answer, Result>[K]
	): void {
		if (!this.eventsListeners[event]) {
			this.eventsListeners[event] = [];
		}

		this.eventsListeners[event].push(listener as (...args: any[]) => void);
	}

	/**
	 * Notifies the listeners registered for one lifecycle event.
	 * @param event Event name to emit.
	 * @param args Event-specific arguments passed to each listener.
	 * @returns {void} Nothing.
	 */
	private emit<K extends keyof SelfConsistencyEvents<Answer, Result>>(
		event: K,
		...args: Parameters<SelfConsistencyEvents<Answer, Result>[K]>
	): void {
		for (const listener of this.eventsListeners[event] ?? []) {
			listener(...args);
		}
	}

	/**
	 * Runs a consistency check using a readable method name.
	 * @param options Messages to provide to every candidate and an optional abort signal.
	 * @returns {Promise<SelfConsistencyResult<Answer, Result>>} Accepted consensus or an abstention result.
	 */
	async check(options: InvokeOptions): Promise<SelfConsistencyResult<Answer, Result>> {
		return this.invoke(options);
	}

	/**
	 * Runs candidates, builds normalized clusters, and applies the consistency policy.
	 * @param options Messages to provide to every candidate and an optional abort signal.
	 * @returns {Promise<SelfConsistencyResult<Answer, Result>>} Accepted consensus or an abstention result with evidence.
	 */
	async invoke(options: InvokeOptions): Promise<SelfConsistencyResult<Answer, Result>> {
		this.emit("start", options);

		const rawResults = await this.candidates.invoke(options);
		const candidates: SelfConsistencyCandidate<Answer, Result>[] = [];
		const invalidCandidates: SelfConsistencyInvalidCandidate<Result>[] = [];

		for (const [id, rawResult] of rawResults) {
			try {
				const result = rawResult;
				const answer = this.extract(result);
				const normalizedAnswer = this.normalize(answer);

				if (typeof normalizedAnswer !== "string" || normalizedAnswer.length === 0) {
					throw new Error("The normalized answer must be a non-empty string.");
				}

				const candidateInput: SelfConsistencyCandidateInput<Answer, Result> = {
					id,
					result,
					answer,
					normalizedAnswer
				};
				const weight = this.weight(candidateInput);

				if (!Number.isFinite(weight) || weight <= 0) {
					throw new Error("Candidate weight must be a positive finite number.");
				}

				const candidate = { ...candidateInput, weight };
				candidates.push(candidate);
				this.emit("candidate", candidate);
			}
			catch (error) {
				const invalidCandidate = {
					id,
					result: rawResult,
					error: asError(error)
				};
				invalidCandidates.push(invalidCandidate);
				this.emit("invalid_candidate", invalidCandidate);
			}
		}

		const clusters = this.createClusters(candidates);
		const winner = clusters[0];
		const agreement = winner?.agreement ?? 0;
		const baseResult = {
			candidates,
			invalidCandidates,
			clusters,
			winner,
			agreement
		};

		let result: SelfConsistencyResult<Answer, Result>;
		if (candidates.length === 0) {
			result = {
				...baseResult,
				status: "abstained",
				answer: undefined,
				reason: "NO_VALID_CANDIDATES"
			};
		}
		else if (candidates.length < this.minCandidates) {
			result = {
				...baseResult,
				status: "abstained",
				answer: undefined,
				reason: "NOT_ENOUGH_CANDIDATES"
			};
		}
		else if (!winner || agreement < this.minAgreement) {
			result = {
				...baseResult,
				status: "abstained",
				answer: undefined,
				reason: "INSUFFICIENT_AGREEMENT"
			};
		}
		else {
			result = {
				...baseResult,
				status: "accepted",
				answer: winner.candidates[0].answer,
				winner
			};
		}

		this.emit("end", result);
		return result;
	}

	/**
	 * Groups valid candidates by normalized answer and ranks the resulting clusters.
	 * Used by internall logic only = what tells the `private` specifier
	 * @param candidates Candidates that passed extraction, normalization, and weight validation.
	 * @returns {SelfConsistencyCluster<Answer, Result>[]} Clusters sorted by descending weight.
	 */
	private createClusters(
		candidates: SelfConsistencyCandidate<Answer, Result>[]
	): SelfConsistencyCluster<Answer, Result>[] {
		const grouped = new Map<string, SelfConsistencyCandidate<Answer, Result>[]>();

		for (const candidate of candidates) {
			const group = grouped.get(candidate.normalizedAnswer) ?? [];
			group.push(candidate);
			grouped.set(candidate.normalizedAnswer, group);
		}

		const totalWeight = candidates.reduce((total, candidate) => total + candidate.weight, 0);
		return [...grouped.entries()]
			.map(([normalizedAnswer, group]) => {
				const weight = group.reduce((total, candidate) => total + candidate.weight, 0);
				return {
					normalizedAnswer,
					candidates: group,
					weight,
					agreement: weight / totalWeight
				};
			})
			.sort((left, right) =>
				right.weight - left.weight ||
				right.candidates.length - left.candidates.length
			);
	}
}
