import ts from "typescript";
import type {
    ASTDiagnostic,
    ASTParseInput,
    ASTParseResult,
    ASTQueryInput,
    ASTTransformOperation,
    ASTTransformResult,
    ASTUtility
} from "./ast";

interface TypeScriptTree {
    sourceFile: ts.SourceFile;
    content: string;
}

export class TypeScriptASTUtility implements ASTUtility {
    readonly language = "typescript";

    async parse(input: ASTParseInput): Promise<ASTParseResult> {
        const sourceFile = ts.createSourceFile(
            input.filePath,
            input.content,
            ts.ScriptTarget.Latest,
            true,
            this.getScriptKind(input.filePath)
        );
        const parseDiagnostics = (sourceFile as ts.SourceFile & {
            parseDiagnostics?: readonly ts.Diagnostic[];
        }).parseDiagnostics ?? [];

        return {
            tree: { sourceFile, content: input.content } satisfies TypeScriptTree,
            diagnostics: parseDiagnostics.map((diagnostic) =>
                this.toDiagnostic(sourceFile, diagnostic)
            )
        };
    }

    async query<TResult = unknown>(input: ASTQueryInput): Promise<TResult> {
        const tree = input.tree as TypeScriptTree;
        const matches: Array<{
            kind: string;
            name?: string;
            text: string;
            start: number;
            end: number;
        }> = [];

        const visit = (node: ts.Node): void => {
            const isFunction = ts.isFunctionDeclaration(node);
            const isClass = ts.isClassDeclaration(node);
            const isImport = ts.isImportDeclaration(node);
            const matchesQuery =
                (input.query === "functions" && isFunction) ||
                (input.query === "classes" && isClass) ||
                (input.query === "imports" && isImport);

            if (matchesQuery) {
                const namedNode = "name" in node && node.name && ts.isIdentifier(node.name)
                    ? node.name
                    : undefined;

                matches.push({
                    kind: ts.SyntaxKind[node.kind],
                    name: namedNode?.getText(tree.sourceFile),
                    text: node.getText(tree.sourceFile),
                    start: node.getStart(tree.sourceFile),
                    end: node.getEnd()
                });
            }

            ts.forEachChild(node, visit);
        };

        visit(tree.sourceFile);
        return matches as TResult;
    }

    async transform(
        tree: unknown,
        operation: ASTTransformOperation
    ): Promise<ASTTransformResult> {
        if (operation.type !== "rename-symbol") {
            return {
                changed: false,
                diagnostics: [{
                    message: `Unsupported operation: ${operation.type}`,
                    severity: "error"
                }]
            };
        }

        if (!operation.target || !operation.value) {
            return {
                changed: false,
                diagnostics: [{
                    message: "rename-symbol requires target and value",
                    severity: "error"
                }]
            };
        }

        const original = tree as TypeScriptTree;
        const targetStart = original.sourceFile.getPositionOfLineAndCharacter(
            operation.target.start.line,
            operation.target.start.character
        );
        const targetEnd = original.sourceFile.getPositionOfLineAndCharacter(
            operation.target.end.line,
            operation.target.end.character
        );
        let changed = false;

        const transformer: ts.TransformerFactory<ts.Node> = (context) => {
            const visit = (node: ts.Node): ts.VisitResult<ts.Node> => {
                if (
                    ts.isIdentifier(node) &&
                    node.getStart(original.sourceFile) >= targetStart &&
                    node.getEnd() <= targetEnd
                ) {
                    changed = true;
                    return ts.factory.createIdentifier(operation.value!);
                }

                return ts.visitEachChild(node, visit, context);
            };

            return (node) => ts.visitNode(node, visit);
        };

        const transformed = ts.transform(original.sourceFile, [transformer]);
        const sourceFile = transformed.transformed[0] as ts.SourceFile;
        const content = changed
            ? ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(sourceFile)
            : original.content;

        transformed.dispose();

        return {
            changed,
            content,
            tree: { sourceFile, content } satisfies TypeScriptTree
        };
    }

    private getScriptKind(filePath: string): ts.ScriptKind {
        if (filePath.endsWith(".tsx")) return ts.ScriptKind.TSX;
        if (filePath.endsWith(".jsx")) return ts.ScriptKind.JSX;
        if (filePath.endsWith(".js")) return ts.ScriptKind.JS;
        return ts.ScriptKind.TS;
    }

    private toDiagnostic(
        sourceFile: ts.SourceFile,
        diagnostic: ts.Diagnostic
    ): ASTDiagnostic {
        const start = diagnostic.start ?? 0;
        const end = start + (diagnostic.length ?? 0);
        const startPosition = sourceFile.getLineAndCharacterOfPosition(start);
        const endPosition = sourceFile.getLineAndCharacterOfPosition(end);

        return {
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
            severity: "error",
            range: {
                start: startPosition,
                end: endPosition
            }
        };
    }
}
