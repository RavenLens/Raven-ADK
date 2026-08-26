import type {
    CompletionItem,
    Diagnostic,
    DocumentSymbol,
    FormattingOptions,
    Hover,
    LSPClient,
    Location,
    Position,
    TextDocumentContentChangeEvent,
    TextDocumentIdentifier,
    TextDocumentItem,
    TextEdit,
    TypedLSPClient,
    VersionedTextDocumentIdentifier,
    WorkspaceEdit
} from "./lsp";

export interface RemoteLSPClientConfig {
    endpoint: string;
    languageId: string;
    workspaceRoot: string;
    headers?: Record<string, string>;
    initializationOptions?: unknown;
    formattingOptions?: FormattingOptions;
    fetch?: typeof globalThis.fetch;
}

interface JSONRPCResponse<TResult> {
    jsonrpc: "2.0";
    id: number;
    result?: TResult;
    error?: {
        code: number;
        message: string;
        data?: unknown;
    };
}

/** JSON-RPC-over-HTTP adapter for an LSP gateway or hosted language server. */
export class RemoteLSPClient implements TypedLSPClient {
    readonly languageId: string;
    readonly workspaceRoot: string;

    private readonly endpoint: string;
    private readonly headers: Record<string, string>;
    private readonly initializationOptions: unknown;
    private readonly formattingOptions?: FormattingOptions;
    private readonly fetchImpl: typeof globalThis.fetch;
    private nextRequestId = 1;
    private initialized = false;

    constructor(config: RemoteLSPClientConfig) {
        this.endpoint = config.endpoint;
        this.languageId = config.languageId;
        this.workspaceRoot = config.workspaceRoot;
        this.headers = { ...config.headers };
        this.initializationOptions = config.initializationOptions;
        this.formattingOptions = config.formattingOptions;
        this.fetchImpl = config.fetch ?? globalThis.fetch;

        if (!this.fetchImpl) {
            throw new Error("RemoteLSPClient requires a fetch implementation.");
        }
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        await this.request("initialize", {
            processId: null,
            rootUri: this.toFileUri(this.workspaceRoot),
            initializationOptions: this.initializationOptions,
            capabilities: {
                textDocument: {
                    synchronization: {
                        dynamicRegistration: false,
                        willSave: false,
                        willSaveWaitUntil: false,
                        didSave: false
                    },
                    hover: {},
                    definition: {},
                    references: {},
                    rename: {},
                    completion: {},
                    formatting: {},
                    documentSymbol: {}
                }
            }
        });
        await this.notify("initialized", {});
        this.initialized = true;
    }

    openDocument(document: TextDocumentItem): Promise<void> {
        return this.notify("textDocument/didOpen", { textDocument: document });
    }

    changeDocument(
        document: VersionedTextDocumentIdentifier,
        contentChanges: TextDocumentContentChangeEvent[]
    ): Promise<void> {
        return this.notify("textDocument/didChange", {
            textDocument: document,
            contentChanges
        });
    }

    closeDocument(document: TextDocumentIdentifier): Promise<void> {
        return this.notify("textDocument/didClose", { textDocument: document });
    }

    async request<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
        const id = this.nextRequestId++;
        const response = await this.post<JSONRPCResponse<TResult>>({
            jsonrpc: "2.0",
            id,
            method,
            params
        });

        if (response.error) {
            throw new Error(`Remote LSP request failed (${response.error.code}): ${response.error.message}`);
        }

        return response.result as TResult;
    }

    async notify(method: string, params?: unknown): Promise<void> {
        await this.post<void>({
            jsonrpc: "2.0",
            method,
            params
        }, false);
    }

    getDiagnostics(document: TextDocumentIdentifier): Promise<Diagnostic[]> {
        return this.request<{ items?: Diagnostic[] } | Diagnostic[]>("textDocument/diagnostic", {
            textDocument: document
        }).then((result: { items?: Diagnostic[] } | Diagnostic[]) =>
            Array.isArray(result) ? result : result.items ?? []
        );
    }

    hover(document: TextDocumentIdentifier, position: Position): Promise<Hover | null> {
        return this.request("textDocument/hover", { textDocument: document, position });
    }

    definition(document: TextDocumentIdentifier, position: Position): Promise<Location[] | null> {
        return this.request("textDocument/definition", { textDocument: document, position });
    }

    references(document: TextDocumentIdentifier, position: Position): Promise<Location[]> {
        return this.request("textDocument/references", {
            textDocument: document,
            position,
            context: { includeDeclaration: true }
        });
    }

    rename(
        document: TextDocumentIdentifier,
        position: Position,
        newName: string
    ): Promise<WorkspaceEdit | null> {
        return this.request("textDocument/rename", {
            textDocument: document,
            position,
            newName
        });
    }

    async completion(document: TextDocumentIdentifier, position: Position): Promise<CompletionItem[] | null> {
        const result = await this.request<CompletionItem[] | { items: CompletionItem[] } | null>(
            "textDocument/completion",
            { textDocument: document, position }
        );
        return Array.isArray(result) ? result : result?.items ?? null;
    }

    documentSymbols(document: TextDocumentIdentifier): Promise<DocumentSymbol[]> {
        return this.request("textDocument/documentSymbol", { textDocument: document });
    }

    formatting(document: TextDocumentIdentifier): Promise<TextEdit[] | null> {
        return this.request("textDocument/formatting", {
            textDocument: document,
            options: this.formattingOptions ?? { tabSize: 4, insertSpaces: true }
        });
    }

    async shutdown(): Promise<void> {
        if (!this.initialized) return;
        await this.request("shutdown");
        await this.notify("exit");
        this.initialized = false;
    }

    private async post<TResult>(body: unknown, expectsResponse = true): Promise<TResult> {
        const response = await this.fetchImpl(this.endpoint, {
            method: "POST",
            headers: {
                "content-type": "application/vscode-jsonrpc; charset=utf-8",
                ...this.headers
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Remote LSP request failed with HTTP ${response.status}.`);
        }

        if (!expectsResponse || response.status === 204) {
            return undefined as TResult;
        }

        return await response.json() as TResult;
    }

    private toFileUri(path: string): string {
        const normalized = path.replaceAll("\\", "/");
        return /^[A-Za-z]:\//.test(normalized)
            ? `file:///${encodeURI(normalized)}`
            : `file://${encodeURI(normalized)}`;
    }
}

export type RemoteLSPClientLike = LSPClient | RemoteLSPClient;
