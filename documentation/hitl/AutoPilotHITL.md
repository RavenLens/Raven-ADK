# AutoPilot HITL

`AutoPilotHITL` is the judge-assisted HITL strategy. It extends the default
`HITL` implementation and still satisfies RavenADK's common
`HITLTransportSchema`, so it can be passed to `ReActAgent` anywhere a regular
`HITL` instance is accepted.

## How It Works

For each proposed tool invocation, AutoPilot:

1. Sends the tool definition and its invocation parameters to a judge agent.
2. Expects the structured result `use-hitl` or `omit`.
3. Calls the regular HITL approval flow only for `use-hitl`.
4. Returns a schema-compatible denial for `omit`, so the tool is not executed.

The judge is instructed to require approval for destructive, irreversible,
security-sensitive, privacy-sensitive, financially consequential,
externally-visible, or ambiguous actions. You can provide an additional
instruction for a particular judgement through `emitToolUsageAutoPilot`.

## AutoPilot HITL Events

`AutoPilotHITLEvents` is the event map used by an `AutoPilotHITL` instance. It
extends `HITLEventsSpecType` and `DefaultHITLEvents`, so AutoPilot exposes all
of the standard HITL events in addition to its dedicated judge events.

The standard HITL events are:

| Event | Emitted by | Event body |
|---|---|---|
| `hitl_start` | The inherited approval, question, or acceptance flow | `() => void` |
| `hitl_end` | The inherited flow when it finishes | `() => void` |
| `hitl_request_sent` | The inherited request dispatch | `(id: number, request: HITLRequest) => void` |
| `hitl_response_received` | The inherited response handler | `(correlationId: string \| number, response: HITLResponse) => void` |
| `hitl_delay_passed` | The inherited tool approval timeout | `(toolName: string, details: { defaultAnswerUsed: boolean; defaultAnswer?: "allow" \| "deny" }) => void` |

The AutoPilot-specific events are:

| Event | Emitted by | Event body |
|---|---|---|
| `autopilot_judge_started` | `emitToolUsageAutoPilot` when judging starts | `(tool: HITLToolInstanceProbe) => void` |
| `autopilot_judge_finished` | `emitToolUsageAutoPilot` when judging finishes | `(tool: HITLToolInstanceProbe, outcome: "use-hitl" \| "omit") => void` |

`emitToolUsageAutoPilot` emits the judge events and, when the outcome is
`"use-hitl"`, delegates to the inherited approval flow, which emits the
standard HITL events. The common `emitToolUsage` method delegates to
`emitToolUsageAutoPilot`, so callers using that method can observe the same
event sequence. An outcome of `"omit"` returns the schema-compatible denial
without entering the human approval flow.

Listen directly on the concrete `AutoPilotHITL` instance:

```typescript
// Use onEvent for one dedicated AutoPilot event.
autoPilotHITL.onEvent("autopilot_judge_finished", (tool, outcome) => {
	console.log("AutoPilot judge finished", tool.toolInstance.toolConfig.toolName, outcome);
});

// Use onAnyEvent to observe both AutoPilot judge events and inherited HITL events.
autoPilotHITL.onAnyEvent((eventName, args) => {
	console.log("AutoPilot HITL event", eventName, args);
});
```

See [HITL Events](README.md#hitl-events) for the generic event API and the
`onEvent`, `onAnyEvent`, and `emitEvent` methods shared by HITL strategies.

## When to use It
- When most of actions aren't very serious in consequences therefore can be implement with agent that auto-evaluates what should be auto-aporved and what send for human feedback
- When you don't know what tool has to get the approval
- When different parameters given to tools have different level of seriousness, some can be less volatille some are more serious or horrific - Auto-HITL can establish rules where low-volatile actions are autoAproved and more volatile are thrown for human evaluation.
    - To tune additionally the agent evalutation specify `instructionForActionJudegement` parameter when calling `emitToolUsageAutoPilot` method
    > This is only one method supports the `instructionForActionJudegement` where `emitToolUsage` hasn't such tunning oppurtunity, therefore all base on a fundamental static prompt given to m

## Usage
- [CodeAct](../code/CodeAct.md) - coding agents can leverage `AutoPilotHITL` to decide whether a command, file I/O operation, or another action should run automatically or be delegated for human approval. This avoids continuous approval prompts for clearly safe actions.
```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { CodeActAgent } from "@ravenlens/raven-adk/code";
import {
	AutoPilotHITL,
	HITLLocalAdapter
} from "@ravenlens/raven-adk/tools/hitl";

const hitlAdapter = new HITLLocalAdapter((correlationId, request) => {
	// Forward this message to the CodeAct UI, for example through Electron IPC.
	ui.send({ type: "hitl:request", id: correlationId, request });
});

const judgeAgent = new ReActAgent({
	model,
	systemPrompt: "Judge whether proposed coding-agent actions need human approval.",
	messages: [],
	tools: []
});

const autoPilotHITL = new AutoPilotHITL(judgeAgent, {
	adapter: hitlAdapter,
    // Use `toolsUsage` to specify the list with tools for that AutoPilotHITL triggers logic of evaluation and human pass
	toolsUsage: {
		execute_command: { delayMs: 30_000, defaultAnswer: "deny" },
		write_file: true,
		read_file: true
	}
});

const codeAct = new CodeActAgent({
	pattern: "codeact",
	model,
	systemPrompt: "Implement the requested change and validate the result.",
	workspaces: {
		list: [{
			workspaceId: "project",
			root: process.cwd(),
			workerIsolation: "snapshot",
			applyMode: "serialized"
		}],
		accessBeyondList: false,
		listErrorStrategy: "stop"
	},
	writeMode: "proposal",
	tools: codingTools,
	memory: codingMemory,
	sandboxes: { default: nodeSandbox },
	validationCommands: {
		commands: [{ name: "tests", command: "npm", args: ["test", "--", "--run"] }],
		maxRepairAttempts: 2
	},
	hitlConfig: {
		hitl: autoPilotHITL,
		hitlPreConfig: {
			hitlStrategy: "use-hitl",
			triggerOnDefaultCodeActTools: true,
			triggerOnRetry: true,
			allowToAskQuestions: true
		}
	}
});

```

- `model`, `codingTools`, `codingMemory`, `nodeSandbox`, and `ui` are
application-provided values. When CodeAct proposes a configured action,
`AutoPilotHITL` evaluates the tool definition and parameters first. Only when
the judge returns `use-hitl` does the request reach the UI for approval. A
judge result of `omit` returns a denial through the common HITL schema without
asking the user. This snippet documents the current CodeAct configuration
contract; `CodeActAgent.invoke` is not implemented yet.
- `toolsUsage` - is specified as config param to `AutoPilotHITL` method and it has to have the list with tools for that HITL is triggered. **Only for that list HITL is going to be triggered**

## Convergence

Some RavenADK integrations do not yet comply with the newer AutoPilot HITL
standard. In particular, `ReActAgent` currently calls the common
`emitToolUsage` method through `HITLTransportSchema`; it does not yet call the
dedicated AutoPilot judgement method. This keeps the existing agent logic
compatible with the common HITL contract, but it means that the ReActAgent
path does not explicitly express the newer AutoPilot convention.

CodeAct uses `emitToolUsage` as a convergence point for the typical RavenADK
HITL schema and its existing execution logic. This wrapper is needed for the
common agent-facing contract and for scenarios where an integration expects a
standard `HITLTransportSchema` implementation. Newer integrations that adopt
AutoPilotHITL as the standard should use the dedicated
`emitToolUsageAutoPilot` method instead. That method exposes the judge outcome
(`use-hitl` or `omit`) and allows callers to provide AutoPilot-specific
judgement options, including an instruction and error behavior.

The two entry points therefore serve different compatibility levels:

| Entry point | Intended role |
|---|---|
| `emitToolUsage` | Common, schema-compatible wrapper used by existing RavenADK agent logic and CodeAct convergence scenarios. |
| `emitToolUsageAutoPilot` | Dedicated API for newer integrations that explicitly use the AutoPilot judge standard. |


## Setup

The constructor receives a judge `ReActAgent` and the same configuration used
by `HITL`. The adapter can be local or network-based:

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { AutoPilotHITL, HITLSocketIoAdapter } from "@ravenlens/raven-adk/tools/hitl";

const judgeAgent = new ReActAgent({
	model,
	systemPrompt: "You are a safety judge.",
	messages: [],
	tools: []
});

const hitl = new AutoPilotHITL(judgeAgent, {
	adapter: new HITLSocketIoAdapter({ port: 3000 }),
	toolsUsage: {
		delete_account: true,
		transfer_money: { delayMs: 30_000, defaultAnswer: "deny" }
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

The adapter receives the same rich tool-approval payload as the default
strategy, including `toolName`, `toolInstance`, and `params`. See
[SocketHITL.md](SocketHITL.md) for the client response handler or
[LocalHITL.md](LocalHITL.md) for a local bridge.

## Direct Judge API

Use `emitToolUsageAutoPilot` when the caller needs to inspect the judge result
directly or provide a custom error policy:

```typescript
const result = await hitl.emitToolUsageAutoPilot(
	{ toolInstance: transferMoneyTool, params: { amount: 100, currency: "USD" } },
	"throw",
	"Require approval for transfers above the user's configured limit."
);

if (result.judgeEffect === "use-hitl") {
	const approval = await result.toolUsageBody;
	// approval is the regular HITL result after the user or timeout responds.
} else {
	// The judge omitted HITL; the tool must not be executed by the caller.
}
```

The common `emitToolUsage` method is the wrapper used by RavenADK's normal
agent logic. When the judge returns `use-hitl`, it returns the regular approval
result (`allow` or `deny`, with `user_answer` or `delay_pass`). When the judge
returns `omit`, it returns `{ answer: "deny", reason: "user_answer" }` as a
schema-compatible fallback; `user_answer` does not mean that the user replied.

## Judge Errors

`emitToolUsageAutoPilot` defaults to `console.error`, which treats a judge
failure as `omit`. Pass `"throw"` when a judge failure should abort the caller
instead. The convenience `emitToolUsage` wrapper uses the default behavior.
