import type {
    ASTParseInput,
    ASTParseResult,
    ASTQueryInput,
    ASTTransformOperation,
    ASTTransformResult,
    ASTUtility
} from "./ast";
import type { SupportedLanguageName } from "../mutual";

export interface RemoteASTUtilityConfig {
    baseUrl: string;
    language: SupportedLanguageName;
    parsePath?: string;
    queryPath?: string;
    transformPath?: string;
    headers?: Record<string, string>;
    fetch?: typeof globalThis.fetch;
}

/** HTTP adapter for an AST service exposing parse, query, and transform endpoints. */
export class RemoteASTUtility implements ASTUtility {
    readonly language: SupportedLanguageName;
    private readonly baseUrl: string;
    private readonly parsePath: string;
    private readonly queryPath: string;
    private readonly transformPath: string;
    private readonly headers: Record<string, string>;
    private readonly fetchImpl: typeof globalThis.fetch;

    constructor(config: RemoteASTUtilityConfig) {
        this.language = config.language;
        this.baseUrl = config.baseUrl.replace(/\/$/, "");
        this.parsePath = config.parsePath ?? "/ast/parse";
        this.queryPath = config.queryPath ?? "/ast/query";
        this.transformPath = config.transformPath ?? "/ast/transform";
        this.headers = { ...config.headers };
        this.fetchImpl = config.fetch ?? globalThis.fetch;

        if (!this.fetchImpl) {
            throw new Error("RemoteASTUtility requires a fetch implementation.");
        }
    }

    parse(input: ASTParseInput): Promise<ASTParseResult> {
        return this.post<ASTParseResult>(this.parsePath, input);
    }

    query<TResult = unknown>(input: ASTQueryInput): Promise<TResult> {
        return this.post<TResult>(this.queryPath, input);
    }

    transform(
        tree: unknown,
        operation: ASTTransformOperation
    ): Promise<ASTTransformResult> {
        return this.post<ASTTransformResult>(this.transformPath, {
            language: this.language,
            tree,
            operation
        });
    }

    private async post<TResult>(path: string, body: unknown): Promise<TResult> {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...this.headers
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Remote AST request failed with HTTP ${response.status}.`);
        }

        return await response.json() as TResult;
    }
}
