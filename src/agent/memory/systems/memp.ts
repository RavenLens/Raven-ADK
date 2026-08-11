import {
	DeterministicFunctionInstruction,
	DeterministicMemoryConfig,
	DeterministicMemorySchema
} from "../schema/deterministicMemorySchema";
import z from "zod";

const DEFAULT_SCOPE = "default";
const DEFAULT_TOP_K = 3;
const DEFAULT_SIMILARITY_THRESHOLD = 0.01;
const STOP_WORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "with"
]);

type Awaitable<Value> = Value | Promise<Value>;

export type MemPProcedureStatus = "active" | "deprecated";
export type MemPUpdatePolicy = "vanilla" | "validation" | "adjustment";

/** A reusable procedure with both concrete experience and generalized guidance. */
export interface MemPProcedure {
	id: string;
	scope: string;
	/** The task description or retrieval key used to find this procedure. */
	key: string;
	/** Fine-grained instructions distilled from a successful trajectory. */
	steps: string[];
	/** Higher-level, transferable abstraction of the trajectory. */
	script: string;
	tags: string[];
	status: MemPProcedureStatus;
	revision: number;
	createdAt: number;
	updatedAt: number;
	deprecatedAt?: number;
	deprecationReason?: string;
	metadata?: Record<string, unknown>;
}

export const memPProcedureSchema: z.ZodType<MemPProcedure> = z.object({
	id: z.string(), scope: z.string(), key: z.string(), steps: z.array(z.string()),
	script: z.string(), tags: z.array(z.string()), status: z.enum(["active", "deprecated"]),
	revision: z.number(), createdAt: z.number(), updatedAt: z.number(),
	deprecatedAt: z.number().optional(), deprecationReason: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional()
});

export interface MemPProcedureDraft {
	id?: string;
	key: string;
	steps: readonly string[];
	script: string;
	tags?: readonly string[];
	metadata?: Record<string, unknown>;
}

export interface MemPProcedurePatch {
	key?: string;
	steps?: readonly string[];
	script?: string;
	tags?: readonly string[];
	metadata?: Record<string, unknown>;
}

/** Persistence boundary for a procedural-memory repository. */
export interface MemPProcedureStore {
	list(scope: string): Awaitable<readonly MemPProcedure[]>;
	get(scope: string, procedureId: string): Awaitable<MemPProcedure | undefined>;
	set(procedure: MemPProcedure): Awaitable<void>;
	delete(scope: string, procedureId: string): Awaitable<void>;
}

export interface MemPProcedureCandidate {
	procedure: MemPProcedure;
	/** A normalized retrieval score in the inclusive range [0, 1]. */
	similarity: number;
}

export interface MemPRankedProcedure extends MemPProcedureCandidate {
	rank: number;
}

export interface MemPRetrievalOptions {
	scope?: string;
	topK?: number;
	similarityThreshold?: number;
}

export interface MemPRetrievalResult {
	scope: string;
	query: string;
	procedures: MemPRankedProcedure[];
}

export interface MemPRetrieverContext {
	scope: string;
	topK: number;
	similarityThreshold: number;
}

/** Adapt a vector, BM25, or hybrid search implementation to MemP. */
export type MemPRetriever = (
	query: string,
	context: MemPRetrieverContext
) => Awaitable<readonly MemPProcedureCandidate[]>;

export type MemPUpdate =
	| { type: "add"; procedure: MemPProcedureDraft; }
	| { type: "update"; procedureId: string; patch: MemPProcedurePatch; }
	| { type: "deprecate"; procedureId: string; reason: string; }
	| { type: "remove"; procedureId: string; };

export interface MemPUpdateResult {
	action: MemPUpdate["type"];
	procedure?: MemPProcedure;
}

export interface MemPLifecycleContext {
	phase: "conversation" | "orchestrator" | "subagent";
	scope: string;
	isAsync: boolean;
}

/**
 * Converts an agent trajectory and its outcome into explicit repository operations.
 * Applications normally use an LLM or a domain-specific evaluator to implement it.
 */
export type MemPUpdateBuilder = (
	instruction: DeterministicFunctionInstruction,
	context: MemPLifecycleContext
) => Awaitable<MemPUpdate | readonly MemPUpdate[] | null | undefined>;

export type MemPOutcomeEvaluator = (
	instruction: DeterministicFunctionInstruction,
	context: MemPLifecycleContext
) => Awaitable<boolean>;

export type MemPQueryBuilder = (
	instruction: DeterministicFunctionInstruction,
	context: MemPLifecycleContext
) => Awaitable<string | undefined>;

export interface MemPConfig extends Omit<DeterministicMemoryConfig, "tools"> {
	/** Optional because MemP can operate without deterministic agent tools. */
	tools?: DeterministicMemoryConfig["tools"];
	/** Namespace that separates procedures for users, teams, or environments. */
	scope?: string;
	/** Maximum procedures retained in one retrieval result. */
	topK?: number;
	/** Minimum normalized retrieval score accepted into the agent context. */
	similarityThreshold?: number;
	/** Use a durable implementation in production; the default is process-local. */
	store?: MemPProcedureStore;
	/** Replaces the built-in lexical fallback with semantic, BM25, or hybrid retrieval. */
	retriever?: MemPRetriever;
	/** Builds a query from agent state before the pre-run lifecycle hooks retrieve memory. */
	queryBuilder?: MemPQueryBuilder;
	/** Builds add, update, deprecate, or remove operations from a completed trajectory. */
	updateBuilder?: MemPUpdateBuilder;
	/** Matches the paper's vanilla append, successful-trajectory validation, and adjustment modes. */
	updatePolicy?: MemPUpdatePolicy;
	/** Required by the validation policy to decide whether a trajectory may be consolidated. */
	outcomeEvaluator?: MemPOutcomeEvaluator;
	/** Converts a retrieved procedure into the context attached by deterministic hooks. */
	formatProcedureForAwareness?: (procedure: MemPRankedProcedure) => string;
	idFactory?: () => string;
	now?: () => number;
}

type ResolvedMemPConfig = Omit<MemPConfig, "tools"> & {
	tools: DeterministicMemoryConfig["tools"];
};

/** Default process-local store. Supply a durable store to retain procedures across processes. */
export class InMemoryMemPProcedureStore implements MemPProcedureStore {
	private readonly procedures = new Map<string, MemPProcedure>();

	async list(scope: string): Promise<readonly MemPProcedure[]> {
		return [...this.procedures.values()]
			.filter(procedure => procedure.scope === scope)
			.map(procedure => cloneProcedure(memPProcedureSchema.parse(procedure)));
	}

	async get(scope: string, procedureId: string): Promise<MemPProcedure | undefined> {
		const procedure = this.procedures.get(this.createKey(scope, procedureId));
		return procedure ? cloneProcedure(memPProcedureSchema.parse(procedure)) : undefined;
	}

	async set(procedure: MemPProcedure): Promise<void> {
		const validatedProcedure = memPProcedureSchema.parse(procedure);
		this.procedures.set(this.createKey(validatedProcedure.scope, validatedProcedure.id), cloneProcedure(validatedProcedure));
	}

	async delete(scope: string, procedureId: string): Promise<void> {
		this.procedures.delete(this.createKey(scope, procedureId));
	}

	private createKey(scope: string, procedureId: string): string {
		return JSON.stringify([scope, procedureId]);
	}
}

/**
 * MemP is a procedural-memory repository based on Build, Retrieve, and Update.
 * It stores both step-by-step trajectories and their script-like abstractions.
 */
export class MemP implements DeterministicMemorySchema {
	typeMemory: "deterministic" = "deterministic";
	config: ResolvedMemPConfig;

	private readonly store: MemPProcedureStore;
	private procedureSequence = 0;

	constructor(config: MemPConfig) {
		this.assertConfiguration(config);

		this.config = {
			...config,
			tools: config.tools ?? ({} as DeterministicMemoryConfig["tools"]),
			systemPrompt: config.systemPrompt ?? [
				"MemP supplies reusable procedural knowledge from prior agent trajectories.",
				"Use retrieved scripts and steps as guidance, but validate them against the current environment.",
				"Do not reuse deprecated procedures."
			].join("\n")
		};
		this.store = config.store ?? new InMemoryMemPProcedureStore();
	}

	/** Adds a procedure containing concrete steps and a higher-level script. */
	async addProcedure(draft: MemPProcedureDraft, scope?: string): Promise<MemPProcedure> {
		const resolvedScope = this.resolveScope(scope);
		const procedure = this.createProcedure(draft, resolvedScope);
		const existing = await this.store.get(resolvedScope, procedure.id);
		if (existing) {
			throw new Error(`MemP procedure "${procedure.id}" already exists in scope "${resolvedScope}".`);
		}

		await this.store.set(procedure);
		return cloneProcedure(procedure);
	}

	/** Revises an existing active procedure after new experience exposes a better approach. */
	async updateProcedure(procedureId: string, patch: MemPProcedurePatch, scope?: string): Promise<MemPProcedure> {
		const resolvedScope = this.resolveScope(scope);
		this.assertIdentifier(procedureId, "MemP procedureId");
		this.assertPatch(patch);

		const existing = await this.requireProcedure(resolvedScope, procedureId);
		if (existing.status === "deprecated") {
			throw new Error(`MemP procedure "${procedureId}" is deprecated and cannot be revised.`);
		}

		const revised: MemPProcedure = {
			...existing,
			key: patch.key === undefined ? existing.key : this.normalizeRequiredText(patch.key, "MemP procedure key"),
			steps: patch.steps === undefined ? [...existing.steps] : this.normalizeSteps(patch.steps),
			script: patch.script === undefined ? existing.script : this.normalizeRequiredText(patch.script, "MemP procedure script"),
			tags: patch.tags === undefined ? [...existing.tags] : this.normalizeTags(patch.tags),
			metadata: patch.metadata === undefined ? cloneMetadata(existing.metadata) : cloneMetadata(patch.metadata),
			revision: existing.revision + 1,
			updatedAt: this.getNow()
		};

		await this.store.set(revised);
		return cloneProcedure(revised);
	}

	/** Preserves an audit record while removing a procedure from future retrieval. */
	async deprecateProcedure(procedureId: string, reason: string, scope?: string): Promise<MemPProcedure> {
		const resolvedScope = this.resolveScope(scope);
		this.assertIdentifier(procedureId, "MemP procedureId");
		const normalizedReason = this.normalizeRequiredText(reason, "MemP deprecation reason");
		const existing = await this.requireProcedure(resolvedScope, procedureId);
		const deprecatedAt = this.getNow();
		const deprecated: MemPProcedure = {
			...existing,
			status: "deprecated",
			revision: existing.revision + 1,
			updatedAt: deprecatedAt,
			deprecatedAt,
			deprecationReason: normalizedReason
		};

		await this.store.set(deprecated);
		return cloneProcedure(deprecated);
	}

	/** Permanently removes a procedure when retaining an audit record is not needed. */
	async removeProcedure(procedureId: string, scope?: string): Promise<void> {
		const resolvedScope = this.resolveScope(scope);
		this.assertIdentifier(procedureId, "MemP procedureId");
		await this.requireProcedure(resolvedScope, procedureId);
		await this.store.delete(resolvedScope, procedureId);
	}

	/** Applies the paper's add, update, deprecate, or remove repository operation. */
	async applyUpdate(update: MemPUpdate, scope?: string): Promise<MemPUpdateResult> {
		const resolvedScope = this.resolveScope(scope);

		switch (update.type) {
			case "add":
				return {
					action: update.type,
					procedure: await this.addProcedure(update.procedure, resolvedScope)
				};
			case "update":
				return {
					action: update.type,
					procedure: await this.updateProcedure(update.procedureId, update.patch, resolvedScope)
				};
			case "deprecate":
				return {
					action: update.type,
					procedure: await this.deprecateProcedure(update.procedureId, update.reason, resolvedScope)
				};
			case "remove":
				await this.removeProcedure(update.procedureId, resolvedScope);
				return { action: update.type };
		}
	}

	async getProcedure(procedureId: string, scope?: string): Promise<MemPProcedure | undefined> {
		const resolvedScope = this.resolveScope(scope);
		this.assertIdentifier(procedureId, "MemP procedureId");
		const procedure = await this.store.get(resolvedScope, procedureId);
		return procedure ? cloneProcedure(procedure) : undefined;
	}

	async listProcedures(scope?: string): Promise<MemPProcedure[]> {
		const procedures = await this.store.list(this.resolveScope(scope));
		return procedures.map(procedure => cloneProcedure(procedure));
	}

	/** Retrieves active procedures with an injected retriever or the built-in lexical fallback. */
	async retrieve(query: string, options: MemPRetrievalOptions = {}): Promise<MemPRetrievalResult> {
		const normalizedQuery = this.normalizeRequiredText(query, "MemP retrieval query");
		const scope = this.resolveScope(options.scope);
		const topK = this.resolveTopK(options.topK);
		const similarityThreshold = this.resolveSimilarityThreshold(options.similarityThreshold);
		const candidates = this.config.retriever
			? await this.config.retriever(normalizedQuery, { scope, topK, similarityThreshold })
			: await this.retrieveFromStore(normalizedQuery, scope);
		const candidateIds = new Set<string>();

		const procedures = candidates
			.map((candidate, index) => {
				this.assertCandidate(candidate, scope);
				if (candidateIds.has(candidate.procedure.id)) {
					throw new Error(`MemP retrieval candidates must be unique: ${candidate.procedure.id}`);
				}
				candidateIds.add(candidate.procedure.id);

				return {
					procedure: cloneProcedure(candidate.procedure),
					similarity: candidate.similarity,
					index
				};
			})
			.filter(candidate =>
				candidate.procedure.status === "active" &&
				candidate.similarity >= similarityThreshold
			)
			.sort((left, right) =>
				right.similarity - left.similarity ||
				left.index - right.index
			)
			.slice(0, topK)
			.map((candidate, index) => ({
				procedure: candidate.procedure,
				similarity: candidate.similarity,
				rank: index + 1
			}));

		return {
			scope,
			query: normalizedQuery,
			procedures
		};
	}

	/** Retrieves relevant procedures before the orchestrator runs. */
	async beforeOrchestratorAgentRun(instruction: DeterministicFunctionInstruction, isAsync = false) {
		return await this.retrieveForAgent(instruction, "orchestrator", isAsync);
	}

	/** Retrieves relevant procedures before a subagent runs. */
	async beforeSubagentRun(instruction: DeterministicFunctionInstruction, isAsync = false) {
		return await this.retrieveForAgent(instruction, "subagent", isAsync);
	}

	/** Consolidates completed work into procedural-memory updates when configured. */
	async afterConversationEnd(instruction: DeterministicFunctionInstruction, isAsync = false) {
		return await this.updateForAgent(instruction, "conversation", isAsync);
	}

	/** Consolidates an orchestrator trajectory when configured. */
	async afterOrchestratorAgentRun(instruction: DeterministicFunctionInstruction, isAsync = false) {
		return await this.updateForAgent(instruction, "orchestrator", isAsync);
	}

	/** Consolidates a subagent trajectory when configured. */
	async afterSubagentRun(instruction: DeterministicFunctionInstruction, isAsync = false) {
		return await this.updateForAgent(instruction, "subagent", isAsync);
	}

	private async retrieveForAgent(
		instruction: DeterministicFunctionInstruction,
		phase: "orchestrator" | "subagent",
		isAsync: boolean
	) {
		if (!this.shouldFetch(instruction)) {
			return null;
		}

		const context: MemPLifecycleContext = {
			phase,
			scope: this.resolveScope(),
			isAsync
		};
		const query = this.config.queryBuilder
			? await this.config.queryBuilder(instruction, context)
			: this.findLatestUserMessage(instruction);
		if (!query?.trim()) {
			return null;
		}

		const retrieval = await this.retrieve(query, { scope: context.scope });
		if (!retrieval.procedures.length) {
			return null;
		}

		return [{
			memoryInformations: retrieval.procedures.map(procedure => this.formatProcedureForAwareness(procedure)),
			attchToAgentAwareness: true
		}];
	}

	private async updateForAgent(
		instruction: DeterministicFunctionInstruction,
		phase: MemPLifecycleContext["phase"],
		isAsync: boolean
	) {
		if (!this.config.updateBuilder || !this.shouldUpdate(instruction)) {
			return null;
		}

		const context: MemPLifecycleContext = {
			phase,
			scope: this.resolveScope(),
			isAsync
		};
		if (this.config.updatePolicy === "validation" && !await this.config.outcomeEvaluator!(instruction, context)) {
			return null;
		}

		const proposedUpdates = await this.config.updateBuilder(instruction, context);
		if (!proposedUpdates) {
			return null;
		}

		const updates = Array.isArray(proposedUpdates) ? proposedUpdates : [proposedUpdates];
		if (!updates.length) {
			return null;
		}

		const results: MemPUpdateResult[] = [];
		for (const update of updates) {
			results.push(await this.applyUpdate(update, context.scope));
		}

		return [{
			updatedInformations: results.map(result => this.formatUpdateResult(result)),
			attchToAgentAwareness: false
		}];
	}

	private async retrieveFromStore(query: string, scope: string): Promise<MemPProcedureCandidate[]> {
		const queryTerms = new Set(tokenize(query));
		const procedures = await this.store.list(scope);

		return procedures.map(procedure => ({
			procedure,
			similarity: lexicalSimilarity(queryTerms, procedure)
		}));
	}

	private findLatestUserMessage(instruction: DeterministicFunctionInstruction): string | undefined {
		for (const message of [...instruction.contextAgentState.messages].reverse()) {
			if (message.type === "user" && message.content.trim()) {
				return message.content;
			}
		}
		return undefined;
	}

	private shouldFetch(instruction: DeterministicFunctionInstruction): boolean {
		return !instruction.agentWants?.length || instruction.agentWants.some(want => want.type === "fetch");
	}

	private shouldUpdate(instruction: DeterministicFunctionInstruction): boolean {
		return !instruction.agentWants?.length || instruction.agentWants.some(want => want.type === "update");
	}

	private formatProcedureForAwareness(procedure: MemPRankedProcedure): string {
		if (this.config.formatProcedureForAwareness) {
			return this.config.formatProcedureForAwareness(procedure);
		}

		return [
			`[MemP procedure ${procedure.rank}: ${procedure.procedure.key}]`,
			"Script:",
			procedure.procedure.script,
			"Steps:",
			...procedure.procedure.steps.map((step, index) => `${index + 1}. ${step}`)
		].join("\n");
	}

	private formatUpdateResult(result: MemPUpdateResult): string {
		switch (result.action) {
			case "add":
				return `MemP added procedure "${result.procedure?.id ?? "unknown"}".`;
			case "update":
				return `MemP updated procedure "${result.procedure?.id ?? "unknown"}".`;
			case "deprecate":
				return `MemP deprecated procedure "${result.procedure?.id ?? "unknown"}".`;
			case "remove":
				return "MemP removed a procedural memory.";
		}
	}

	private createProcedure(draft: MemPProcedureDraft, scope: string): MemPProcedure {
		const id = draft.id === undefined ? this.createProcedureId() : draft.id;
		this.assertIdentifier(id, "MemP procedure id");
		const now = this.getNow();

		return {
			id,
			scope,
			key: this.normalizeRequiredText(draft.key, "MemP procedure key"),
			steps: this.normalizeSteps(draft.steps),
			script: this.normalizeRequiredText(draft.script, "MemP procedure script"),
			tags: this.normalizeTags(draft.tags),
			status: "active",
			revision: 1,
			createdAt: now,
			updatedAt: now,
			metadata: cloneMetadata(draft.metadata)
		};
	}

	private async requireProcedure(scope: string, procedureId: string): Promise<MemPProcedure> {
		const procedure = await this.store.get(scope, procedureId);
		if (!procedure) {
			throw new Error(`MemP procedure "${procedureId}" does not exist in scope "${scope}".`);
		}
		this.assertProcedure(procedure, scope);
		return procedure;
	}

	private resolveScope(scope?: string): string {
		const resolvedScope = (scope ?? this.config?.scope ?? DEFAULT_SCOPE).trim();
		if (!resolvedScope) {
			throw new Error("MemP scope must not be empty.");
		}
		return resolvedScope;
	}

	private resolveTopK(topK?: number): number {
		const resolvedTopK = topK ?? this.config.topK ?? DEFAULT_TOP_K;
		if (!Number.isInteger(resolvedTopK) || resolvedTopK < 1) {
			throw new Error("MemP topK must be a positive integer.");
		}
		return resolvedTopK;
	}

	private resolveSimilarityThreshold(similarityThreshold?: number): number {
		const resolvedThreshold = similarityThreshold ?? this.config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
		this.assertUnitInterval(resolvedThreshold, "MemP similarityThreshold");
		return resolvedThreshold;
	}

	private createProcedureId(): string {
		if (this.config.idFactory) {
			return this.config.idFactory();
		}

		this.procedureSequence += 1;
		return `memp-${this.getNow().toString(36)}-${this.procedureSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
	}

	private getNow(): number {
		const now = this.config.now?.() ?? Date.now();
		if (!Number.isFinite(now) || now < 0) {
			throw new Error("MemP now() must return a finite non-negative timestamp.");
		}
		return now;
	}

	private assertConfiguration(config: MemPConfig): void {
		if (config.scope !== undefined && !config.scope.trim()) {
			throw new Error("MemP scope must not be empty.");
		}
		if (config.topK !== undefined && (!Number.isInteger(config.topK) || config.topK < 1)) {
			throw new Error("MemP topK must be a positive integer.");
		}
		this.assertUnitInterval(config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD, "MemP similarityThreshold");

		const policy = config.updatePolicy ?? "vanilla";
		if (policy !== "vanilla" && policy !== "validation" && policy !== "adjustment") {
			throw new Error(`Unsupported MemP update policy "${String(policy)}".`);
		}
		if (policy === "validation" && !config.outcomeEvaluator) {
			throw new Error("MemP validation updatePolicy requires an outcomeEvaluator.");
		}
	}

	private assertCandidate(candidate: MemPProcedureCandidate, scope: string): void {
		this.assertProcedure(candidate.procedure, scope);
		this.assertUnitInterval(candidate.similarity, `MemP similarity for procedure "${candidate.procedure.id}"`);
	}

	private assertProcedure(procedure: MemPProcedure, expectedScope?: string): void {
		this.assertIdentifier(procedure.id, "MemP procedure id");
		if (expectedScope !== undefined && procedure.scope !== expectedScope) {
			throw new Error(`MemP procedure "${procedure.id}" belongs to scope "${procedure.scope}", not "${expectedScope}".`);
		}
		this.normalizeRequiredText(procedure.scope, "MemP procedure scope");
		this.normalizeRequiredText(procedure.key, "MemP procedure key");
		this.normalizeSteps(procedure.steps);
		this.normalizeRequiredText(procedure.script, "MemP procedure script");
		this.normalizeTags(procedure.tags);
		if (procedure.status !== "active" && procedure.status !== "deprecated") {
			throw new Error(`Unsupported MemP procedure status "${String(procedure.status)}".`);
		}
		if (!Number.isInteger(procedure.revision) || procedure.revision < 1) {
			throw new Error("MemP procedure revision must be a positive integer.");
		}
		this.assertTimestamp(procedure.createdAt, "MemP procedure createdAt");
		this.assertTimestamp(procedure.updatedAt, "MemP procedure updatedAt");
		if (procedure.deprecatedAt !== undefined) {
			this.assertTimestamp(procedure.deprecatedAt, "MemP procedure deprecatedAt");
		}
	}

	private assertPatch(patch: MemPProcedurePatch): void {
		if (!patch || !Object.keys(patch).length) {
			throw new Error("MemP procedure update requires at least one changed field.");
		}
	}

	private assertIdentifier(value: string, description: string): void {
		this.normalizeRequiredText(value, description);
	}

	private assertTimestamp(value: number, description: string): void {
		if (!Number.isFinite(value) || value < 0) {
			throw new Error(`${description} must be a finite non-negative timestamp.`);
		}
	}

	private assertUnitInterval(value: number, description: string): void {
		if (!Number.isFinite(value) || value < 0 || value > 1) {
			throw new Error(`${description} must be a finite number in the range [0, 1].`);
		}
	}

	private normalizeRequiredText(value: string, description: string): string {
		if (typeof value !== "string" || !value.trim()) {
			throw new Error(`${description} must not be empty.`);
		}
		return value.trim();
	}

	private normalizeSteps(steps: readonly string[]): string[] {
		if (!Array.isArray(steps) || !steps.length) {
			throw new Error("MemP procedure must contain at least one step.");
		}
		return steps.map((step, index) => this.normalizeRequiredText(step, `MemP procedure step ${index + 1}`));
	}

	private normalizeTags(tags: readonly string[] | undefined): string[] {
		if (tags === undefined) {
			return [];
		}
		if (!Array.isArray(tags)) {
			throw new Error("MemP procedure tags must be an array.");
		}

		const seenTags = new Set<string>();
		return tags.reduce<string[]>((normalizedTags, tag) => {
			const normalizedTag = this.normalizeRequiredText(tag, "MemP procedure tag");
			const tagKey = normalizedTag.toLowerCase();
			if (!seenTags.has(tagKey)) {
				seenTags.add(tagKey);
				normalizedTags.push(normalizedTag);
			}
			return normalizedTags;
		}, []);
	}
}

function lexicalSimilarity(queryTerms: ReadonlySet<string>, procedure: MemPProcedure): number {
	if (!queryTerms.size) {
		return 0;
	}

	const procedureTerms = new Set(tokenize([
		procedure.key,
		...procedure.tags,
		procedure.script,
		...procedure.steps
	].join("\n")));
	if (!procedureTerms.size) {
		return 0;
	}

	let overlap = 0;
	for (const term of queryTerms) {
		if (procedureTerms.has(term)) {
			overlap += 1;
		}
	}
	return overlap / Math.sqrt(queryTerms.size * procedureTerms.size);
}

function tokenize(value: string): string[] {
	return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
		.filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function cloneProcedure(procedure: MemPProcedure): MemPProcedure {
	return {
		...procedure,
		steps: [...procedure.steps],
		tags: [...procedure.tags],
		metadata: cloneMetadata(procedure.metadata)
	};
}

function cloneMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
	return metadata ? { ...metadata } : undefined;
}
