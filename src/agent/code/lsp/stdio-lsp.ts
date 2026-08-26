import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
    VersionedTextDocumentIdentifier,
    WorkspaceEdit
} from "./lsp";

// Loaded at runtime so the package can keep its existing CommonJS compiler setup.
const rpc = require("vscode-jsonrpc/node") as {
    createMessageConnection: (reader: unknown, writer: unknown) => any;
    StreamMessageReader: new (stream: NodeJS.ReadableStream) => unknown;
    StreamMessageWriter: new (stream: NodeJS.WritableStream) => unknown;
};

export interface StdioLSPClientConfig {
    command: string;
    args?: string[];
    languageId: string;
    workspaceRoot: string;
    initializationOptions?: unknown;
    formattingOptions?: FormattingOptions;
}

export class StdioLSPClient implements LSPClient {
    readonly languageId: string;
    readonly workspaceRoot: string;

    private process?: ChildProcessWithoutNullStreams;
    private connection?: any;
    private diagnostics = new Map<string, Diagnostic[]>();

    constructor(private readonly config: StdioLSPClientConfig) {
        this.languageId = config.languageId;
        this.workspaceRoot = config.workspaceRoot;
    }

    async initialize(): Promise<void> {
        if (this.connection) return;

        this.process = spawn(this.config.command, this.config.args ?? [], {
            cwd: this.workspaceRoot,
            stdio: "pipe"
        });

        this.process.on("error", (error) => {
            this.connection?.dispose();
            this.connection = undefined;
            throw error;
        });

        this.connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(this.process.stdout),
            new rpc.StreamMessageWriter(this.process.stdin)
        );

        this.connection.onNotification(
            "textDocument/publishDiagnostics",
            (params: { uri: string; diagnostics: Diagnostic[] }) => {
                this.diagnostics.set(params.uri, params.diagnostics);
            }
        );

        this.connection.listen();

        await this.request("initialize", {
            processId: process.pid,
            rootUri: this.toFileUri(this.workspaceRoot),
            initializationOptions: this.config.initializationOptions,
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
    }

    async openDocument(document: TextDocumentItem): Promise<void> {
        await this.notify("textDocument/didOpen", { textDocument: document });
    }

    async changeDocument(
        document: VersionedTextDocumentIdentifier,
        contentChanges: TextDocumentContentChangeEvent[]
    ): Promise<void> {
        await this.notify("textDocument/didChange", {
            textDocument: document,
            contentChanges
        });
    }

    async closeDocument(document: TextDocumentIdentifier): Promise<void> {
        await this.notify("textDocument/didClose", { textDocument: document });
    }

    async request<TResult = unknown>(
        method: string,
        params?: unknown
    ): Promise<TResult> {
        if (!this.connection) {
            throw new Error("LSP client is not initialized.");
        }

        return this.connection.sendRequest(method, params) as Promise<TResult>;
    }

    async notify(method: string, params?: unknown): Promise<void> {
        if (!this.connection) {
            throw new Error("LSP client is not initialized.");
        }

        await this.connection.sendNotification(method, params);
    }

    async getDiagnostics(document: TextDocumentIdentifier): Promise<Diagnostic[]> {
        return this.diagnostics.get(document.uri) ?? [];
    }

    async hover(document: TextDocumentIdentifier, position: Position): Promise<Hover | null> {
        return this.request("textDocument/hover", {
            textDocument: document,
            position
        });
    }

    async definition(document: TextDocumentIdentifier, position: Position): Promise<Location[] | null> {
        return this.request("textDocument/definition", {
            textDocument: document,
            position
        });
    }

    async references(document: TextDocumentIdentifier, position: Position): Promise<Location[]> {
        return this.request("textDocument/references", {
            textDocument: document,
            position,
            context: { includeDeclaration: true }
        });
    }

    async rename(
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

    async documentSymbols(document: TextDocumentIdentifier): Promise<DocumentSymbol[]> {
        return this.request("textDocument/documentSymbol", {
            textDocument: document
        });
    }

    async formatting(document: TextDocumentIdentifier): Promise<TextEdit[] | null> {
        return this.request("textDocument/formatting", {
            textDocument: document,
            options: this.config.formattingOptions ?? {
                tabSize: 4,
                insertSpaces: true
            }
        });
    }

    async shutdown(): Promise<void> {
        if (!this.connection) return;

        try {
            await this.request("shutdown");
            await this.notify("exit");
        } finally {
            this.connection.dispose();
            this.process?.kill();
            this.connection = undefined;
            this.process = undefined;
        }
    }

    private toFileUri(path: string): string {
        const normalized = path.replaceAll("\\", "/");
        return /^[A-Za-z]:\//.test(normalized)
            ? `file:///${encodeURI(normalized)}`
            : `file://${encodeURI(normalized)}`;
    }
}
