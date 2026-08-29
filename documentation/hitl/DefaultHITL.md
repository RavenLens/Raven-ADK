# Default HITL

`HITL` is RavenADK's default human-in-the-loop strategy. It implements the
shared `HITLTransportSchema` and owns the approval, question, timeout, and
pending-response logic. Communication is delegated to an `HITLAdapter`, so the
same strategy works with a local bridge, Socket.io, Electron IPC, Tauri, or a
custom transport.

The adapter contract and complete request/response protocol are documented in
[Transport.md](Transport.md). This page focuses on the default strategy's
configuration and behavior.

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

### Tools Usage (`toolsUsage`)
It's the list with tools specified by `HITL` (`DefaultHITL`) that will invoke `emitToolUsage` method that quide `tool-approval` request to the client via the transport. [Check more about transport](./Transport.md)

- You can specify the questions tools names there e.g: `HITL_ABC_QUESTION_TOOL_NAME`, `HITL_OPEN_QUESTION_TOOL_NAME` or `HITL_ACCEPTANCE_TOOL_NAME` but it's not recomended since it produces the 2 step hitl

## Acceptance Requests

`emitAcceptance(question, context?)` asks the user whether an action should be
approved and returns `"allow"` or `"deny"`. It is an explicit acceptance API,
separate from the regular tool-approval result returned by `emitToolUsage`.
Call it from application or skill logic when an action reaches an acceptance
boundary:

```typescript
const answer = await hitl.emitAcceptance?.(
	"Allow the agent to execute the deployment?",
	"The deployment will update the production service."
);

if (answer === "allow") {
	// Continue the acceptance-gated action.
}
```

Acceptance can also be exposed to the agent as the
`HITL_ACCEPTANCE_TOOL_NAME` tool, whose value is currently
`"hitl_ask_acceptance"`. Enable it with `accetpanceAsTool`:

```typescript
const hitl = new HITL({
	adapter,
	accetpanceAsTool: {
		instruction: "Use this only immediately before an irreversible action."
	}
});
```

When enabled, `createQuestionTools()` adds `hitl_ask_acceptance`. The tool
handler calls `emitAcceptance(question, context)` and returns `{ answer }` as
its tool output. The direct method and the tool therefore reach the same
acceptance request implementation, but they have different callers: the
direct method is used by application or skill logic, while the tool is chosen
by the agent.

Do not include `hitl_ask_acceptance` in `toolsUsage` for normal operation. That
would add a separate ordinary tool-approval boundary before the acceptance
request. With `DefaultHITL`, including it produces two user interactions:
first a `tool-approval` request for `hitl_ask_acceptance`, then an `acceptance`
request from the tool's `emitAcceptance()` handler. `accetpanceAsTool` alone
enables the acceptance tool without adding that second approval request.
`AutoPilotHITL` has a different special-case result when this tool is listed;
see [AutoPilotHITL.md](AutoPilotHITL.md).

Whether called directly or through the tool, `emitAcceptance` emits
`hitl_acceptance_started` before sending the `acceptance` request and
`hitl_acceptance_received` after the response arrives. It also participates in
the normal `hitl_start` and `hitl_end` lifecycle. See [HITL Events](README.md#hitl-events)
for the event payloads.

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
[SocketHITL.md](SocketHITL.md) for complete adapter examples, and
[Transport.md](Transport.md) for the shared adapter contract and all request
types.

## Questions

When enabled, `HITL` injects question tools into the agent:

- `hitl_ask_abc_question` asks the user to choose from predefined options.
- `hitl_ask_open_question` collects a free-text answer.

The `questionHITLPrompt` property contains the guidance passed to the agent for
using these tools. These tools ask the user directly and are not ordinary
approval targets, so they must not be added to `toolsUsage`.

If `hitl_ask_abc_question` or `hitl_ask_open_question` is nevertheless added
to `toolsUsage`, `DefaultHITL` performs two user interactions when the agent
calls it: a `tool-approval` request first, followed by the actual
`abc-question` or `open-question` request after approval. This is usually
unnecessary and should be avoided.

## Listeners

The optional `listeners` configuration observes or transforms the request
lifecycle independently of the adapter. Available hooks are `onBeforeSent`,
`onSent`, `onResponse`, and `onDelayPass`. This makes logging and analytics
portable across local and network transports.

## HITL Events

`DefaultHITLEvents` is the event map used by the default `HITL` implementation.
It extends `HITLEventsSpecType`, so it includes the generic `hitl_start` and
`hitl_end` lifecycle events as well as the default strategy's request,
response, and timeout events.

| Event | Emitted by | Event body |
|---|---|---|
| `hitl_start` | An approval, question, or acceptance flow when it starts | `() => void` |
| `hitl_end` | The flow when it finishes | `() => void` |
| `hitl_request_sent` | Request dispatch after the adapter receives a request | `(id: number, request: HITLRequest) => void` |
| `hitl_response_received` | Response handling after a pending request is resolved | `(correlationId: string \| number, response: HITLResponse) => void` |
| `hitl_delay_passed` | A tool approval timeout when it passes | `(toolName: string, details: { defaultAnswerUsed: boolean; defaultAnswer?: "allow" \| "deny" }) => void` |
| `hitl_acceptance_started` | `emitAcceptance` before the acceptance request is sent | `(question: string) => void` |
| `hitl_acceptance_received` | `emitAcceptance` after the acceptance response is received | `(question: string, answer: "allow" \| "deny") => void` |

Listen directly on the `HITL` instance. Use `onEvent` for one known event and
`onAnyEvent` when all HITL activity should be observed by a logger, analytics
collector, debugger, or event bridge. `emitEvent` is normally called by the
HITL implementation; custom HITL subclasses can use it to publish additional
events.

```typescript
// Use onEvent for one specific event.
hitl.onEvent("hitl_request_sent", (id, request) => {
	console.log("HITL request sent", id, request.type);
});

// Use onAnyEvent to observe every standard or custom HITL event.
hitl.onAnyEvent((eventName, ...args) => {
	console.log("HITL event", eventName, args);
});

// Acceptance events expose the question and the user's answer.
hitl.onEvent("hitl_acceptance_started", (question) => {
	console.log("Acceptance requested", question);
});
hitl.onEvent("hitl_acceptance_received", (question, answer) => {
	console.log("Acceptance received", question, answer);
});

// emitEvent is available for custom HITL implementations or integrations.
hitl.emitEvent("hitl_start");
```

See [HITL Events](README.md#hitl-events) for the shared event API and the
`HITLEventsSpecType`, `onEvent`, `onAnyEvent`, and `emitEvent` definitions.
