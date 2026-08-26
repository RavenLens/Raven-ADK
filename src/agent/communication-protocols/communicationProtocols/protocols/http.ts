import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
	CommunicationRequest,
	ProtocolError,
	ProtocolBinding,
	QueuedTask,
	TaskRequest,
	TaskResult,
	TaskId,
    AgentDescriptor,
    CommunicationProtocolAdapter,
} from "../communicationProtocolSchema";
import { ProtocolTaskQueueSchema } from "../../queues/queueSchema";
import { InMemoryProtocolTaskQueueSchema } from "../../queues/queue-types";
import { recordEventWithData, withTelemetry } from "../../../../telemetry/telemetry";

/** Options for a transport-independent HTTP protocol wrapper. */
export interface HttpProtocolServerOptions {
	binding: ProtocolBinding;
	agent: AgentDescriptor;
	adapter: CommunicationProtocolAdapter;
	path?: string;
	discoveryPath?: string;
}

export interface HttpProtocolServer {
	readonly binding: ProtocolBinding;
	readonly queue: ProtocolTaskQueueSchema;
	readonly httpServer: Server;
	listen(port: number, host?: string): Promise<void>;
	close(): Promise<void>;
}

/** Public options retained for the A2A convenience factory. */
export type A2AHttpServerOptions = Omit<HttpProtocolServerOptions, "adapter">;
export type A2AHttpServer = HttpProtocolServer;

function asObject(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", chunk => body += chunk);
		request.on("end", () => {
			try { resolve(asObject(JSON.parse(body || "{}"))); }
			catch (error) { reject(error); }
		});
		request.on("error", reject);
	});
}

function writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

/** 
 * Exposes any communication-protocol adapter over a small JSON HTTP envelope.
 * Updates the Queue of agent
*/
export function createHttpProtocolServer(options: HttpProtocolServerOptions): HttpProtocolServer {
	const queue = options.binding.queue ?? new InMemoryProtocolTaskQueueSchema();
	const binding: ProtocolBinding = { ...options.binding, queue };
	const path = options.path ?? "/communication";
	const discoveryPath = options.discoveryPath ?? "/.well-known/agent-card.json";

	const httpServer = createServer(async (request, response) => {
		try {
			const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
			if (request.method === "GET" && requestPath === discoveryPath) {
				writeJson(response, 200, options.agent as unknown as Record<string, unknown>);
				return;
			}
			if (request.method !== "POST" || requestPath !== path) {
				writeJson(response, 404, { error: "Not found" });
				return;
			}
			const payload = await readJson(request);
			const communicationRequest: CommunicationRequest = {
				id: typeof payload.id === "string" || typeof payload.id === "number" ? payload.id : null,
				method: typeof payload.method === "string" ? payload.method : "",
				params: asObject(payload.params)
			};
			const result = await withTelemetry("protocol.http.request", {
				protocol: binding.name,
				method: communicationRequest.method,
				path: requestPath
			}, async () => options.adapter.handle(communicationRequest, { binding, queue }));
			recordEventWithData("protocol.http.response", {
				protocol: binding.name,
				method: communicationRequest.method,
				status: result.error ? "error" : "ok"
			});
			writeJson(response, 200, { jsonrpc: "2.0", id: communicationRequest.id, ...result });
		} catch (error) {
			writeJson(response, 400, {
				jsonrpc: "2.0",
				error: { code: -32602, message: error instanceof Error ? error.message : "Invalid communication request" }
			});
		}
	});

	return {
		binding,
		queue,
		httpServer,
		listen: (port, host) => new Promise((resolve, reject) => {
			httpServer.once("error", reject);
			httpServer.listen(port, host, () => resolve());
		}),
		close: () => new Promise((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()))
	};
}