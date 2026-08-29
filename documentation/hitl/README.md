# Human-In-The-Loop
Human-In-The-Loop (HITL) lets the agent ask the user for tool usage confirmation, information confirmation or missing information before continuing.

When HITL is active, agent execution waits for user input wherever HITL is required.

## FAQ
#### Why is HITL Important?
- You need HITL to mitigate of consequences of bad actions e.g: deleting project you worked for 1 month without any backup.

#### How does hitl work?
- AI-Agent asks human for agreement
- Human retrieves the request and gives back a response. Configured inactivity can resolve ordinary approvals, questions, and acceptance requests with their configured defaults.
- AI continues only when acceptance was granted 

> Inactivity only resolves a request when its configuration object has both a
> `delaysMs` timeout and a `defaultAnswer` callback. Otherwise the request
> rejects when its configured timeout expires, or waits indefinitely when no
> timeout is configured. See [DefaultHITL.md](DefaultHITL.md#inactivity-and-timeouts).

## How HITL Works
HITL currently supports three interaction types.

1. Tool approval
- Before executing selected tools, the agent asks the user for permission. Agents ask only for tools are on the tools list what in case on [`HITL`](./DefaultHITL.md) is `toolsUsage` object
    > You can specfy Questions and Acceptance tools there but it's not recomended since it triggers 2-step HITL. [Read more](#configuration-and-routing)
- Allowed answers are `allow` or `deny`.
- If delay rules are configured for a tool, a default answer can be applied after a timeout.
- Tool approvals are requested in parallel for all configured tool calls in the same step, and the step is blocked until all approvals are resolved.

2. User questions
- The agent can ask the user for information when context is missing.
- Question modes:
- Single-choice question (abc-style): user selects one option like `a`, `b`, `c`.
- Open question: user responds with free text.
- A configured `delaysMs` can invoke a synchronous or asynchronous `defaultAnswer` callback when the user is inactive.

3. Acceptance requests
- Application or skill logic can call `emitAcceptance(question, context?)` to
    request an explicit `allow` or `deny` decision.
- When `accetpanceAsTool` is enabled, the agent also receives the
    `HITL_ACCEPTANCE_TOOL_NAME` tool (`hitl_ask_acceptance`), which calls the
    same acceptance method from its tool handler.
- These two entry points share the acceptance transport and events, but their
    callers differ: direct calls come from application logic, while the tool is
    selected by the agent.
- A configured `delaysMs` can resolve inactivity through `defaultAnswer`, which
    should return `allow` or `deny` for acceptance.

## Configuration And Routing

The configuration fields control different HITL paths; they are not one
combined list of tools:

| Configuration | What it enables | How it is routed |
|---|---|---|
| `toolsUsage` | Approval for named ordinary tools | `ReActAgent` calls `hitl.emitToolUsage()` for matching tool names before execution. With `AutoPilotHITL`, this invokes the judge first. |
| `questions.abcQuestion` | The `hitl_ask_abc_question` agent tool | The tool calls `emitAbcQuestion()` directly. It does not enter ordinary `emitToolUsage()` approval. |
| `questions.openQuestion` | The `hitl_ask_open_question` agent tool | The tool calls `emitOpenQuestion()` directly. It does not enter ordinary `emitToolUsage()` approval. |
| `accetpanceAsTool` | The `hitl_ask_acceptance` agent tool | The tool calls `emitAcceptance()` directly. AutoPilot can optionally judge this dedicated acceptance flow. |

`toolsUsage` is the allowlist for ordinary tool-approval HITL in the built-in
`ReActAgent` flow. A tool not listed there does not receive ordinary HITL
approval. This includes tools that are merely present in `tools` and the
question tools created from `questions`.

Do not add `hitl_ask_abc_question`, `hitl_ask_open_question`, or
`hitl_ask_acceptance` to `toolsUsage` for normal operation. Doing so can add an
unnecessary approval before a question. With `DefaultHITL`, the sequence is
then two user interactions: ordinary tool approval followed by the actual
question or acceptance request. With `AutoPilotHITL`, the ordinary approval
also invokes the judge first; if the judge returns `use-hitl`, the user then
gets the approval prompt followed by the question. If the judge returns
`omit`, the question tool is denied and the question is never sent. For the
acceptance tool specifically, AutoPilot's special branch denies a call that
reaches `emitToolUsage`, so the acceptance request is not sent at all. Enable
question tools with `questions` or `accetpanceAsTool` instead.

## Full Agent Agility

HITL does not impose one universal approval policy on every agent. The logic
that owns an agent or integration decides which ordinary tools belong in the
`toolsUsage` whitelist, based on the tool's purpose, the current workflow, and
the risk of the proposed parameters. A different agent can use a different
whitelist with the same HITL strategy and adapter.

That owning logic also decides when to enter each HITL path:

- Call `emitToolUsage(tool, ...)` for an ordinary tool invocation that should
    pass through the configured approval or AutoPilot evaluation path.
- Invoke a configured question tool when the agent needs information from the
    user. Its handler calls `emitAbcQuestion()` or `emitOpenQuestion()` directly.
- Call `emitAcceptance(question, context?)` from application or skill logic
    when a workflow reaches an explicit acceptance boundary, or expose the
    acceptance tool when the agent should formulate that request.

The whitelist is therefore an agent-policy decision, not a registry of every
tool available to the agent. HITL cannot infer the correct policy from the
`tools` array alone. Integrations may use the common `emitToolUsage` method or,
when they need AutoPilot-specific judge results and options, call
`emitToolUsageAutoPilot` directly. See [Transport.md](Transport.md) for the
request/response contract after one of these paths is selected.

> Case in point: [`CodeAct`](../coding-agents/codeact/README.md) loads the HITL tools and configures them in option `hitlPreConfig` where [`ReActAgent`](../ReAct-Agent.md) relies on user to setup them manually

## Architecture

HITL is built around a single `HITLTransportSchema` interface serves as canvas for HITL utilities. It owns all HITL business logic:
- building the questioning prompt,
- tracking pending requests,
- applying timeout fallbacks,
- creating the HITL tools injected into the agent.

Communication is delegated to an `HITLAdapter`. The adapter only forwards requests to the UI/client and routes responses back to the `HITL` instance. This keeps the core class small and makes it easy to support Socket.io, Electron IPC, Tauri sidecars, WebSockets, or any other channel.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { HITL, HITLAdapter } from "@ravenlens/raven-adk/tools/hitl";

const hitl = new HITL({
    adapter: myAdapter,
    questions: { ... },
    toolsUsage: { ... }
});

const agent = new ReActAgent({
    model,
    systemPrompt: "You are a careful assistant.",
    messages: [{ type: "user", content: "Handle my request safely" }],
    tools,
    hitl
});
```

## HITL Versions
RavenADK implements two HITL strategies. Both strategies use the common
`HITLTransportSchema` contract and can use any `HITLAdapter`, including the
local and Socket.io adapters described in the linked guides.

| Strategy | Built on | Purpose | Documentation |
|---|---|---|---|
| `HITL` (Default HITL) | `HITLTransportSchema` | Requests human approval for configured tool calls and asks configured questions. | [DefaultHITL.md](DefaultHITL.md) |
| `AutoPilotHITL` | `HITL` and `HITLTransportSchema` | Uses a judge agent to decide whether a tool call should be sent through the human approval flow or accepted right-away | [AutoPilotHITL.md](AutoPilotHITL.md) |

Adapters are transport implementations, not HITL strategies. See
[Transport.md](Transport.md) for the `HITLAdapter` contract, request/response
events, event origins, and custom adapter implementation guidance. See
[LocalHITL.md](LocalHITL.md) and [SocketHITL.md](SocketHITL.md) for
adapter-specific setup.

## HITL Events

HITL events can be listened to directly on a HITL implementation such as the
default `HITL` implementation (defined in [DefaultHITL.ts](../../src/agent/tools/hitl/hitl-strategies/DefaultHITL.ts)) or `AutoPilotHITL`. Use `onEvent` when you need to react to one known event, and use `onAnyEvent` when you need to observe every event for logging, analytics, debugging, or a generic event bridge. `emitEvent` is used by a HITL implementation or subclass to publish an event to its registered listeners.

```typescript
// Use onEvent for one specific event and its typed event body.
hitl.onEvent("hitl_start", (eventBody) => {
    console.log("HITL started", eventBody);
});

// Use onAnyEvent when the event name is not known in advance or all HITL
// activity needs to be forwarded to a logger or another event system.
hitl.onAnyEvent((eventName, ...args) => {
    console.log("HITL event", eventName, args);
});

// emitEvent is normally called by the HITL implementation. It is available
// for custom HITL subclasses or integrations that define their own events.
hitl.emitEvent("hitl_start");
```

`HITLEventsSpecType` is the base event contract. Every event name maps to a
function signature, which determines the type of the value passed to
`emitEvent`, the listener registered with `onEvent`, and the entries in the
`args` array received by `onAnyEvent`.

The default `HITL` implementation exposes these events:

| Event | Event body |
|---|---|
| `hitl_start` | `() => void` — emitted when an approval, question, or acceptance flow starts. |
| `hitl_end` | `() => void` — emitted when the flow finishes, including after a delay fallback. |
| `hitl_request_sent` | `(id: number, request: HITLRequest) => void` — emitted after a request is sent to the adapter. |
| `hitl_response_received` | `(correlationId: string \| number, response: HITLResponse) => void` — emitted after a client response is received. |
| `hitl_delay_passed` | `(toolName: string, details: { defaultAnswerUsed: boolean; defaultAnswer?: "allow" \| "deny" }) => void` — emitted when a tool approval timeout passes. |
| `hitl_acceptance_started` | `(question: string) => void` — emitted by `emitAcceptance` before the acceptance request is sent. |
| `hitl_acceptance_received` | `(question: string, answer: "allow" \| "deny") => void` — emitted by `emitAcceptance` after the acceptance response is received. |

`AutoPilotHITL` also exposes custom events you can find on [AutoPilotHITLEvents](./AutoPilotHITL.md#autopilot-hitl-events). The first receives the `HITLToolInstanceProbe`
being evaluated. The second receives that tool probe and the judge outcome,
which is either `"use-hitl"` or `"omit"`.

Custom HITL implementations can extend the event map with their own event
names. Register listeners on the concrete instance so the same code works
with the default strategy and with subclasses such as `AutoPilotHITL`.

### Acceptance events and routing

The acceptance method is opt-in as a tool. Set `accetpanceAsTool` to `true` or
to an object with an `instruction` in either HITL strategy's configuration:

```typescript
const hitl = new HITL({
        adapter,
        accetpanceAsTool: {
                instruction: "Ask for approval only for irreversible actions."
        }
});
```

The direct method is available independently of the tool setting. Both
strategies emit `hitl_acceptance_started(question)` before an acceptance
request and `hitl_acceptance_received(question, answer)` after a human answer,
along with `hitl_start` and `hitl_end`. The direct method is therefore the
appropriate API when application or skill code owns the acceptance decision;
the tool is appropriate when the agent must formulate the question.

The strategies handle the acceptance tool differently from ordinary tools:

- `HITL` adds `hitl_ask_acceptance` when `accetpanceAsTool` is enabled. Its tool
    handler calls `emitAcceptance`, and the normal ReAct tool approval flow is
    involved only if that tool is separately listed in `toolsUsage`.
- `AutoPilotHITL` deliberately excludes `hitl_ask_acceptance` from its normal
    `emitToolUsage` judge path. The acceptance tool is handled by
    `emitAcceptance` so it does not trigger a second judge invocation, which
    preserves judge tokens and reduces latency. For this detection,
    `emitToolUsage` returns `{ answer: "deny", reason: "accetpance_separate_logic" }`.
    This is a routing marker and is not the user's acceptance answer.
- For direct AutoPilot `emitAcceptance` calls, set
    `engageJudgeInEmittingAccetpance` to `true` or to `{ instruction: string }`
    when the acceptance request should first be evaluated by the judge. A judge
    result of `"use-hitl"` enters the inherited human flow; `"omit"` returns
    `"deny"` without sending an adapter request.

See [DefaultHITL.md](DefaultHITL.md#acceptance-requests) and
[AutoPilotHITL.md](AutoPilotHITL.md#acceptance-requests) for strategy-specific
examples and event details.

## HITL listeners

The `HITL` instance can be configured with an optional `listeners` object that observes the request/response lifecycle without touching the adapter. Listeners live on the `HITL` side, so they work with every adapter and stay independent of the transport implementation.

```typescript
const hitl = new HITL({
    adapter,
    questions: { ... },
    toolsUsage: { ... },
    listeners: {
        onBeforeSent: async (id, request) => {
            // Called before the request is forwarded to the adapter.
            // Return void / undefined / null to keep the original request.
            // Return { id, request } to override the correlation id or payload.
        },
        onSent: async (id, request) => {
            // Called right after the request was passed to the adapter.
        },
        onResponse: async (correlationId, response) => {
            // Called after a response arrived from the client
            // and the pending promise was resolved.
        },
        onDelayPass: async (toolName, { defaultAnswerUsed, defaultAnswer }) => {
            // Called when a tool-approval delayMs timeout passes.
            // defaultAnswerUsed is true when a defaultAnswer was configured and applied.
            // defaultAnswerUsed is false when the timeout passed without a defaultAnswer
            // (the approval promise will reject).
        }
    }
});
```

### Why use listeners?

- **`onBeforeSent`** — useful when you are not using a custom adapter where this logic could be implemented manually, or when you want to keep the communication logic clear. It lets you transform or enrich the outgoing request before it reaches the adapter.
- **`onSent` and `onResponse`** — use these to simply observe HITL traffic, for logging, analytics, UI updates, or debugging. They cannot modify the data.
- **`onDelayPass`** — emitted when a tool-approval `delayMs` timeout passes. It receives the tool name and a `defaultAnswerUsed` flag, plus the `defaultAnswer` value when one was configured. Use it to track when an approval auto-resolved because the user did not answer in time.

> Because listeners are implemented on the `HITL` side, they are universally available for each adapter and independent from the adapter. You can switch from the socket.io adapter to a local adapter and keep the same listener logic without changes.

## HITL Communication Events

For the complete transport contract, including request and response payloads,
correlation ids, event origins, and custom adapter guidance, see
[Transport.md](Transport.md).

The `HITL` class communicates with adapters through generic request/response messages. The events the adapter can receive (`HITLRequest`) and must answer (`HITLResponse`) are:

| Request event      | Payload                                              | Response event        | Expected response shape                                   |
|--------------------|------------------------------------------------------|-----------------------|-----------------------------------------------------------|
| `tool-approval`    | `{ type: "tool-approval", toolName: string, toolInstance: Tool, params: Record<string, any> }` | `tool-approval` | `{ type: "tool-approval", answer: "allow" \| "deny" }` |
| `abc-question`     | `{ type: "abc-question", question: string, options: [string, string][] }` | `abc-answer` | `{ type: "abc-answer", option: string, optionLabel: string }` |
| `open-question`    | `{ type: "open-question", question: string }`        | `open-answer`         | `{ type: "open-answer", answer: string }`                 |
| `acceptance`       | `{ type: "acceptance", question: string, context?: string }` | `acceptance-answer` | `{ type: "acceptance-answer", answer: "allow" \| "deny" }` |

Every request carries a `correlationId` generated by `HITL`. The adapter must include this id in the response so the pending request can be resolved.
> Use these events to listen on frontend side for retriving agent interactions

## Built-in adapters

### Socket.io adapter

`HITLSocketIoAdapter` starts a socket.io server and uses `hitl:request` / `hitl:response` events.

Backend:
```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { HITL, HITLSocketIoAdapter } from "@ravenlens/raven-adk/tools/hitl";

const hitl = new HITL({
    adapter: new HITLSocketIoAdapter({ port: 3000 }),
    questions: {
        abcQuestion: {
            instruction: "Use short single-choice questions when user intent is ambiguous.",
            maxAnswersRange: ["a", "b", "c", "d"]
        },
        openQuestion: {
            instruction: "Use open question only when choices cannot represent valid outcomes."
        }
    },
    toolsUsage: {
        transfer_money: {
            delayMs: 30_000,
            defaultAnswer: "deny"
        },
        delete_account: true
    },
    listeners: {
        onBeforeSent: async (id, request) => {
            console.log("[HITL] about to send", id, request);
        },
        onSent: async (id, request) => {
            console.log("[HITL] sent", id, request);
        },
        onResponse: async (correlationId, response) => {
            console.log("[HITL] response", correlationId, response);
        },
        onDelayPass: async (toolName, { defaultAnswerUsed, defaultAnswer }) => {
            console.log("[HITL] delay pass", toolName, { defaultAnswerUsed, defaultAnswer });
        }
    }
});

const agent = new ReActAgent({
    model,
    systemPrompt: "You are a careful assistant.",
    messages: [{ type: "user", content: "Handle my request safely" }],
    tools,
    hitl
});
```

Frontend client:
```typescript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

socket.on("hitl:request", ({ id, request }) => {
    if (request.type === "tool-approval") {
        const ok = confirm(`Allow tool "${request.toolName}"?`);
        socket.emit("hitl:response", {
            id,
            response: { type: "tool-approval", answer: ok ? "allow" : "deny" }
        });
    } else if (request.type === "abc-question") {
        const answer = prompt(
            request.question + "\n" + request.options.map(([k, v]) => `${k}: ${v}`).join("\n")
        );
        const selected = request.options.find(([k]) => k === answer);
        socket.emit("hitl:response", {
            id,
            response: {
                type: "abc-answer",
                option: selected?.[0] ?? answer,
                optionLabel: selected?.[1] ?? answer
            }
        });
    } else if (request.type === "open-question") {
        const answer = prompt(request.question);
        socket.emit("hitl:response", {
            id,
            response: { type: "open-answer", answer: answer ?? "" }
        });
    } else if (request.type === "acceptance") {
        const ok = confirm(request.question);
        socket.emit("hitl:response", {
            id,
            response: { type: "acceptance-answer", answer: ok ? "allow" : "deny" }
        });
    }
});
```

### Local adapter

For desktop apps (Electron, Tauri sidecar, VS Code extension, etc.) the agent and UI run on the same machine but in different processes. Use `HITLLocalAdapter` or implement `HITLAdapter` yourself.

`HITLLocalAdapter` takes a `send` function and exposes a `respond` method:

```typescript
import { HITL, HITLLocalAdapter, HITLRequest } from "@ravenlens/raven-adk/tools/hitl";

const adapter = new HITLLocalAdapter((correlationId, request: HITLRequest) => {
    // Forward the request to your UI through Electron IPC, Tauri events, stdio, etc.
    myIpc.send("hitl:request", { id: correlationId, request });
});

const hitl = new HITL({
    adapter,
    questions: { ... },
    toolsUsage: { ... }
});

// When the UI answers, route the response back to the adapter.
myIpc.on("hitl:response", ({ id, response }) => {
    adapter.respond(id, response);
});
```

## Examples

### Electron.js

Backend (main process):
```typescript
import { BrowserWindow, ipcMain } from "electron";
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { HITL, HITLLocalAdapter, HITLRequest } from "@ravenlens/raven-adk/tools/hitl";

const adapter = new HITLLocalAdapter((correlationId, request: HITLRequest) => {
    mainWindow.webContents.send("hitl:request", { id: correlationId, request });
});

const hitl = new HITL({
    adapter,
    questions: {
        abcQuestion: {
            instruction: "Use short single-choice questions when user intent is ambiguous.",
            maxAnswersRange: ["a", "b", "c", "d"]
        },
        openQuestion: {
            instruction: "Use open question only when choices cannot represent valid outcomes."
        }
    },
    toolsUsage: {
        transfer_money: {
            delayMs: 30_000,
            defaultAnswer: "deny"
        },
        delete_account: true
    }
});

ipcMain.handle("hitl:response", (_event, { id, response }) => {
    adapter.respond(id, response);
});

const agent = new ReActAgent({
    model,
    systemPrompt: "You are a careful assistant.",
    messages: [{ type: "user", content: "Handle my request safely" }],
    tools,
    hitl
});
```

Frontend (renderer process):
```typescript
import { ipcRenderer } from "electron";

ipcRenderer.on("hitl:request", (_event, { id, request }) => {
    if (request.type === "tool-approval") {
        const ok = confirm(`Allow tool "${request.toolName}"?`);
        ipcRenderer.invoke("hitl:response", {
            id,
            response: { type: "tool-approval", answer: ok ? "allow" : "deny" }
        });
    } else if (request.type === "abc-question") {
        const answer = prompt(
            request.question + "\n" + request.options.map(([k, v]) => `${k}: ${v}`).join("\n")
        );
        const selected = request.options.find(([k]) => k === answer);
        ipcRenderer.invoke("hitl:response", {
            id,
            response: {
                type: "abc-answer",
                option: selected?.[0] ?? answer,
                optionLabel: selected?.[1] ?? answer
            }
        });
    } else if (request.type === "open-question") {
        const answer = prompt(request.question);
        ipcRenderer.invoke("hitl:response", {
            id,
            response: { type: "open-answer", answer: answer ?? "" }
        });
    } else if (request.type === "acceptance") {
        const ok = confirm(request.question);
        ipcRenderer.invoke("hitl:response", {
            id,
            response: { type: "acceptance-answer", answer: ok ? "allow" : "deny" }
        });
    }
});
```

Tip: use a preload script with `contextBridge` instead of `ipcRenderer` directly in production to keep the renderer sandboxed.

### Tauri

Tauri runs the UI in a webview and the backend in Rust. To run Raven ADK you can bundle Node.js as a Tauri sidecar and bridge messages between the sidecar and the webview.

Node sidecar (`sidecar/index.ts`):
```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { HITL, HITLLocalAdapter, HITLRequest } from "@ravenlens/raven-adk/tools/hitl";

const adapter = new HITLLocalAdapter((correlationId, request: HITLRequest) => {
    // Write JSON lines to stdout; Rust reads them and forwards to the webview.
    console.log(JSON.stringify({ id: correlationId, request }));
});

const hitl = new HITL({
    adapter,
    questions: {
        abcQuestion: {
            instruction: "Use short single-choice questions when user intent is ambiguous.",
            maxAnswersRange: ["a", "b", "c"]
        },
        openQuestion: {
            instruction: "Use open question only when choices cannot represent valid outcomes."
        }
    },
    toolsUsage: {
        transfer_money: {
            delayMs: 30_000,
            defaultAnswer: "deny"
        },
        delete_account: true
    }
});

// Read responses from stdin (sent by Rust) and resolve pending HITL requests.
process.stdin.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
        try {
            const { id, response } = JSON.parse(line);
            adapter.respond(id, response);
        } catch {
            // Ignore malformed lines.
        }
    }
});

const agent = new ReActAgent({
    model,
    systemPrompt: "You are a careful assistant.",
    messages: [{ type: "user", content: "Handle my request safely" }],
    tools,
    hitl
});
```

Rust (`src-tauri/src/main.rs`):
```rust
use tauri::{Manager, Emitter};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;

#[derive(Clone, serde::Serialize)]
struct HitlPayload { id: u64, request: serde_json::Value }

#[tauri::command]
fn hitl_response(
    id: u64,
    response: serde_json::Value,
    stdin: tauri::State<Mutex<std::process::ChildStdin>>
) {
    let mut stdin = stdin.lock().unwrap();
    let _ = writeln!(stdin, "{}", serde_json::json!({ "id": id, "response": response }));
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let mut sidecar = Command::new_sidecar("node-backend")?
                .spawn()?;
            let stdout = BufReader::new(sidecar.stdout.take().unwrap());
            let stdin = sidecar.stdin.take().unwrap();
            let app_handle = app.handle().clone();

            thread::spawn(move || {
                let mut line = String::new();
                while stdout.read_line(&mut line).unwrap() > 0 {
                    if let Ok(payload) = serde_json::from_str::<HitlPayload>(&line) {
                        app_handle.emit("hitl:request", payload).unwrap();
                    }
                    line.clear();
                }
            });

            app.manage(Mutex::new(stdin));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![hitl_response])
        .run(tauri::generate_context!())
        .expect("error while running tauri");
}
```

Frontend (Tauri webview):
```typescript
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

listen("hitl:request", ({ payload }: { payload: { id: number; request: any } }) => {
    const { id, request } = payload;

    if (request.type === "tool-approval") {
        const ok = confirm(`Allow tool "${request.toolName}"?`);
        invoke("hitl_response", {
            id,
            response: { type: "tool-approval", answer: ok ? "allow" : "deny" }
        });
    } else if (request.type === "abc-question") {
        const answer = prompt(
            request.question + "\n" + request.options.map(([k, v]: [string, string]) => `${k}: ${v}`).join("\n")
        );
        const selected = request.options.find(([k]: [string, string]) => k === answer);
        invoke("hitl_response", {
            id,
            response: {
                type: "abc-answer",
                option: selected?.[0] ?? answer,
                optionLabel: selected?.[1] ?? answer
            }
        });
    } else if (request.type === "open-question") {
        const answer = prompt(request.question);
        invoke("hitl_response", {
            id,
            response: { type: "open-answer", answer: answer ?? "" }
        });
    } else if (request.type === "acceptance") {
        const ok = confirm(request.question);
        invoke("hitl_response", {
            id,
            response: { type: "acceptance-answer", answer: ok ? "allow" : "deny" }
        });
    }
});
```

## Defining your own adapter

Implement the `HITLAdapter` interface:

```typescript
import { HITLAdapter, HITLRequest, HITLResponse } from "@ravenlens/raven-adk/tools/hitl";

class MyAdapter implements HITLAdapter {
    private handler?: (correlationId: string | number, response: HITLResponse) => void;

    onResponse(handler: (correlationId: string | number, response: HITLResponse) => void) {
        this.handler = handler;
    }

    send(correlationId: string | number, request: HITLRequest) {
        // Forward the request through your channel.
        myChannel.send({ id: correlationId, request });
    }

    // Call this when your channel receives a response.
    onMessageReceived(correlationId: string | number, response: HITLResponse) {
        this.handler?.(correlationId, response);
    }
}
```

Rules an adapter must follow:
- `onResponse` stores the handler. The `HITL` constructor registers it immediately.
- `send` forwards the `correlationId` and `HITLRequest` to the UI/client unchanged.
- When the UI/client answers, call the stored handler with the same `correlationId` and a matching `HITLResponse`.
- Responses may arrive in any order; `HITL` resolves requests by `correlationId`.

## Questioning behavior
When question tools are enabled in questions config:

- The agent receives dedicated HITL tools for abc and open questions.
- The prompt guidance tells the model to ask only when truly required.
- This prevents unnecessary user interruptions and keeps the flow focused.

## Tool approval behavior
When toolsUsage includes a tool name:

- That tool call requires HITL approval before execution.
- If denied, the tool call is not executed and the denial is returned to the agent loop.
- If delay fallback is configured, fallback answer is used when timeout is reached.

Tip: enable approvals only for risky or irreversible operations so users are protected without excessive prompts.
