export interface TextDocumentIdentifier {
    uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
    version: number;
}

export interface TextDocumentItem extends TextDocumentIdentifier {
    languageId: string;
    version: number;
    text: string;
}

export interface TextDocumentContentChangeEvent {
    text: string;
    range?: Range;
    rangeLength?: number;
}

export interface FormattingOptions {
    tabSize: number;
    insertSpaces: boolean;
    [option: string]: boolean | number | string;
}

export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

export interface Diagnostic {
    range: Range;
    message: string;
    severity?: 1 | 2 | 3 | 4;
    source?: string;
    code?: string | number;
    relatedInformation?: DiagnosticRelatedInformation[];
    tags?: number[];
    data?: unknown;
}

export interface DiagnosticRelatedInformation {
    location: Location;
    message: string;
}

export interface Hover {
    contents: unknown;
    range?: Range;
}

export interface Location {
    uri: string;
    range: Range;
}

export interface WorkspaceEdit {
    changes?: Record<string, TextEdit[]>;
    documentChanges?: TextDocumentEdit[];
}

export interface TextEdit {
    range: Range;
    newText: string;
}

export interface TextDocumentEdit {
    textDocument: VersionedTextDocumentIdentifier;
    edits: TextEdit[];
}

export interface CompletionItem {
    label: string;
    detail?: string;
    kind?: number;
    insertText?: string;
}

export interface DocumentSymbol {
    name: string;
    kind: number;
    range: Range;
    selectionRange: Range;
    children?: DocumentSymbol[];
}

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

    request<TResult = unknown>(
        method: string,
        params?: unknown
    ): Promise<TResult>;
    notify(method: string, params?: unknown): Promise<void>;
    shutdown(): Promise<void>;
}

export interface TypedLSPClient extends LSPClient {
    getDiagnostics(
        document: TextDocumentIdentifier
    ): Promise<Diagnostic[]>;

    hover(
        document: TextDocumentIdentifier,
        position: Position
    ): Promise<Hover | null>;

    definition(
        document: TextDocumentIdentifier,
        position: Position
    ): Promise<Location[] | null>;

    references(
        document: TextDocumentIdentifier,
        position: Position
    ): Promise<Location[]>;

    rename(
        document: TextDocumentIdentifier,
        position: Position,
        newName: string
    ): Promise<WorkspaceEdit | null>;

    completion(
        document: TextDocumentIdentifier,
        position: Position
    ): Promise<CompletionItem[] | null>;

    documentSymbols(
        document: TextDocumentIdentifier
    ): Promise<DocumentSymbol[]>;

    formatting(
        document: TextDocumentIdentifier
    ): Promise<Array<{
        range: Range;
        newText: string;
    }> | null>;
}
