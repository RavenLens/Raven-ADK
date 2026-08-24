# Language Server Protocol

LSP utilities provide semantic language intelligence to CodeAct. They are
direct clients of a language server and are distinct from MCP clients:

```text
Direct LSP: CodeAct -> LSPClient -> language server
MCP bridge: CodeAct -> MCP -> MCP server -> language server
```

Use `lsp` for the first architecture and `mcp` for the second.

## Contract

The public contract is in `src/agent/code/lsp.ts`:

```ts
export interface LSPClient {
	languageId: string;
	workspaceRoot: string;

	initialize(): Promise<void>;
	openDocument(document: TextDocumentItem): Promise<void>;
	changeDocument(
		document: VersionedTextDocumentIdentifier,
		contentChanges: TextDocumentContentChangeEvent[]
	): Promise<void>;
	closeDocument(document: TextDocumentIdentifier): Promise<void>;
	request<TResult = unknown>(method: string, params?: unknown): Promise<TResult>;
	notify(method: string, params?: unknown): Promise<void>;
	shutdown(): Promise<void>;
}
```

The document lifecycle is required because language servers do not
automatically read every file mutation from disk. CodeAct must send
`textDocument/didOpen` and `textDocument/didChange` before requesting semantic
results for an edited file.

`TypedLSPClient` adds convenience methods for common LSP requests:

```ts
hover(document, position)
definition(document, position)
references(document, position)
rename(document, position, newName)
completion(document, position)
documentSymbols(document)
formatting(document)
```

## Ready npm Packages

The package uses these standard building blocks:

```powershell
npm install vscode-jsonrpc vscode-languageserver-protocol
```

| Package/server | Role |
| --- | --- |
| `vscode-jsonrpc` | JSON-RPC over stdin/stdout or streams |
| `vscode-languageserver-protocol` | Official LSP data types |
| `typescript-language-server` | TypeScript and JavaScript server |
| `pyright-langserver` | Python server |
| `rust-analyzer` | Rust server, normally installed as a binary |
| `gopls` | Go server, normally installed as a binary |
| Eclipse JDT Language Server | Java server |

The exported `StdioLSPClient` uses `vscode-jsonrpc` and can launch any server
that supports the standard `--stdio` transport.

## TypeScript Example

Install the server globally or make it available on the process PATH:

```powershell
npm install -g typescript typescript-language-server
```

Configure it for CodeAct:

```ts
import {
	StdioLSPClient,
	TypeScriptASTUtility,
	type CodeActConfig
} from "@ravenlens/raven-adk/code";

const languageServer = new StdioLSPClient({
	command: "typescript-language-server",
	args: ["--stdio"],
	languageId: "typescript",
	workspaceRoot: "D:/projects/example"
});

const config: CodeActConfig<Skills, Memory, HITL, Sandbox> = {
	pattern: "codeact",
	model,
	systemPrompt: "You are a coding agent.",
	workspaces: {
		list: [{
			workspaceId: "example",
			root: "D:/projects/example",
			workerIsolation: "snapshot",
			applyMode: "serialized"
		}]
	},
	writeMode: "proposal",
	tools: [],
	mcp: [],
	lsp: [languageServer],
	ast: [new TypeScriptASTUtility()],
	memory,
	sandboxes,
	validationCommands
};
```

## Direct LSP Usage

The client lifecycle should eventually be owned by `CodeActAgent`. Until that
runtime orchestration is implemented, an integration can manage it directly:

```ts
await languageServer.initialize();

const document = {
	uri: "file:///D:/projects/example/src/index.ts",
	languageId: "typescript",
	version: 1,
	text: "const answer: string = 42;"
};

await languageServer.openDocument(document);

const diagnostics = await languageServer.getDiagnostics(document);
const hover = await languageServer.hover(document, {
	line: 0,
	character: 6
});

const definitions = await languageServer.definition(document, {
	line: 0,
	character: 6
});

await languageServer.closeDocument({ uri: document.uri });
await languageServer.shutdown();
```

Diagnostics are collected from the standard
`textDocument/publishDiagnostics` notification and returned by
`getDiagnostics`. This is why diagnostics may arrive asynchronously after
`openDocument` or `changeDocument`.

## Other Servers

The same adapter works with another stdio server by changing the command and
language identifier:

```ts
const python = new StdioLSPClient({
	command: "pyright-langserver",
	args: ["--stdio"],
	languageId: "python",
	workspaceRoot: "D:/projects/python-app"
});
```

## Remote Resources

The package exports `RemoteLSPClient` for an LSP gateway that accepts one
JSON-RPC message per HTTP `POST`. Requests use the standard LSP method names:

```ts
import { RemoteLSPClient } from "@ravenlens/raven-adk/code";

const remoteLsp = new RemoteLSPClient({
	endpoint: "https://lsp.example.com/jsonrpc",
	languageId: "typescript",
	workspaceRoot: "/workspace/project",
	headers: {
		Authorization: `Bearer ${process.env.LSP_TOKEN}`
	}
});

await remoteLsp.initialize();
await remoteLsp.openDocument({
	uri: "file:///workspace/project/src/index.ts",
	languageId: "typescript",
	version: 1,
	text: source
});

const hover = await remoteLsp.hover(
	{ uri: "file:///workspace/project/src/index.ts" },
	{ line: 0, character: 6 }
);
```

The gateway receives a request such as:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "textDocument/hover",
  "params": {
    "textDocument": { "uri": "file:///workspace/project/src/index.ts" },
    "position": { "line": 0, "character": 6 }
  }
}
```

It must return a JSON-RPC response with the same `id`. Notifications such as
`textDocument/didOpen`, `textDocument/didChange`, `initialized`, and `exit`
are sent without an id. The remote adapter requests pull-based diagnostics
with `textDocument/diagnostic`; HTTP cannot receive the server-push
`textDocument/publishDiagnostics` notification unless the gateway adds a
callback, SSE, or WebSocket channel.

`RemoteLSPClient` accepts custom authentication and gateway headers:

```ts
const remoteLsp = new RemoteLSPClient({
	endpoint: "https://gateway.example.com/lsp",
	languageId: "python",
	workspaceRoot: "/workspaces/python-app",
	headers: {
		Authorization: `Bearer ${token}`,
		"x-workspace-id": "python-app"
	}
});
```

Other remote transport choices:

* **WebSocket:** use a persistent JSON-RPC connection when the server needs
  push diagnostics and low-latency requests. Implement `LSPClient` with the
  same lifecycle and typed methods.
* **SSH:** use `StdioLSPClient` with `ssh` as the command when the remote host
  can run the language server and its file URIs are meaningful there.
* **MCP:** expose selected LSP operations as MCP tools and configure the
  capability under `mcp` rather than `lsp`.
* **TCP:** adapt a `vscode-jsonrpc` stream connection to `LSPClient` when the
  hosted server exposes raw JSON-RPC over TCP.

Remote LSP servers must authorize workspace roots and document URIs. Treat
`WorkspaceEdit` results as proposals and let the CodeAct workspace policy
validate and apply them; the remote client never writes the local workspace.

## CodeAct Runtime Status

Remote clients can be placed directly into the configuration:

```ts
const config = {
	// ...required CodeAct configuration
	ast: [],
	lsp: [remoteLsp],
	mcp: []
};
```

The current `CodeActAgent.invoke` implementation is not yet an execution loop.
Consequently, this configuration makes the provider available to an
integration, but CodeAct does not yet automatically initialize it, issue LSP
requests, record `lsp_call` traces, or convert edits into `ChangeSet`s.

Servers that expose TCP or WebSocket transport need a different transport
adapter. A REST endpoint is not automatically LSP-compatible; it must bridge
JSON-RPC requests, responses, and notifications.

## CodeAct Boundaries

LSP requests should be recorded as `lsp_call` traces. A rename or formatting
response returns a `WorkspaceEdit`; CodeAct should convert that edit into a
`ChangeSet` and apply its proposal/approval policy. The LSP client itself
should not mutate the target workspace.

MCP and LSP should not normally expose the same server through both
configuration fields. Choose the protocol CodeAct uses to reach the
capability.
