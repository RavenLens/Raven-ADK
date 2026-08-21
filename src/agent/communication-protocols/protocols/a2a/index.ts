import type {
	AgentDescriptor,
	Artifact,
	Cancellation,
	CommunicationEventMap,
	ConsultationRequest,
	DiscoveryRequest,
	DiscoveryResult,
	Message,
	ProtocolBinding,
	ProtocolError,
	ProtocolClient,
	PossibleActivityName,
	TaskHandle,
	TaskRequest,
	TaskResult,
	TaskSnapshot,
	TaskStatus,
	Usage
} from "../../schema";

/** Name used by the A2A protocol binding. */
export const PROTOCOL_NAME = "A2A (Agent-to-Agent Protocol by GOOGLE)";

type JsonObject = Record<string, unknown>;

/** Configuration for an A2A client connected to one remote agent endpoint. */
export interface A2AProtocolOptions {
	/** JSON-RPC endpoint exposed by the remote A2A agent. */
	endpoint: string;
	/** Optional local identity used as the sender of outbound requests. */
	participant?: AgentDescriptor;
	/** Protocol version advertised by this binding. */
	version?: string;
	/** Additional headers sent with every request. */
	headers?: Record<string, string>;
	/** Polling interval used when the remote task is not streamed. */
	pollingIntervalMs?: number;
	/** Maximum time spent waiting for a remote task. */
	waitTimeoutMs?: number;
	/** Optional fetch implementation, useful for tests or custom runtimes. */
	fetch?: typeof globalThis.fetch;
	/** Agent-card URLs used by `discover`; defaults to the configured endpoint. */
	discoveryEndpoints?: string[];
}

interface JsonRpcResponse {
	/** JSON-RPC result or normalized remote error returned by an A2A endpoint. */
	result?: JsonObject;
	error?: { code?: number | string; message?: string; data?: unknown };
}

const TERMINAL_STATES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);

/** Narrows unknown wire values to an object for defensive protocol parsing. */
function asObject(value: unknown): JsonObject {
	return value && typeof value === "object" ? value as JsonObject : {};
}

/** Returns a string wire value or a fallback when the remote value is malformed. */
function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

/** Returns an array wire value or an empty list when the remote value is malformed. */
function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

/** Creates the canonical timestamp used for locally synthesized protocol data. */
function now(): string {
	return new Date().toISOString();
}

/** Converts a transport error into the canonical protocol error shape. */
function protocolError(error: unknown, fallbackCode = "A2A_ERROR"): ProtocolError {
	const value = asObject(error);
	return {
		code: asString(value.code, fallbackCode),
		message: asString(value.message, error instanceof Error ? error.message : String(error)),
		retryable: typeof value.retryable === "boolean" ? value.retryable : undefined,
		details: value.details && typeof value.details === "object" ? value.details as JsonObject : undefined
	};
}

/** Maps A2A task states, including common spelling variants, to Raven states. */
function mapStatus(state: unknown): TaskStatus {
	switch (String(state).toLowerCase()) {
		case "submitted":
		case "queued":
		case "pending":
			return "submitted";
		case "working":
		case "input-required":
		case "awaiting-input":
			return "working";
		case "completed":
		case "success":
			return "completed";
		case "canceled":
		case "cancelled":
			return "cancelled";
		case "failed":
		case "rejected":
			return "failed";
		default:
			return "working";
	}
}

/** Extracts text from a string, A2A part, message, or nested parts collection. */
function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	const object = asObject(value);
	if (typeof object.text === "string") return object.text;
	if (typeof object.content === "string") return object.content;
	return asArray(object.parts).map(part => extractText(part)).filter(Boolean).join("\n");
}

/** Converts an A2A message-like value into a canonical message. */
function mapMessage(value: unknown, taskId?: string): Message | undefined {
	const object = asObject(value);
	const content = extractText(value);
	if (!content) return undefined;
	return {
		id: asString(object.messageId, asString(object.id, `${taskId ?? "message"}:${Date.now()}`)),
		role: object.role === "agent" || object.role === "system" || object.role === "tool" ? object.role : "user",
		content,
		sender: typeof object.sender === "string" ? object.sender : undefined,
		recipient: typeof object.recipient === "string" ? object.recipient : undefined,
		taskId,
		timestamp: typeof object.timestamp === "string" ? object.timestamp : now(),
		metadata: object.metadata && typeof object.metadata === "object" ? object.metadata as JsonObject : undefined
	};
}

/** Converts an inline A2A artifact into a canonical artifact. */
function mapArtifact(value: unknown, taskId: string, index: number): Artifact | undefined {
	const object = asObject(value);
	const content = object.content ?? object.data ?? object.text;
	if (typeof content !== "string" && !(content instanceof Uint8Array)) return undefined;
	return {
		id: asString(object.artifactId, `${taskId}:artifact:${index}`),
		name: typeof object.name === "string" ? object.name : undefined,
		mimeType: typeof object.mimeType === "string" ? object.mimeType : undefined,
		content,
		uri: typeof object.uri === "string" ? object.uri : undefined,
		metadata: object.metadata && typeof object.metadata === "object" ? object.metadata as JsonObject : undefined
	};
}

/** Converts optional remote usage metrics into the canonical usage shape. */
function mapUsage(value: unknown): Usage | undefined {
	const object = asObject(value);
	if (!Object.keys(object).length) return undefined;
	return {
		inputTokens: typeof object.inputTokens === "number" ? object.inputTokens : undefined,
		outputTokens: typeof object.outputTokens === "number" ? object.outputTokens : undefined,
		cost: typeof object.cost === "number" ? object.cost : undefined,
		durationMs: typeof object.durationMs === "number" ? object.durationMs : undefined
	};
}

/** Converts an A2A task response into a canonical task snapshot. */
function mapTask(value: unknown, request?: TaskRequest): TaskSnapshot {
	const object = asObject(value);
	const id = asString(object.id, asString(object.taskId, request?.taskId ?? `a2a:${Date.now()}`));
	const taskRequest = request ?? {
		from: "unknown",
		to: "unknown",
		message: extractText(object.message),
		taskId: id
	};
	const messages = asArray(object.messages).map(message => mapMessage(message, id)).filter((message): message is Message => !!message);
	const artifacts = asArray(object.artifacts).map((artifact, index) => mapArtifact(artifact, id, index)).filter((artifact): artifact is Artifact => !!artifact);
	const status = mapStatus(asObject(object.status).state ?? object.status);
	const createdAt = asString(object.createdAt, now());
	return {
		id,
		status,
		request: taskRequest,
		messages,
		artifacts: artifacts.length ? artifacts : undefined,
		result: TERMINAL_STATES.has(status) ? mapResult(object, id, status as TaskResult["status"], messages, artifacts) : undefined,
		createdAt,
		updatedAt: asString(object.updatedAt, now())
	};
}

/** Builds a canonical terminal result from an A2A task response. */
function mapResult(value: unknown, taskId: string, status: TaskResult["status"], messages: Message[] = [], artifacts: Artifact[] = []): TaskResult {
	const object = asObject(value);
	const message = mapMessage(object.message ?? messages.at(-1), taskId);
	const error = status === "failed" && object.error ? protocolError(object.error, "A2A_TASK_FAILED") : undefined;
	return {
		taskId,
		status,
		message,
		artifacts: artifacts.length ? artifacts : undefined,
		error,
		usage: mapUsage(object.usage)
	};
}

/** Encodes a canonical request as an A2A message/send message payload. */
function toA2AMessage(request: TaskRequest): JsonObject {
	const message: Pick<Message, "id" | "role" | "content" | "metadata"> = typeof request.message === "string"
		? { id: `a2a-message:${Date.now()}`, role: "user", content: request.message }
		: request.message;
	return {
		messageId: message.id,
		role: message.role,
		parts: [{ kind: "text", text: message.content }],
		metadata: {
			...message.metadata,
			raven: { activity: request.activity, from: request.from, to: request.to }
		}
	};
}

/** JSON-RPC client that maps A2A tasks to Raven's canonical protocol schema. */
export class A2AProtocolClient implements ProtocolClient {
	private readonly listeners = new Map<keyof CommunicationEventMap, Set<(...args: any[]) => void | Promise<void>>>();
	private requestNumber = 0;
	private readonly requestFetch: typeof globalThis.fetch;

	/** Creates an A2A client and validates that a JSON-RPC endpoint is configured. */
	constructor(private readonly options: A2AProtocolOptions) {
		this.requestFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		if (!options.endpoint) throw new Error("A2A endpoint is required");
	}

	/** Loads agent cards and filters them by the canonical discovery criteria. */
	async discover(request: DiscoveryRequest): Promise<DiscoveryResult> {
		const endpoints = this.options.discoveryEndpoints ?? [this.options.endpoint];
		const agents = await Promise.all(endpoints.map(endpoint => this.fetchAgentCard(endpoint)));
		return {
			agents: agents.filter(agent => (!request.capability || agent.capabilities?.includes(request.capability)) &&
				(!request.skill || agent.skills?.includes(request.skill)) &&
				(!request.query || `${agent.name} ${agent.description ?? ""}`.toLowerCase().includes(request.query.toLowerCase())))
		};
	}

	/** Sends an asynchronous A2A message and returns a handle for task polling. */
	async delegate(request: TaskRequest): Promise<TaskHandle> {
		const task = await this.rpc("message/send", {
			message: toA2AMessage(request),
			configuration: { blocking: false },
			metadata: request.metadata
		});
		const snapshot = mapTask(task, request);
		await this.emit("task_submitted", snapshot);
		return {
			taskId: snapshot.id,
			status: snapshot.status,
			wait: () => this.waitForTask(snapshot.id)
		};
	}

	/** Delegates a consultation request and waits for its terminal result. */
	async consult(request: ConsultationRequest): Promise<TaskResult> {
		const handle = await this.delegate(request);
		return handle.wait();
	}

	/** Retrieves and normalizes the current state of a remote A2A task. */
	async getTask(taskId: string): Promise<TaskSnapshot> {
		const task = await this.rpc("tasks/get", { id: taskId });
		const snapshot = mapTask(task);
		if (snapshot.status === "completed" && snapshot.result) await this.emit("task_completed", snapshot.result);
		if (snapshot.status === "failed" && snapshot.result?.error) await this.emit("task_failed", taskId, snapshot.result.error);
		return snapshot;
	}

	/** Requests cancellation of a remote task and emits the canonical event. */
	async cancel(taskId: string, reason?: string): Promise<void> {
		await this.rpc("tasks/cancel", { id: taskId, metadata: { reason } });
		const cancellation: Cancellation = { taskId, reason, requestedAt: now() };
		await this.emit("task_cancelled", cancellation);
	}

	/** Registers a typed event listener and returns an unsubscribe function. */
	onEvent<K extends keyof CommunicationEventMap>(event: K, listener: CommunicationEventMap[K]): () => void {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener as (...args: any[]) => void | Promise<void>);
		this.listeners.set(event, listeners);
		return () => listeners.delete(listener as (...args: any[]) => void | Promise<void>);
	}

	/** Polls a remote task until it reaches a terminal state or the wait times out. */
	private async waitForTask(taskId: string): Promise<TaskResult> {
		const startedAt = Date.now();
		const interval = Math.max(50, this.options.pollingIntervalMs ?? 500);
		while (true) {
			const snapshot = await this.getTask(taskId);
			if (TERMINAL_STATES.has(snapshot.status)) return snapshot.result ?? mapResult({}, taskId, snapshot.status as TaskResult["status"]);
			if (this.options.waitTimeoutMs !== undefined && Date.now() - startedAt >= this.options.waitTimeoutMs) {
				throw new Error(`A2A task ${taskId} did not finish before the wait timeout`);
			}
			await new Promise(resolve => setTimeout(resolve, interval));
		}
	}

	/** Fetches and maps an A2A agent card from its well-known URL. */
	private async fetchAgentCard(endpoint: string): Promise<AgentDescriptor> {
		const url = new URL("/.well-known/agent-card.json", endpoint).toString();
		const response = await this.requestFetch(url, { headers: this.options.headers });
		if (!response.ok) throw new Error(`A2A agent-card request failed with HTTP ${response.status}`);
		const card = asObject(await response.json());
		return {
			id: asString(card.id, asString(card.name, endpoint)),
			name: asString(card.name, endpoint),
			description: typeof card.description === "string" ? card.description : undefined,
			capabilities: asArray(card.capabilities).filter((value): value is PossibleActivityName => typeof value === "string"),
			skills: asArray(card.skills).filter((value): value is string => typeof value === "string"),
			endpoint: asString(card.url, endpoint),
			metadata: card.metadata && typeof card.metadata === "object" ? card.metadata as JsonObject : undefined
		};
	}

	/** Sends one JSON-RPC request to the configured A2A endpoint. */
	private async rpc(method: string, params: JsonObject): Promise<JsonObject> {
		const response = await this.requestFetch(this.options.endpoint, {
			method: "POST",
			headers: { "content-type": "application/json", ...this.options.headers },
			body: JSON.stringify({ jsonrpc: "2.0", id: ++this.requestNumber, method, params })
		});
		if (!response.ok) throw new Error(`A2A ${method} request failed with HTTP ${response.status}`);
		const payload = await response.json() as JsonRpcResponse;
		if (payload.error) throw protocolError({ code: String(payload.error.code ?? "A2A_RPC_ERROR"), message: payload.error.message ?? "A2A request failed", details: { data: payload.error.data } });
		return asObject(payload.result);
	}

	private async emit<K extends keyof CommunicationEventMap>(event: K, ...args: Parameters<CommunicationEventMap[K]>): Promise<void> {
		for (const listener of this.listeners.get(event) ?? []) await listener(...args);
	}
}

/** Creates a configured A2A binding that can be passed to `ReActAgent`. */
export function createA2ABinding(options: A2AProtocolOptions): ProtocolBinding {
	const client = new A2AProtocolClient(options);
	return {
		name: PROTOCOL_NAME,
		version: options.version ?? "1.0",
		client,
		participant: options.participant
	};
}

/** Namespace-compatible export for callers that prefer a protocol factory object. */
export const A2A = {
	name: PROTOCOL_NAME,
	createBinding: createA2ABinding
};
