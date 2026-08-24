/**
 * Canonical communication contract shared by every transport wrapper.
 *
 * Agent protocols such as A2A define their own wire format. Transport
 * wrappers such as HTTP, JSON-RPC, Kafka, and RabbitMQ use this contract at
 * their boundary so an agent protocol can be moved between transports
 * without changing the agent-facing API.
 */
export * from "../agentProtocols/agentProtocolSchema";

import type {
	ProtocolBinding,
} from "../agentProtocols/agentProtocolSchema";
import { ProtocolTaskQueueSchema } from "../queues/queueSchema";

/** Protocol-neutral request received by a transport adapter. */
export interface CommunicationRequest<Method extends string = string> {
	id: string | number | null;
	method: Method;
	params: Record<string, unknown>;
}

/** Protocol-neutral response returned by a transport adapter. */
export interface CommunicationResponse {
	result?: Record<string, unknown>;
	error?: {
		code: number | string;
		message: string;
		data?: unknown;
	};
}

/** Context supplied to an adapter while it translates a transport request. */
export interface CommunicationAdapterContext {
	binding: ProtocolBinding;
	queue: ProtocolTaskQueueSchema;
}

/** Translates a protocol-neutral request into a protocol-specific response. */
export interface CommunicationProtocolAdapter {
	handle(request: CommunicationRequest, context: CommunicationAdapterContext): Promise<CommunicationResponse>;
}
