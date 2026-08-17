# AST Utilities

AST utilities provide local syntax-tree capabilities to CodeAct. They are not
an AST network protocol. An implementation adapts a parser or code-modification
library to the `ASTUtility` interface in `src/agent/code/ast.ts`.

## Contract

```ts
export interface ASTUtility {
	language: SupportedLanguageName;

	parse(input: ASTParseInput): Promise<ASTParseResult>;

	query<TResult = unknown>(input: ASTQueryInput): Promise<TResult>;

	transform?(
		tree: unknown,
		operation: ASTTransformOperation
	): Promise<ASTTransformResult>;
}
```

The current operation union is intentionally small:

```ts
type ASTTransformOperation = {
	type:
		| "replace-node"
		| "insert-before"
		| "insert-after"
		| "delete-node"
		| "rename-symbol";
	target?: ASTRange;
	value?: string;
	arguments?: Record<string, unknown>;
};
```

`query` is provider-specific. A provider must document the query strings it
accepts. The built-in TypeScript example below supports `functions`, `classes`,
and `imports`.

## TypeScript Implementation

The package exports `TypeScriptASTUtility` out-of-the-box, which uses the TypeScript compiler
API for parsing, syntax traversal, and printing transformed source.

```ts
import {
	TypeScriptASTUtility,
	type ASTParseResult
} from "@ravenlens/raven-adk/code";

const ast = new TypeScriptASTUtility();

const parsed: ASTParseResult = await ast.parse({
	filePath: "src/example.ts",
	content: `
		function greet(name: string) {
			return "Hello " + name;
		}
	`
});

const functions = await ast.query({
	filePath: "src/example.ts",
	tree: parsed.tree,
	query: "functions"
});

const transformed = await ast.transform!(parsed.tree, {
	type: "rename-symbol",
	target: {
		start: { line: 1, character: 17 },
		end: { line: 1, character: 22 }
	},
	value: "welcome"
});

console.log(functions, transformed.content);
```

The TypeScript compiler API is appropriate for TypeScript and JavaScript
projects. Other real providers can be adapted in the same way. Example providers that would be implement are:

| Provider | Best use |
| --- | --- |
| `typescript` | TypeScript and JavaScript syntax and compiler transformations |
| `ts-morph` | Ergonomic TypeScript refactoring |
| `tree-sitter` | Fast multi-language parsing and structural queries |
| Babel parser/traverse | JavaScript and JSX codemods |
| Roslyn | C# syntax and semantic transformations |
| LibCST | Python transformations that preserve formatting |

AST utilities should be used for syntax-local operations. Use LSP for
project-wide semantic operations such as finding references or resolving a
symbol across files.

> These providers aren't implement out-of-the-box as the typescript is but can be with usage of `ASTUtility` utility

## CodeAct Configuration

`CodeActConfig` keeps AST separate from LSP and MCP:

```ts
const config = {
	// ...required CodeAct configuration
	ast: [new TypeScriptASTUtility()],
	lsp: [],
	mcp: []
};
```

An AST provider may be wrapped by an MCP server, but then the `CodeAct` client is
using MCP and the capability belongs in `mcp`, not `ast`.

## Remote Resources

The package exports `RemoteASTUtility` for an AST service exposed over HTTP.
The service is expected to provide these JSON endpoints by default:

| Endpoint | Request | Response |
| --- | --- | --- |
| `POST /ast/parse` | `ASTParseInput` | `ASTParseResult` |
| `POST /ast/query` | `ASTQueryInput` | Provider-specific query result |
| `POST /ast/transform` | `{ language, tree, operation }` | `ASTTransformResult` |

```ts
import { RemoteASTUtility } from "@ravenlens/raven-adk/code";

const remoteAst = new RemoteASTUtility({
	baseUrl: "https://ast.example.com",
	language: "typescript",
	headers: {
		Authorization: `Bearer ${process.env.AST_TOKEN}`
	}
});

const parsed = await remoteAst.parse({
	filePath: "src/index.ts",
	content: source
});

const symbols = await remoteAst.query({
	filePath: "src/index.ts",
	tree: parsed.tree,
	query: "functions"
});
```

Custom endpoint paths are supported when the service uses a different API:

```ts
const remoteAst = new RemoteASTUtility({
	baseUrl: "https://code-tools.example.com/api",
	language: "python",
	parsePath: "/parse",
	queryPath: "/query",
	transformPath: "/transform"
});
```

The remote service owns parser state and must return JSON-serializable trees.
Do not send secrets or unrestricted workspace contents unless the remote
service is trusted. Prefer short-lived credentials, HTTPS, request limits, and
server-side workspace authorization.

Other remote integration options are possible:

* **MCP:** expose AST parsing and transformations as MCP tools and configure
  the server under `mcp`.
* **WebSocket:** implement `ASTUtility` over a persistent JSON message
  channel when parsing many files or keeping a server-side tree cache.
* **SSH:** run a remote AST worker through an SSH command and adapt its stdin
  and stdout protocol to `ASTUtility`.

`RemoteASTUtility` is an adapter, not a universal AST protocol. The remote
service and client must agree on query names, tree format, operation semantics,
and error responses.

## CodeAct Runtime Status

`CodeActConfig` can store remote providers:

```ts
const config = {
	// ...required CodeAct configuration
	ast: [remoteAst],
	lsp: [],
	mcp: []
};
```

The current `CodeActAgent.invoke` implementation is not yet an execution loop,
so providers configured here are available to an integration but are not
automatically parsed, queried, transformed, traced, or converted into
`ChangeSet`s by CodeAct itself.

## Safety and Change Application

`parse` and `query` should be read-only. `transform` returns content and a
changed flag; it should not write to the workspace itself. CodeAct should place
the returned content into a `ChangeSet`, apply proposal/approval policy, and
run validation commands before reporting completion.
