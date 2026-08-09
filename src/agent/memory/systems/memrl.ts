import { DeterministicFunctionInstruction, DeterministicMemoryConfig, DeterministicMemorySchema } from "../schema/deterministicMemorySchema";
import z from "zod";

const DEFAULT_INITIAL_Q_SCORE = 0.5;
const DEFAULT_LEARNING_RATE = 0.2;
const DEFAULT_UTILITY_WEIGHT = 0.5;
const DEFAULT_SIMILARITY_THRESHOLD = 0;
const DEFAULT_SCOPE = "default";

export type MemRLResourceType = "memory" | "tool" | "skill";

export interface MemRLResourceReference {
    resourceId: string;
    resourceType: MemRLResourceType;
}

/** A result returned by the application's semantic-retrieval layer. */
export interface MemRLCandidate<Payload = unknown> extends MemRLResourceReference {
    /** A normalized semantic similarity in the inclusive range [0, 1]. */
    similarity: number;
    /** Text that can be attached to the agent's working context after selection. */
    content: string;
    payload?: Payload;
    metadata?: Record<string, unknown>;
}

export interface MemRLScore extends MemRLResourceReference {
    scope: string;
    qScore: number;
    updates: number;
    updatedAt?: number;
}

export const memRLScoreSchema: z.ZodType<MemRLScore> = z.object({
    resourceId: z.string(), resourceType: z.enum(["memory", "tool", "skill"]), scope: z.string(),
    qScore: z.number(), updates: z.number(), updatedAt: z.number().optional()
});

/** Persistence boundary for learned utility values. */
export interface MemRLScoreStore {
    get(scope: string, resourceType: MemRLResourceType, resourceId: string): Promise<MemRLScore | undefined>;
    set(score: MemRLScore): Promise<void>;
}

export interface MemRLTraceCandidate extends MemRLResourceReference {
    semanticScore: number;
    qScore: number;
    utilityScore: number;
    rank: number;
}

export interface MemRLFeedback {
    source: "manual" | "automatic";
    reward: number;
    appliedAt: number;
    resources: MemRLResourceReference[];
    metadata?: Record<string, unknown>;
}

/** A retrieval decision that can later be reinforced with outcome feedback. */
export interface MemRLTrace {
    traceId: string;
    scope: string;
    createdAt: number;
    candidates: MemRLTraceCandidate[];
    selectedResources: MemRLResourceReference[];
    feedback: MemRLFeedback[];
}

const memRLResourceReferenceSchema = z.object({
    resourceId: z.string(), resourceType: z.enum(["memory", "tool", "skill"])
});
const memRLTraceCandidateSchema: z.ZodType<MemRLTraceCandidate> = memRLResourceReferenceSchema.extend({
    semanticScore: z.number(), qScore: z.number(), utilityScore: z.number(), rank: z.number()
});
const memRLFeedbackSchema: z.ZodType<MemRLFeedback> = z.object({
    source: z.enum(["manual", "automatic"]), reward: z.number(), appliedAt: z.number(),
    resources: z.array(memRLResourceReferenceSchema), metadata: z.record(z.string(), z.unknown()).optional()
});
export const memRLTraceSchema: z.ZodType<MemRLTrace> = z.object({
    traceId: z.string(), scope: z.string(), createdAt: z.number(),
    candidates: z.array(memRLTraceCandidateSchema), selectedResources: z.array(memRLResourceReferenceSchema),
    feedback: z.array(memRLFeedbackSchema)
});

/** Persistence boundary for feedback targets and their audit trail. */
export interface MemRLTraceStore {
    get(traceId: string): Promise<MemRLTrace | undefined>;
    set(trace: MemRLTrace): Promise<void>;
}

export interface MemRLRankedCandidate<Payload = unknown> {
    candidate: MemRLCandidate<Payload>;
    qScore: number;
    utilityScore: number;
    rank: number;
}

export interface MemRLRetrievalOptions {
    /** Q-values are learned per scope, normally an intent or episode identifier. */
    scope?: string;
    /** Limits the candidates admitted by the first, semantic-retrieval phase. */
    topK?: number;
    /** Minimum normalized semantic similarity required for phase-one admission. */
    similarityThreshold?: number;
}

export interface MemRLRetrievalResult<Payload = unknown> {
    trace: MemRLTrace;
    candidates: MemRLRankedCandidate<Payload>[];
}

export interface MemRLCandidateProviderResult {
    candidates: MemRLCandidate[];
    scope?: string;
}

export interface MemRLCandidateProviderContext {
    phase: "orchestrator" | "subagent";
    isAsync: boolean;
    semanticSearch: {
        topK?: number;
        similarityThreshold: number;
    };
}

export type MemRLCandidateProvider = (
    instruction: DeterministicFunctionInstruction,
    context: MemRLCandidateProviderContext
) => Promise<MemRLCandidate[] | MemRLCandidateProviderResult> | MemRLCandidate[] | MemRLCandidateProviderResult;

export type MemRLAutomaticFeedback = {
    traceId?: string;
    reward?: number;
    resources?: MemRLResourceReference[];
    metadata?: Record<string, unknown>;
} & Record<string, unknown>;

export interface MemRLConfig extends Omit<DeterministicMemoryConfig, "tools"> {
    /** Optional because MemRL does not need deterministic tools to operate. */
    tools?: DeterministicMemoryConfig["tools"];
    /** Default Q-value namespace; pass a retrieval scope to override it per request.Scopre has to belong to specific user or entity to retrive the utility score for the user  */
    episodeId?: string;
    /** Monte Carlo update rate $\alpha$, constrained to (0, 1]. */
    learningRate?: number;
    /** Blend weight $\lambda$ for learned utility versus semantic similarity. */
    utilityWeight?: number;
    /** Q-value used for a resource that has not received feedback yet. */
    initialQScore?: number;
    /** Maximum candidates admitted from the semantic-retrieval phase. */
    topK?: number;
    /** Minimum normalized semantic similarity required before utility-aware ranking. Defaults to 0. */
    similarityThreshold?: number;
    /** 
     * Adapts the application's VectorDB or RAG system to MemRL lifecycle hooks.
     * - Implement the semantic search from specific user by doing logic of fetch inside this method
    */
    candidateProvider?: MemRLCandidateProvider;
    /** Allows non-normalized semantic metrics to be converted into [0, 1]. */
    normalizeSimilarity?: (similarity: number, candidate: MemRLCandidate) => number;
    /** Converts a ranked candidate into agent-visible context when lifecycle hooks are used. */
    formatCandidateForAwareness?: (candidate: MemRLRankedCandidate) => string;
    /** 
     * Resolves automatic evaluator output when it is not included as `reward`.
     * It's model or agent that performs evelaution of the given
    */
    automaticFeedbackEvaluator?: (
        collectedData: MemRLAutomaticFeedback | string,
        trace: MemRLTrace
    ) => number | undefined | Promise<number | undefined>;
    scoreStore?: MemRLScoreStore;
    traceStore?: MemRLTraceStore;
    traceIdFactory?: () => string;
}

type ResolvedMemRLConfig = Omit<MemRLConfig, "tools"> & {
    tools: DeterministicMemoryConfig["tools"];
};

/** Default process-local score store. Use a database-backed implementation for durable learning. */
export class InMemoryMemRLScoreStore implements MemRLScoreStore {
    private readonly scores = new Map<string, MemRLScore>();

    async get(scope: string, resourceType: MemRLResourceType, resourceId: string): Promise<MemRLScore | undefined> {
        const score = this.scores.get(this.createKey(scope, resourceType, resourceId));
        return score ? { ...memRLScoreSchema.parse(score) } : undefined;
    }

    async set(score: MemRLScore): Promise<void> {
        const validatedScore = memRLScoreSchema.parse(score);
        this.scores.set(this.createKey(validatedScore.scope, validatedScore.resourceType, validatedScore.resourceId), { ...validatedScore });
    }

    private createKey(scope: string, resourceType: MemRLResourceType, resourceId: string): string {
        return JSON.stringify([scope, resourceType, resourceId]);
    }
}

/** Default process-local trace store. Use a database-backed implementation for durable audit history. */
export class InMemoryMemRLTraceStore implements MemRLTraceStore {
    private readonly traces = new Map<string, MemRLTrace>();

    async get(traceId: string): Promise<MemRLTrace | undefined> {
        const trace = this.traces.get(traceId);
        return trace ? cloneTrace(memRLTraceSchema.parse(trace)) : undefined;
    }

    async set(trace: MemRLTrace): Promise<void> {
        const validatedTrace = memRLTraceSchema.parse(trace);
        this.traces.set(validatedTrace.traceId, cloneTrace(validatedTrace));
    }
}

/**
 * Memory Non-Parametric Runtime Reinforcement Learning.
 *
 * The application executes semantic search; MemRL enforces its threshold and top-K boundary,
 * then owns utility-aware ranking and feedback-driven Q-value updates. LLM weights never change.
 */
export class MemRL implements DeterministicMemorySchema {
    typeMemory: "deterministic" = "deterministic";
    config: ResolvedMemRLConfig;

    private readonly scoreStore: MemRLScoreStore;
    private readonly traceStore: MemRLTraceStore;
    private lastTraceId?: string;
    private traceSequence = 0;

    constructor(config: MemRLConfig) {
        this.assertConfiguration(config);

        this.config = {
            ...config,
            tools: config.tools ?? ({} as DeterministicMemoryConfig["tools"]),
            systemPrompt: config.systemPrompt ?? [
                "MemRL ranks recalled experiences by both semantic relevance and learned utility.",
                "Prefer high-utility traces when relevant, and record outcome feedback after the task completes."
            ].join("\n")
        };
        this.scoreStore = config.scoreStore ?? new InMemoryMemRLScoreStore();
        this.traceStore = config.traceStore ?? new InMemoryMemRLTraceStore();
    }

    /**
    * Phase one admits only the semantic top-K candidates at or above the configured threshold.
    * Phase two ranks those candidates using $score=(1-\lambda)similarity+\lambda Q$.
     */
    async retrieve<Payload = unknown>(
        candidates: readonly MemRLCandidate<Payload>[],
        options: MemRLRetrievalOptions = {}
    ): Promise<MemRLRetrievalResult<Payload>> {
        const scope = this.resolveScope(options.scope);
        const topK = this.resolveTopK(options.topK, candidates.length);
        const similarityThreshold = this.resolveSimilarityThreshold(options.similarityThreshold);
        const candidateKeys = new Set<string>();

        const semanticCandidates = candidates.map((candidate, index) => {
            this.assertCandidate(candidate);

            const candidateKey = this.createResourceKey(candidate);
            if (candidateKeys.has(candidateKey)) {
                throw new Error(`MemRL candidates must be unique within a retrieval: ${candidate.resourceType}:${candidate.resourceId}`);
            }
            candidateKeys.add(candidateKey);

            const semanticScore = this.normalizeSimilarity(candidate);
            return {
                candidate,
                semanticScore,
                originalIndex: index
            };
        })
            .filter(candidate => candidate.semanticScore >= similarityThreshold)
            .sort((left, right) =>
                right.semanticScore - left.semanticScore ||
                left.originalIndex - right.originalIndex
            )
            .slice(0, topK);

        const rankedCandidates = await Promise.all(semanticCandidates.map(async ({ candidate, semanticScore, originalIndex }) => {
            const knownScore = await this.scoreStore.get(scope, candidate.resourceType, candidate.resourceId);
            const qScore = knownScore?.qScore ?? this.initialQScore;
            this.assertUnitInterval(qScore, `Q-score for ${candidate.resourceType}:${candidate.resourceId}`);

            return {
                candidate,
                semanticScore,
                qScore,
                utilityScore: (1 - this.utilityWeight) * semanticScore + this.utilityWeight * qScore,
                originalIndex
            };
        }));

        rankedCandidates.sort((left, right) =>
            right.utilityScore - left.utilityScore ||
            right.semanticScore - left.semanticScore ||
            left.originalIndex - right.originalIndex
        );

        const selectedCandidates = rankedCandidates.map((candidate, index) => ({
            candidate: candidate.candidate,
            semanticScore: candidate.semanticScore,
            qScore: candidate.qScore,
            utilityScore: candidate.utilityScore,
            rank: index + 1
        }));
        const trace: MemRLTrace = {
            traceId: this.createTraceId(),
            scope,
            createdAt: Date.now(),
            candidates: selectedCandidates.map(({ candidate, semanticScore, qScore, utilityScore, rank }) => ({
                resourceId: candidate.resourceId,
                resourceType: candidate.resourceType,
                semanticScore,
                qScore,
                utilityScore,
                rank
            })),
            selectedResources: selectedCandidates.length > 0
                ? [this.toResourceReference(selectedCandidates[0].candidate)]
                : [],
            feedback: []
        };

        await this.traceStore.set(trace);
        this.lastTraceId = trace.traceId;

        return {
            trace: cloneTrace(trace),
            candidates: selectedCandidates
        };
    }

    /** Records which retrieved resources actually influenced the agent's response. */
    async selectCandidates(traceId: string, resources: readonly MemRLResourceReference[]): Promise<MemRLTrace> {
        if (!resources.length) {
            throw new Error("MemRL requires at least one selected resource before feedback can be applied.");
        }

        const trace = await this.requireTrace(traceId);
        const traceResources = new Set(trace.candidates.map(candidate => this.createResourceKey(candidate)));
        const selectedKeys = new Set<string>();

        for (const resource of resources) {
            this.assertResourceReference(resource);
            const resourceKey = this.createResourceKey(resource);
            if (!traceResources.has(resourceKey)) {
                throw new Error(`Resource ${resource.resourceType}:${resource.resourceId} was not returned by MemRL trace "${traceId}".`);
            }
            selectedKeys.add(resourceKey);
        }

        trace.selectedResources = resources.map(resource => this.toResourceReference(resource));
        await this.traceStore.set(trace);
        return cloneTrace(trace);
    }

    /** Applies a Monte Carlo update: $Q_{new}=Q_{old}+\alpha(reward-Q_{old})$. */
    async applyFeedback(
        traceId: string,
        reward: number,
        source: "manual" | "automatic" = "manual",
        resources?: readonly MemRLResourceReference[],
        metadata?: Record<string, unknown>
    ): Promise<MemRLTrace> {
        this.assertUnitInterval(reward, "MemRL feedback reward");

        const trace = await this.requireTrace(traceId);
        const resourcesToUpdate = resources ?? trace.selectedResources;
        if (!resourcesToUpdate.length) {
            throw new Error(`MemRL trace "${traceId}" has no selected resources to reinforce.`);
        }

        const traceResources = new Set(trace.candidates.map(candidate => this.createResourceKey(candidate)));
        const uniqueResources = new Map<string, MemRLResourceReference>();
        for (const resource of resourcesToUpdate) {
            this.assertResourceReference(resource);
            const resourceKey = this.createResourceKey(resource);
            if (!traceResources.has(resourceKey)) {
                throw new Error(`Resource ${resource.resourceType}:${resource.resourceId} was not returned by MemRL trace "${traceId}".`);
            }
            uniqueResources.set(resourceKey, this.toResourceReference(resource));
        }

        const appliedAt = Date.now();
        for (const resource of uniqueResources.values()) {
            const previousScore = await this.getScore(trace.scope, resource);
            const qScore = previousScore.qScore + this.learningRate * (reward - previousScore.qScore);

            await this.scoreStore.set({
                ...previousScore,
                qScore,
                updates: previousScore.updates + 1,
                updatedAt: appliedAt
            });
        }

        trace.selectedResources = [...uniqueResources.values()];
        trace.feedback.push({
            source,
            reward,
            appliedAt,
            resources: trace.selectedResources.map(resource => this.toResourceReference(resource)),
            metadata: metadata ? { ...metadata } : undefined
        });
        await this.traceStore.set(trace);

        return cloneTrace(trace);
    }

    /** Reads a learned value, returning the configured prior for unseen resources. */
    async getQScore(resource: MemRLResourceReference, scope?: string): Promise<MemRLScore> {
        this.assertResourceReference(resource);
        return await this.getScore(this.resolveScope(scope), resource);
    }

    async getTrace(traceId: string): Promise<MemRLTrace | undefined> {
        return await this.traceStore.get(traceId);
    }

    /** Retrieves and attaches ranked experiences when a VectorDB/RAG adapter is configured. */
    async beforeOrchestratorAgentRun(instruction: DeterministicFunctionInstruction, isAsync = false) {
        return await this.retrieveForAgent(instruction, "orchestrator", isAsync);
    }

    /** Uses the same policy for subagents, while leaving data sourcing to the configured adapter. */
    async beforeSubagentRun(instruction: DeterministicFunctionInstruction, isAsync = false) {
        return await this.retrieveForAgent(instruction, "subagent", isAsync);
    }

    /**
     * Compatibility helper for simple feedback flows. Prefer `applyFeedback` with an explicit trace ID
     * in concurrent applications.
     */
    feedback(type: "manual", reward: number, traceId?: string): Promise<boolean>;
    feedback(type: "automatic", collectedData?: MemRLAutomaticFeedback | string): Promise<boolean>;
    async feedback(
        type: "manual" | "automatic",
        collectedDataOrReward?: MemRLAutomaticFeedback | string | number,
        explicitTraceId?: string
    ): Promise<boolean> {
        if (type === "manual") {
            if (typeof collectedDataOrReward !== "number") {
                throw new TypeError("Manual MemRL feedback requires a numeric reward.");
            }

            const traceId = explicitTraceId ?? this.lastTraceId;
            if (!traceId) {
                return false;
            }

            await this.applyFeedback(traceId, collectedDataOrReward);
            return true;
        }

        if (typeof collectedDataOrReward === "number") {
            throw new TypeError("Automatic MemRL feedback must provide evaluator data, not a numeric reward.");
        }

        const collectedData: MemRLAutomaticFeedback | string = collectedDataOrReward ?? {};
        const traceId = typeof collectedData === "string"
            ? this.lastTraceId
            : collectedData.traceId ?? this.lastTraceId;

        if (!traceId) {
            return false;
        }

        const trace = await this.requireTrace(traceId);
        const reward = typeof collectedData === "string"
            ? await this.config.automaticFeedbackEvaluator?.(collectedData, trace)
            : collectedData.reward ?? await this.config.automaticFeedbackEvaluator?.(collectedData, trace);

        if (reward === undefined) {
            return false;
        }

        await this.applyFeedback(
            traceId,
            reward,
            "automatic",
            typeof collectedData === "string" ? undefined : collectedData.resources,
            typeof collectedData === "string" ? undefined : collectedData.metadata
        );
        return true;
    }

    private async retrieveForAgent(
        instruction: DeterministicFunctionInstruction,
        phase: "orchestrator" | "subagent",
        isAsync: boolean
    ) {
        if (!this.config.candidateProvider || !this.shouldFetch(instruction)) {
            return null;
        }

        const providerResult = await this.config.candidateProvider(instruction, {
            phase,
            isAsync,
            semanticSearch: {
                topK: this.config.topK,
                similarityThreshold: this.similarityThreshold
            }
        });
        const candidates = Array.isArray(providerResult) ? providerResult : providerResult.candidates;
        const scope = Array.isArray(providerResult) ? undefined : providerResult.scope;
        if (!candidates.length) {
            return null;
        }

        const retrieval = await this.retrieve(candidates, { scope });
        return [{
            memoryInformations: retrieval.candidates.map(candidate => this.formatCandidateForAwareness(candidate)),
            attchToAgentAwareness: true
        }];
    }

    private shouldFetch(instruction: DeterministicFunctionInstruction): boolean {
        return !instruction.agentWants?.length || instruction.agentWants.some(want => want.type === "fetch");
    }

    private async getScore(scope: string, resource: MemRLResourceReference): Promise<MemRLScore> {
        const existingScore = await this.scoreStore.get(scope, resource.resourceType, resource.resourceId);
        if (existingScore) {
            this.assertUnitInterval(existingScore.qScore, `Q-score for ${resource.resourceType}:${resource.resourceId}`);
            return existingScore;
        }

        return {
            scope,
            resourceId: resource.resourceId,
            resourceType: resource.resourceType,
            qScore: this.initialQScore,
            updates: 0
        };
    }

    private async requireTrace(traceId: string): Promise<MemRLTrace> {
        const trace = await this.traceStore.get(traceId);
        if (!trace) {
            throw new Error(`MemRL trace "${traceId}" does not exist.`);
        }
        return trace;
    }

    private formatCandidateForAwareness(candidate: MemRLRankedCandidate): string {
        if (this.config.formatCandidateForAwareness) {
            return this.config.formatCandidateForAwareness(candidate);
        }

        return `[MemRL rank ${candidate.rank}; utility ${candidate.utilityScore.toFixed(3)}; Q ${candidate.qScore.toFixed(3)}]\n${candidate.candidate.content}`;
    }

    private normalizeSimilarity(candidate: MemRLCandidate): number {
        const normalized = this.config.normalizeSimilarity
            ? this.config.normalizeSimilarity(candidate.similarity, candidate)
            : candidate.similarity;
        this.assertUnitInterval(normalized, `Semantic similarity for ${candidate.resourceType}:${candidate.resourceId}`);
        return normalized;
    }

    private resolveScope(scope?: string): string {
        const resolvedScope = (scope ?? this.config.episodeId ?? DEFAULT_SCOPE).trim();
        if (!resolvedScope) {
            throw new Error("MemRL scope must not be empty.");
        }
        return resolvedScope;
    }

    private resolveTopK(topK: number | undefined, candidatesCount: number): number {
        const configuredTopK = topK ?? this.config.topK;
        if (configuredTopK === undefined) {
            return candidatesCount;
        }

        const resolvedTopK = configuredTopK;
        if (!Number.isInteger(resolvedTopK) || resolvedTopK < 1) {
            throw new Error("MemRL topK must be a positive integer.");
        }
        return Math.min(resolvedTopK, candidatesCount);
    }

    private resolveSimilarityThreshold(similarityThreshold?: number): number {
        const resolvedThreshold = similarityThreshold ?? this.similarityThreshold;
        this.assertUnitInterval(resolvedThreshold, "MemRL similarityThreshold");
        return resolvedThreshold;
    }

    private get initialQScore(): number {
        return this.config.initialQScore ?? DEFAULT_INITIAL_Q_SCORE;
    }

    private get learningRate(): number {
        return this.config.learningRate ?? DEFAULT_LEARNING_RATE;
    }

    private get utilityWeight(): number {
        return this.config.utilityWeight ?? DEFAULT_UTILITY_WEIGHT;
    }

    private get similarityThreshold(): number {
        return this.config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    }

    private createTraceId(): string {
        if (this.config.traceIdFactory) {
            return this.config.traceIdFactory();
        }

        this.traceSequence += 1;
        return `memrl-${Date.now().toString(36)}-${this.traceSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    private assertConfiguration(config: MemRLConfig): void {
        this.assertUnitInterval(config.initialQScore ?? DEFAULT_INITIAL_Q_SCORE, "MemRL initialQScore");
        this.assertUnitInterval(config.utilityWeight ?? DEFAULT_UTILITY_WEIGHT, "MemRL utilityWeight");

        const learningRate = config.learningRate ?? DEFAULT_LEARNING_RATE;
        if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate > 1) {
            throw new Error("MemRL learningRate must be in the range (0, 1].");
        }

        if (config.topK !== undefined && (!Number.isInteger(config.topK) || config.topK < 1)) {
            throw new Error("MemRL topK must be a positive integer.");
        }

        this.assertUnitInterval(config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD, "MemRL similarityThreshold");

        if (config.episodeId !== undefined && !config.episodeId.trim()) {
            throw new Error("MemRL episodeId must not be empty.");
        }
    }

    private assertCandidate(candidate: MemRLCandidate): void {
        this.assertResourceReference(candidate);
        if (typeof candidate.content !== "string") {
            throw new TypeError(`MemRL candidate ${candidate.resourceType}:${candidate.resourceId} must have string content.`);
        }
        if (!Number.isFinite(candidate.similarity)) {
            throw new TypeError(`Semantic similarity for ${candidate.resourceType}:${candidate.resourceId} must be finite.`);
        }
    }

    private assertResourceReference(resource: MemRLResourceReference): void {
        if (!resource.resourceId.trim()) {
            throw new Error("MemRL resourceId must not be empty.");
        }
        if (resource.resourceType !== "memory" && resource.resourceType !== "tool" && resource.resourceType !== "skill") {
            throw new Error(`Unsupported MemRL resource type "${String(resource.resourceType)}".`);
        }
    }

    private assertUnitInterval(value: number, description: string): void {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new Error(`${description} must be a finite number in the range [0, 1].`);
        }
    }

    private createResourceKey(resource: MemRLResourceReference): string {
        return JSON.stringify([resource.resourceType, resource.resourceId]);
    }

    private toResourceReference(resource: MemRLResourceReference): MemRLResourceReference {
        return {
            resourceId: resource.resourceId,
            resourceType: resource.resourceType
        };
    }
}

function cloneTrace(trace: MemRLTrace): MemRLTrace {
    return {
        ...trace,
        candidates: trace.candidates.map(candidate => ({ ...candidate })),
        selectedResources: trace.selectedResources.map(resource => ({ ...resource })),
        feedback: trace.feedback.map(feedback => ({
            ...feedback,
            resources: feedback.resources.map(resource => ({ ...resource })),
            metadata: feedback.metadata ? { ...feedback.metadata } : undefined
        }))
    };
}
