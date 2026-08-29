# Socket.io HITL Adapter

`HITLSocketIoAdapter` starts a Socket.io server and forwards HITL requests over
`hitl:request`. Clients answer on `hitl:response` with the same id. For the
shared adapter contract, request/response types, and event flow, see
[Transport.md](Transport.md).

## Server

```typescript
import { HITL, HITLSocketIoAdapter } from "@ravenlens/raven-adk/tools/hitl";

const hitl = new HITL({
	adapter: new HITLSocketIoAdapter({ port: 3000 }),
	toolsUsage: {
		transfer_money: { delayMs: 30_000, defaultAnswer: "deny" },
		delete_account: true
	}
});
```

## Client

```typescript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

socket.on("hitl:request", ({ id, request }) => {
	if (request.type !== "tool-approval") return;

	const allowed = confirm([
		`Allow tool: ${request.toolName}`,
		`Parameters: ${JSON.stringify(request.params)}`
	].join("\n"));

	socket.emit("hitl:response", {
		id,
		response: { type: "tool-approval", answer: allowed ? "allow" : "deny" }
	});
});
```

The request also includes `toolInstance`, whose `toolConfig` exposes the tool

The adapter only transports requests; it does not select the HITL path.
`toolsUsage` controls ordinary `tool-approval` requests. Question tools
configured through `questions` send `abc-question` or `open-question` requests
directly, and `accetpanceAsTool` sends an `acceptance` request directly. The
client should render each request according to its `type` and return the
matching response type with the same correlation id.
