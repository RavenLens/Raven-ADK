# Local HITL Adapter

`HITLLocalAdapter` is a transport bridge for desktop or same-machine
integrations such as Electron, Tauri sidecars, VS Code extensions, and stdio.
It does not change HITL behavior; it forwards requests and routes responses.

```typescript
import { HITL, HITLLocalAdapter, HITLRequest, HITLResponse } from "@ravenlens/raven-adk/tools/hitl";

const adapter = new HITLLocalAdapter((correlationId, request: HITLRequest) => {
	mainWindow.webContents.send("hitl:request", { id: correlationId, request });
});

const hitl = new HITL({
	adapter,
	toolsUsage: { delete_account: true }
});

// Route the UI response back to HITL using the original correlation id.
ipcMain.on("hitl:response", (_event, payload: { id: number; response: HITLResponse }) => {
	adapter.respond(payload.id, payload.response);
});
```

For a `tool-approval` request, the UI can inspect `request.toolName`,
`request.toolInstance.toolConfig`, and `request.params` before responding:

```typescript
if (request.type === "tool-approval") {
	const allowed = await showApprovalDialog({
		name: request.toolName,
		description: request.toolInstance.toolConfig.toolDescription,
		params: request.params
	});

	ipcRenderer.send("hitl:response", {
		id,
		response: { type: "tool-approval", answer: allowed ? "allow" : "deny" }
	});
}
```
