import z from "zod";
import { tool, Tool } from "../tools/tools";
import { MemoryFetch, MemoryRecord } from "./stores/schema";
import { SchemaMemoryStore } from "./stores/schema";
import { randomUUID } from "node:crypto";
import { ReActAgentConfig, ReActAgentPluginSpec } from "../ReAct.agent";
import { withTelemetry, recordEventWithData } from "../../telemetry/telemetry";

/** Interface used to make the multimemory Agents - where one object can be responsible for particular thing */
export interface MutliMemoryObject {
    /** It's the memory object name */
    name: string;
    /** Description of what has to be stored in this particular `memory` object */
    purpose: string;
}

export class Memory<MemoryStore extends SchemaMemoryStore> {
    store: MemoryStore;
    multimemory?: MutliMemoryObject;

    constructor(store: MemoryStore, multimemory?: MutliMemoryObject) {
        this.store = store;
        this.multimemory = multimemory;
    }

    constructMemoryToolsPrefixFromMultimemoryName() {
        return this.multimemory?.name.split(" ").join("_").toLocaleLowerCase();
    }

    /** Creates memory object for particular memory */
    createMemorySystemPrompt() {
        const tools_prefix = this.multimemory ? `${this.constructMemoryToolsPrefixFromMultimemoryName()}_` : "";
        const memorySystemPrompt: string = [
            this.multimemory ? `### Memory System: ${this.multimemory.name}` : "### Memory System",
            `**Purpose**: ${this.multimemory?.purpose ?? "General persistence of facts and preferences."}`,
            `**Tools**: \`${tools_prefix}fetch_memory\`, \`${tools_prefix}save_memory\``,
            ``,
            `**Instructions**:`,
            `1. Before answering, consider if this task relies on facts, preferences, identity, or prior decisions.`,
            `2. Firstly check the memory "consolidated conclusion" for facts then if found explore them more with tools specified for this memory system or try to find facts when weren't specified - check for existance in this memory system or different`,
            `3. If relevant info might exist, use \`${tools_prefix}fetch_memory\` (semantic mode for keywords, explore mode for related nodes).`,
            `4. Always use stored facts instead of guessing or assuming`,
            `5. Save only **DURABLE** and **STABLE** information using \`${tools_prefix}save_memory\`.`,
            `6. **DO NOT** save transient chat noise, repeated outputs, or uncertain guesses.`,
            `7. Check for duplicates with \`${tools_prefix}fetch_memory\` before saving to prevent redundancy.`,
            `8. Use short, normalized titles and descriptive content for reused knowledge.`,
        ].filter(instructionPart => instructionPart !== undefined).join("\n");
        return memorySystemPrompt;
    }
    
    /** 
     * Use this to retrive the memory file is the conclusion of all memory the agent has and it's insert to system prompt paired with `memorySystemPrompt
     * How does the memory conclusion file work?
     *  - Read - at the begining of work agent in system prompt gets the memory conclusion file has no more than 2048 words
     *  - Write - at the end of agent progress agent gets the 
    */
    async getMemoryConclusionFile() {
        return await this.store.fetchMemoryConclusionFile();
    }

    async setMemoryConclusionFile(fileContent: string) {
        return await this.store.writeMemoryConclusionFile(fileContent);
    }

    async getMemoryConclusionFileSystemPrompt() {
        const conclusion = await this.getMemoryConclusionFile();

        // Don't include max conclusion length since it is not required to know for this stage
        return `### Memory conclusion already you've rememebered
        
#### Memory conclusion content
${conclusion || "Memory conclusion is empty - use tools to seek instead"}
        `
    }

    createMemoryTools(): Tool<any, any>[] {
        const fetchMemoryArguments = z.object({
            mode: z.enum(["semantic", "explore"]).default("semantic").describe("Says whether to fetch records by the `semantic` or `explore` all records"),
            words: z.union([z.string(), z.array(z.string())]).optional().describe("List with semantic words similarity for what we search results. Required to pass for `fetch_memory` where `mode` = 'semantic'"),
            reason: z.string().optional().describe("Reason why you use the `fetch_memory` operation")
        }).passthrough();

        const saveMemoryArguments = z.object({
            record: z.object({
                title: z.string().describe("tilte of memory record"),
                content: z.string().describe("content of memory record. E.g: Comprahensive description"),
                keywords: z.array(z.string()).default([]).describe("List with keywords describe memory record"),
                subMemoryIds: z.array(z.object({
                    id: z.string().describe("Real id of related memory subject. Use the `fetch_memory` tool to fetch the ids of available tools"),
                    strength: z.number().optional().describe("Floating point number from range 0.00 - 1.00 what describes the strength of related memory to this memory record (memory record has this `title`, `keywords` and `content`)")
                })).default([]).describe("List with unique ids of related memory subjects")
            } satisfies Record<keyof Omit<MemoryRecord, "id">, z.ZodType>),
            // Optional extra hint used to search for duplicates before saving.
            words: z.union([z.string(), z.array(z.string())]).optional()
        }).passthrough();

        const tools_prefix = this.multimemory ? `${this.constructMemoryToolsPrefixFromMultimemoryName()}_` : "";
        const memoryTools: Tool<any, any>[] = [
            tool(
                async (args) => {
                    return await withTelemetry(`${tools_prefix}fetch_memory`, { 
                        mode: args.mode,
                        memory_name: this.multimemory?.name ?? "General"
                    }, async () => {
                        const result = args.mode === "explore"
                            ? await this.store.fetchMemory(MemoryFetch.Explore)
                            : await this.store.fetchMemory({
                                by: MemoryFetch.Sematic,
                                words: this.normalizeFetchWords(args.words)
                            });

                        return this.serializeToolResult(result ?? null);
                    });
                },
                {
                    toolName: `${tools_prefix}fetch_memory`,
                    toolDescription: [
                        "Search long-term memory for relevant knowledge.",
                        "Use mode='semantic' for title/content/keyword based lookup.",
                        "Use mode='explore' to traverse connected memory nodes.",
                        "Prefer semantic lookup first, then explore if you need neighbors or follow-up context."
                    ].join(" "),
                    toolArguments: fetchMemoryArguments
                }
            ),
            tool(
                async (args) => {
                    return await withTelemetry(`${tools_prefix}save_memory`, {
                        memory_name: this.multimemory?.name ?? "General",
                        record_title: args.record.title
                    }, async () => {
                        const uinqueId = randomUUID();
                        const record = this.normalizeMemoryRecord({
                            ...args.record,
                            id: uinqueId
                        });

                        if (!record) {
                            return this.serializeToolResult({
                                saved: false,
                                reason: "Invalid memory record payload"
                            });
                        }

                        const duplicate = await this.findDuplicateRecord(record, args.words);

                        if (duplicate) {
                            return this.serializeToolResult({
                                saved: false,
                                skipped: true,
                                reason: "Matching memory already exists",
                                matchedMemory: duplicate
                            });
                        }

                        const saved = await this.store.saveMemory(record);

                        return this.serializeToolResult({
                            saved,
                            record
                        });
                    });
                },
                {
                    toolName: `${tools_prefix}save_memory`,
                    toolDescription: [
                        "Persist a new durable memory node only when it is genuinely new.",
                        "Before saving, the agent should fetch memory and compare against existing facts.",
                        "Use this tool for stable information such as user preferences, profile facts, goals, decisions, terminology, and important outcomes.",
                        "Do not save duplicates, transient chat noise, secrets, or uncertain guesses."
                    ].join(" "),
                    toolArguments: saveMemoryArguments
                }
            )
        ];

        return memoryTools;
    }

    private normalizeFetchWords(words?: string | string[]): string | string[] {
        if (words === undefined) {
            return "";
        }

        if (Array.isArray(words)) {
            return words.map(word => word.trim()).filter(Boolean);
        }

        return words.trim();
    }

    private normalizeMemoryRecord(record: MemoryRecord): MemoryRecord | null {
        const id = record.id.trim();
        const title = record.title.trim();
        const content = record.content.trim();

        if (!id || !title || !content) {
            return null;
        }

        const keywords = record.keywords
            .map(keyword => keyword.trim())
            .filter(Boolean);

        const subMemoryIds = record.subMemoryIds
            .map((relation) => ({
                id: relation.id.trim(),
                ...(typeof relation.strength === "number" ? { strength: this.clampStrength(relation.strength) } : {})
            }))
            .filter((relation) => relation.id.length > 0);

        return {
            id,
            title,
            content,
            keywords,
            subMemoryIds
        };
    }

    private async findDuplicateRecord(record: MemoryRecord, words?: string | string[]): Promise<MemoryRecord | undefined> {
        const searchWords = this.buildDuplicateSearchWords(record, words);

        if (!searchWords.length) {
            return undefined;
        }

        const existing = await this.store.fetchMemory({
            by: MemoryFetch.Sematic,
            words: searchWords
        });

        if (!existing) {
            return undefined;
        }

        const duplicate = this.findDuplicateMemory(existing, record);

        if (duplicate) {
            return duplicate;
        }

        return undefined;
    }

    private findDuplicateMemory(existing: MemoryRecord | MemoryRecord[], incoming: MemoryRecord): MemoryRecord | undefined {
        const candidates = Array.isArray(existing) ? existing : [existing];

        return candidates.find((candidate) => this.isDuplicateMemory(candidate, incoming));
    }

    private buildDuplicateSearchWords(record: MemoryRecord, words?: string | string[]): string[] {
        const seedWords = Array.isArray(words)
            ? words
            : typeof words === "string"
                ? [words]
                : [];

        return [
            ...seedWords,
            record.id,
            record.title,
            record.content,
            ...record.keywords,
            ...record.subMemoryIds.map((relation) => relation.id)
        ]
            .map((word) => word.trim())
            .filter((word) => word.length > 0);
    }

    private isDuplicateMemory(existing: MemoryRecord, incoming: MemoryRecord): boolean {
        if (existing.id === incoming.id) {
            return true;
        }

        const existingTitle = this.normalizeText(existing.title);
        const incomingTitle = this.normalizeText(incoming.title);
        const existingContent = this.normalizeText(existing.content);
        const incomingContent = this.normalizeText(incoming.content);

        if (existingTitle === incomingTitle && existingContent === incomingContent) {
            return true;
        }

        if (existingContent === incomingContent) {
            const existingKeywords = new Set(existing.keywords.map((keyword: string) => this.normalizeText(keyword)));
            const incomingKeywords = new Set(incoming.keywords.map((keyword: string) => this.normalizeText(keyword)));

            const keywordOverlap = [...incomingKeywords].filter((keyword) => existingKeywords.has(keyword)).length;
            const largestKeywordSet = Math.max(existingKeywords.size, incomingKeywords.size, 1);

            if (keywordOverlap / largestKeywordSet >= 0.5) {
                return true;
            }
        }

        if (existingTitle === incomingTitle) {
            if (
                existingContent.includes(incomingContent) ||
                incomingContent.includes(existingContent)
            ) {
                return true;
            }
        }

        return false;
    }

    private normalizeText(value: string): string {
        return value.trim().toLowerCase().replace(/\s+/g, " ");
    }

    private clampStrength(value: number): number {
        if (Number.isNaN(value)) {
            return 0;
        }

        if (value < 0) {
            return 0;
        }

        if (value > 1) {
            return 1;
        }

        return value;
    }

    private serializeToolResult(value: unknown): string {
        if (typeof value === "string") {
            return value;
        }

        try {
            return JSON.stringify(value, null, 2);
        }
        catch {
            return String(value);
        }
    }

    get api() {
        return this.store;
    }
}

// TODO: Agent has to conclude the memory only when user thinks it's necessary

/**
 * Creates a `MemoryConcludePlugin` that is the unified interface to conclude the memory as needance
 * ### Requirements:
 * - Memory interface has to be specified on ReAct agent atop of what you use this plugin
 * ```typescript
 *  new ReActAgent({
 *      memory: // (here has to be interface)
 *      ...restOfConfig
 *  })
 * ```
 * 
 * ## How Does it work
 * - Spawns another ReAct Agent with specified configuration that will decide whether is worthy to save a memory
 * - Base on transcript of conversation decides whether to overwrite/make the conclusion in the specified range of words
 * @param reactAgentConfig - is the configuration for ReAct Agent will decide whether to override the memory
 * @returns
 */
export function createMemoryConclusionPlugin(reactAgentConfig: ReActAgentConfig<any, any, any>) {
    return {
        name: "MemoryConcludePlugin",
        executionWay: "after_agent_run",
        async execute(executionFrom, agentConfig, graphState) {
            return await withTelemetry("MemoryConcludePlugin.execute", {
                agent_name: `ReAct Agent`,
                from: JSON.stringify({
                    model: executionFrom.nodeModel,
                    node: executionFrom.nodeName
                }, null, 4),
                memory_count: Array.isArray(agentConfig.memory) ? agentConfig.memory.length : 1
            }, async () => {
                if (agentConfig.memory) {
                    const { ReActAgent } = await import("../ReAct.agent");
                    
                    // Normalize memory configurations into an array of interfaces
                    const memoryInterfaces: Memory<any>[] = [];
                    if (Array.isArray(agentConfig.memory)) {
                        agentConfig.memory.forEach(m => {
                            memoryInterfaces.push(new Memory(m.memory, m));
                        });
                    } else {
                        memoryInterfaces.push(new Memory(agentConfig.memory));
                    }

                    const transcript = agentConfig.messages
                        .filter((m): m is any => m.type !== 'system')
                        .map((m: any) => {
                            if (m.type === 'user') return `User: ${m.content}`;
                            if (m.type === 'ai') return `Assistant: ${m.content || '(no text)'}`;
                            if (m.type === 'thinking') return `Thought: ${m.content}`;
                            if (m.type === 'tool') {
                                const toolName = m.tool_name || m.tool_id;
                                return `Tool Call [${toolName}]: ${m.content}${m.toolOutput ? `\nOutput: ${m.toolOutput}` : ''}${m.toolError ? `\nError: ${m.toolError}` : ''}`;
                            }
                            return '';
                        })
                        .filter(Boolean)
                        .join('\n\n');

                    let anyUpdated = false;

                    const results = await Promise.all(memoryInterfaces.map(async (memoryInterface) => {
                        const oldConclusion = await memoryInterface.getMemoryConclusionFile();
                        const memoryName = memoryInterface.multimemory?.name ?? "General";
                        const memoryPurpose = memoryInterface.multimemory?.purpose ?? "General persistence of facts.";

                        const summarySystemPrompt = [
                            `You are a specialized memory architecture conclusion agent.`,
                            `Your task is to maintain a "Consolidated Conclusion" for the "${memoryName}" memory system.`,
                            `Memory Purpose: ${memoryPurpose}`,
                            "",
                            "Rules:",
                            "1. Analyze the transcript for new, stable, and durable facts/insights relevant to this memory scope.",
                            "2. Integrate new insights into the existing conclusion.",
                            "3. Keep the output concise, structured, and under 2048 words.",
                            "4. If no significant new information is found, output the EXACT same content as the Old Conclusion.",
                            "5. Output ONLY the updated conclusion text. No chat, no explanations."
                        ].join("\n");

                        const summaryUserMessage = [
                            `### Old Conclusion for "${memoryName}":`,
                            oldConclusion || "(Empty)",
                            "",
                            `### New Interaction Transcript:`,
                            transcript,
                            "",
                            `Based on the transcript above, provide the updated consolidated conclusion for "${memoryName}".`
                        ].join("\n");

                        // Use model directly to avoid agent recursion and multi-turn overhead
                        // Explicitly pass empty tools to avoid sending the full agent toolset for a simple summary
                        const toolsFromBefore = reactAgentConfig.tools;
                        reactAgentConfig.tools = [];
                        
                        const modelResult = await reactAgentConfig.model.invoke({
                            messages: [
                                { type: "system", content: summarySystemPrompt },
                                { type: "user", content: summaryUserMessage }
                            ]
                        });

                        reactAgentConfig.tools = toolsFromBefore;

                        const newConclusion = modelResult.answer.find(m => m.type === "ai")?.content;

                        if (newConclusion && newConclusion.trim() !== "" && newConclusion.trim() !== (oldConclusion || "").trim()) {
                            await memoryInterface.setMemoryConclusionFile(newConclusion.trim());
                            recordEventWithData("memory_conclusion_updated", {
                                memory_name: memoryName,
                                length: newConclusion.length
                            });
                            return true;
                        }
                        return false;
                    }));

                    anyUpdated = results.some(r => r);

                    return {
                        status: anyUpdated
                    };
                }
                
                return {
                    status: false
                }
            });
        },
    } satisfies ReActAgentPluginSpec;
}
