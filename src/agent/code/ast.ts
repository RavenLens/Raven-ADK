import { SupportedLanguageName } from "./mutual";

export interface ASTParseResult {
    tree: unknown;
    diagnostics: ASTDiagnostic[];
}

export interface ASTDiagnostic {
    message: string;
    severity?: "info" | "warning" | "error";
    range?: ASTRange;
}

export interface SourcePosition {
    line: number;
    character: number;
}

export interface ASTRange {
    start: SourcePosition;
    end: SourcePosition;
}

export interface ASTParseInput {
    filePath: string;
    content: string;
}

export interface ASTTransformOperation {
    type:
        | "replace-node"
        | "insert-before"
        | "insert-after"
        | "delete-node"
        | "rename-symbol";
    target?: ASTRange;
    value?: string;
    arguments?: Record<string, unknown>;
}

export interface ASTTransformResult {
    changed: boolean;
    content?: string;
    tree?: unknown;
    diagnostics?: ASTDiagnostic[];
}

export interface ASTQueryInput {
    filePath: string;
    tree: unknown;
    query: string;
}

export interface ASTUtility {
    language: SupportedLanguageName;

    parse(input: ASTParseInput): Promise<ASTParseResult>;

    query<TResult = unknown>(input: ASTQueryInput): Promise<TResult>;

    transform?(
        tree: unknown,
        operation: ASTTransformOperation
    ): Promise<ASTTransformResult>;
}
