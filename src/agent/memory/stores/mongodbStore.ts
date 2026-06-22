import { 
    SchemaMemoryStore, 
    SchemaMemoryConfig, 
    MemoryRecord, 
    MemoryFetchResult, 
    FetchBySemantic, 
    MemoryFetch 
} from "./schema";

interface MongoMemoryDocument {
    type: "record" | "conclusion";
    id?: string;
    content?: string;
    data?: MemoryRecord;
    session: string;
}

interface MongoFindCursor<T> {
    toArray(): Promise<T[]>;
}

interface MongoMemoryCollection {
    find(query: Record<string, unknown>): { toArray(): Promise<MongoMemoryDocument[]> };
    findOne(query: Record<string, unknown>): Promise<MongoMemoryDocument | null>;
    insertOne(document: MongoMemoryDocument): Promise<unknown>;
    updateOne(
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options?: { upsert?: boolean }
    ): Promise<unknown>;
}

export interface MemoryMongoDBStoreConfig extends SchemaMemoryConfig {
    collection: MongoMemoryCollection;
}

export class MemoryMongoDBStore implements SchemaMemoryStore {
    config: MemoryMongoDBStoreConfig;

    constructor(config: MemoryMongoDBStoreConfig) {
        this.config = config;
    }

    async fetchMemoryConclusionFile(): Promise<string> {
        try {
            const session = this.resolveSession();
            const doc = await this.config.collection.findOne({ 
                type: "conclusion", 
                session 
            });
            return doc?.content ?? "";
        } catch {
            return "";
        }
    }

    async writeMemoryConclusionFile(fileContent: string): Promise<boolean> {
        const maxCharacters = this.config.conclusion?.maxCharacters;

        if (maxCharacters !== undefined && fileContent.length > maxCharacters) {
            return false;
        }

        try {
            const session = this.resolveSession();
            await this.config.collection.updateOne(
                { type: "conclusion", session },
                { $set: { content: fileContent } },
                { upsert: true }
            );
            return true;
        } catch {
            return false;
        }
    }

    async fetchMemory(fetchBy: FetchBySemantic | MemoryFetch.Explore): Promise<MemoryFetchResult> {
        try {
            const session = this.resolveSession();
            const query: Record<string, any> = { type: "record", session };

            if (fetchBy === MemoryFetch.Explore) {
                const docs = await this.config.collection.find(query).toArray();
                return docs.length > 0 ? docs[0].data : undefined;
            }

            // Simple semantic search implementation (regex-based for keywords)
            const words = Array.isArray(fetchBy.words) ? fetchBy.words : [fetchBy.words];
            const docs = await this.config.collection.find(query).toArray();
            
            const scored = docs.map(doc => {
                const record = doc.data!;
                let score = 0;
                const searchStr = `${record.title} ${record.content} ${record.keywords.join(" ")}`.toLowerCase();
                words.forEach(word => {
                    if (searchStr.includes(word.toLowerCase())) {
                        score++;
                    }
                });
                return { record, score };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);

            return scored.map(item => item.record);
        } catch {
            return undefined;
        }
    }

    async saveMemory(record: MemoryRecord): Promise<boolean> {
        try {
            const session = this.resolveSession();
            await this.config.collection.updateOne(
                { type: "record", "data.id": record.id, session },
                { $set: { data: record, id: record.id } },
                { upsert: true }
            );
            return true;
        } catch {
            return false;
        }
    }

    private resolveSession(): string {
        return this.config.session?.trim() || "default";
    }
}
