# Human-In-The-Loop
Human-In-The-Loop (HITL) lets the agent ask the user for tool usage confirmation, information confirmation or missing information before continuing.

When HITL is active, agent execution waits for user input wherever HITL is required.

## How HITL Works
HITL currently supports two interaction types.

1. Tool approval
- Before executing selected tools, the agent asks the user for permission.
- Allowed answers are `allow` or `deny`.
- If delay rules are configured for a tool, a default answer can be applied after a timeout.
- Tool approvals are requested in parallel for all configured tool calls in the same step, and the step is blocked until all approvals are resolved.

2. User questions
- The agent can ask the user for information when context is missing.
- Question modes:
- Single-choice question (abc-style): user selects one option like `a`, `b`, `c`.
- Open question: user responds with free text.

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

Adapters are transport implementations, not HITL strategies. See [LocalHITL.md](LocalHITL.md)
and [SocketHITL.md](SocketHITL.md) for adapter-specific setup.

<!-- ## HITL Internal Events
Each class implements custom class that  -->

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
