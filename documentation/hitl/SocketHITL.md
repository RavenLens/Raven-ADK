# Socket.io HITL Adapter

`HITLSocketIoAdapter` starts a Socket.io server and forwards HITL requests over
`hitl:request`. Clients answer on `hitl:response` with the same id.

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
description and argument/output schemas. Treat the request as untrusted UI
data and render the parameters in a way appropriate for the application.
