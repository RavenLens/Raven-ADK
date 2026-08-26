# Default HITL

`HITL` is RavenADK's default human-in-the-loop strategy. It implements the
shared `HITLTransportSchema` and owns the approval, question, timeout, and
pending-response logic. Communication is delegated to an `HITLAdapter`, so the
same strategy works with a local bridge, Socket.io, Electron IPC, Tauri, or a
custom transport.

## When To Use It

- Use `HITL` when the application already knows which tools require human
approval. Configure those tools in `toolsUsage`:
- When actions have hight-risk of serious consequences that require full-human contribution to loop

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { HITL, HITLLocalAdapter } from "@ravenlens/raven-adk/tools/hitl";

const adapter = new HITLLocalAdapter((correlationId, request) => {
	ui.send({ id: correlationId, request });
});

const hitl = new HITL({
	adapter,
	toolsUsage: {
		delete_account: true,
		transfer_money: {
			delayMs: 30_000,
			defaultAnswer: "deny"
		}
	},
	questions: {
		abcQuestion: { instruction: "Ask concise choice questions." },
		openQuestion: { instruction: "Ask only when choices are insufficient." }
	}
});

const agent = new ReActAgent({
	model,
	systemPrompt: "You are a careful assistant.",
	messages: [{ type: "user", content: "Handle my request safely." }],
	tools,
	hitl
});
```

Set a tool to `true` to wait indefinitely for a response. An object config can
apply a timeout and a fallback answer. A timeout with no `defaultAnswer`
rejects the approval request.

## Tool Approval Payload

Before an approved tool runs, the adapter receives a `tool-approval` request.
It contains the tool name, the `toolInstance`, and the exact invocation
parameters:

```typescript
{
	type: "tool-approval",
	toolName: "transfer_money",
	toolInstance,
	params: { amount: 100, currency: "USD" }
}
```

The client responds with either `{ type: "tool-approval", answer: "allow" }`
or `{ type: "tool-approval", answer: "deny" }`. Every request and response
must use the same correlation id. See [LocalHITL.md](LocalHITL.md) and
[SocketHITL.md](SocketHITL.md) for complete adapter examples.

## Questions

When enabled, `HITL` injects question tools into the agent:

- `hitl_ask_abc_question` asks the user to choose from predefined options.
- `hitl_ask_open_question` collects a free-text answer.

The `questionHITLPrompt` property contains the guidance passed to the agent for
using these tools.

## Listeners

The optional `listeners` configuration observes or transforms the request
lifecycle independently of the adapter. Available hooks are `onBeforeSent`,
`onSent`, `onResponse`, and `onDelayPass`. This makes logging and analytics
portable across local and network transports.
