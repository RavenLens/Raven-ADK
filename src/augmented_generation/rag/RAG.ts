import { CodeExecutionSandboxSchema, ReActAgent } from "../../agent";
import { AgentModel } from "../../agent/ReAct.agent";
import { DeterministicMemorySchema } from "../../agent/memory/schema/deterministicMemorySchema";
import { ToolBasedMemorySchema } from "../../agent/memory/schema/toolMemorySchema";
import { SchemaSkillStore } from "../../agent/skills/stores/schema";
import { HITLTransportSchema } from "../../agent/tools/hitl/hitlToolSchema";
import { Mutual } from "../../models";
import { StandardLLMShema, InvokeOptions, LLMAnswer } from "../../models/mutual";
import * as z from "zod";
import { recordEventWithData, withTelemetry } from "../../telemetry";

export type SimilarityAlgorithm = 'Cosine Similarity' | 'Euclidean Distance';

export interface RAGDbSchema {
    name: string;
    fetch(query: string | string[], algorithm?: SimilarityAlgorithm): Promise<RAGDocument[]>;
    /** Save documents 
     * @returns number of saved documents
    */
    save(documents: RAGDocument | RAGDocument[]): Promise<number>;
    /** Returns all documents in the database */
    getAll(): RAGDocument[];
}

export interface RAGDocument {
    id: string;
    title: string;
    content: string;
    keywords: string[];
    subMemoryIds: string[];
    embedding?: number[];
}

export interface RAGConfig<RAGDb extends RAGDbSchema, RAGModel extends Mutual.EmbeddingModel> {
    /** User or system query to seek similarity */
    query: string;
    database: RAGDb;
    model: RAGModel;
    /** 
     * Where to inject the RAG context and instructions.
     * Default: "system"
     */
    injectionPlace?: "system" | "user";
    /** 
     * Optional similarity algorithm to use.
     * Only supported by databases that implement algorithm-specific fetching like `InMemory`.
     */
    similarityAlgorithm?: SimilarityAlgorithm;
}

export class ResourceAugmentedGeneration
<
    RAGDb extends RAGDbSchema,
    RAGModel extends Mutual.EmbeddingModel,
    Skills extends SchemaSkillStore,
    Memory extends DeterministicMemorySchema | ToolBasedMemorySchema<any, any>,
    HITL extends HITLTransportSchema,
    SkillsSandbox extends CodeExecutionSandboxSchema,
    Target extends ReActAgent<Skills, Memory, HITL, SkillsSandbox> | StandardLLMShema = StandardLLMShema
> {
    readonly type = "rag-chain";
    config: RAGConfig<RAGDb, RAGModel>;
    executeAfter?: Target;

    constructor(config: RAGConfig<RAGDb, RAGModel>, executeAfter?: Target) {
        this.config = config;
        this.executeAfter = executeAfter;

        recordEventWithData("rag_initialized", JSON.stringify({
            config: this.config,
            dbName: this.config.database.name,
            executeAfterRAG: executeAfter
        }, null, 4))
    }

    register<T extends ReActAgent<Skills, Memory, HITL, SkillsSandbox> | AgentModel>(
        executeAfter: T
    ): ResourceAugmentedGeneration<RAGDb, RAGModel, Skills, Memory, HITL, SkillsSandbox, T> {
        recordEventWithData("rag_register", JSON.stringify({
            executeAfterRAG: executeAfter
        }, null, 4))
        
        return new ResourceAugmentedGeneration<RAGDb, RAGModel, Skills, Memory, HITL, SkillsSandbox, T>(
            this.config,
            executeAfter
        );
    }
    
    /** Explicit overloads for type safety */
    invoke(withMethod?: { method: "invoke", params?: [InvokeOptions & { stream?: false } | undefined] }): Promise<Target extends ReActAgent<any, any, any, any> ? Awaited<ReturnType<ReActAgent<any, any, any, any>["invoke"]>> : LLMAnswer>;
    invoke(withMethod: { method: "invoke", params: [InvokeOptions & { stream: true }] }): Promise<AsyncIterable<any>>;
    invoke(withMethod: { method: "invokeStructuredOutput", params: [z.ZodTypeAny, number?] }): Promise<Target extends ReActAgent<any, any, any, any> ? Awaited<ReturnType<ReActAgent<any, any, any, any>["invokeStructuredOutput"]>> : LLMAnswer>;
    
    async invoke(
        withMethod?: { 
            method: "invoke" | "invokeStructuredOutput", 
            params?: any[]
        }
    ): Promise<any> {
        return withTelemetry("rag_invoke", {
            "rag.query": this.config.query,
            "rag.database": this.config.database.name,
            "rag.injection_place": this.config.injectionPlace ?? "system"
        }, async (span) => {
            if (!this.executeAfter) throw new Error("`register` method has to be called before `invoke` can be executed.");

            const injectionPlace = this.config.injectionPlace ?? "system";

            // 1. Fetch documents from the RAG database based on the query
            const documents = await this.config.database.fetch(
                this.config.query, 
                this.config.similarityAlgorithm
            );

            // 1.5. Record Rag query result
            recordEventWithData("rag_query_result", {
                query: this.config.query,
                documentsCount: documents.length,
                documentsMetadata: documents.map(doc => ({ id: doc.id, title: doc.title }))
            });

            span?.setAttribute("rag.documents_count", documents.length);
            
            // 2. Format the retrieved documents as annotated context
            const contextLines = documents.map(doc => `[Source: ${doc.title}]\n${doc.content}`).join("\n\n");
            const annotation = `\n\n### RAG CONTEXT (Retrieved for: ${this.config.query})\n${contextLines}\n### END RAG CONTEXT`;

            // 3. Access the messages of the registered agent or model
            let messages: any[] = [];
            if (this.executeAfter instanceof ReActAgent) {
                messages = this.executeAfter.agentConfig.messages;
            } else {
                // It's a specialized AgentModel (StandardLLMShema) object
                if (!this.executeAfter.config.messages) {
                    this.executeAfter.config.messages = [];
                }
                messages = this.executeAfter.config.messages;
            }

            // 4. Prepare RAG instruction
            const ragInstruction = "\n\nUse the RAG CONTEXT provided as your primary state of truth to answer the user query. If the answer is not contained within the provided context, clearly state that you do not have enough information rather than hallucinating or inventing details.";

            // 5. Inject context and instructions
            if (injectionPlace === "system") {
                const systemMessageIndex = messages.findIndex(m => m.type === "system");
                if (systemMessageIndex !== -1) {
                    messages[systemMessageIndex].content += ragInstruction + annotation;
                } else {
                    messages.unshift({
                        type: "system",
                        content: ragInstruction + annotation
                    });
                }
            } else {
                // "user" injection
                // Still add instruction to system for better alignment
                const systemMessageId = messages.findIndex(m => m.type === "system");
                if (systemMessageId !== -1) {
                    messages[systemMessageId].content += ragInstruction;
                } else {
                    messages.unshift({
                        type: "system",
                        content: ragInstruction
                    });
                }

                const lastUserMessageId = messages.findLastIndex(m => m.type === "user");
                if (lastUserMessageId !== -1) {
                    messages[lastUserMessageId].content += annotation;
                } else {
                    messages.push({
                        type: "user",
                        content: `Using retrieved context for query: ${this.config.query}${annotation}`
                    });
                }
            }
            
            // 5.5: Assignes prepared messages
            if (this.executeAfter instanceof ReActAgent) {
                this.executeAfter.agentConfig.messages = messages
            }
            else {
                this.executeAfter.config.messages = messages;
            }

            // 6. Execute the requested method on the target component
            const method = withMethod?.method || "invoke";
            const params = withMethod?.params || [];

            return (this.executeAfter as any)[method](...params);
        });
    }
}



