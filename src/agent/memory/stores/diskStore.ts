import fs from "node:fs";
import path from "node:path";
import { 
    SchemaMemoryStore, 
    SchemaMemoryConfig, 
    MemoryRecord, 
    MemoryFetchResult, 
    FetchBySemantic, 
    MemoryFetch 
} from "./schema";

export interface MemoryDiskStoreConfig extends SchemaMemoryConfig {
    /** Root directory for storing memory files. Defaults to 'memory' */
    rootDir?: string;
}

export class MemoryDiskStore implements SchemaMemoryStore {
    config: MemoryDiskStoreConfig;
    private rootDir: string;

    constructor(config: MemoryDiskStoreConfig) {
        this.config = config;
        this.rootDir = config.rootDir ?? path.join(process.cwd(), "memory");
        
        if (!fs.existsSync(this.rootDir)) {
            fs.mkdirSync(this.rootDir, { recursive: true });
        }
    }

    async fetchMemoryConclusionFile(): Promise<string> {
        const filePath = this.resolveConclusionFilePath();
        try {
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, "utf-8");
            }
        } catch {
            // Ignore errors
        }
        return "";
    }

    async writeMemoryConclusionFile(fileContent: string): Promise<boolean> {
        const maxCharacters = this.config.conclusion?.maxCharacters;

        if (maxCharacters !== undefined && fileContent.length > maxCharacters) {
            return false;
        }

        const filePath = this.resolveConclusionFilePath();
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, fileContent, "utf-8");
            return true;
        } catch {
            return false;
        }
    }

    async fetchMemory(fetchBy: FetchBySemantic | MemoryFetch.Explore): Promise<MemoryFetchResult> {
        // Basic disk-based memory search (simple implementation for now)
        try {
            const sessionDir = this.resolveSessionDir();
            if (!fs.existsSync(sessionDir)) {
                return undefined;
            }

            const files = fs.readdirSync(sessionDir)
                .filter(file => file.endsWith(".json") && file !== "conclusion.txt");
            
            const records: MemoryRecord[] = files.map(file => {
                const content = fs.readFileSync(path.join(sessionDir, file), "utf-8");
                return JSON.parse(content) as MemoryRecord;
            });

            if (fetchBy === MemoryFetch.Explore) {
                return records.length > 0 ? records[0] : undefined;
            }

            const words = Array.isArray(fetchBy.words) ? fetchBy.words : [fetchBy.words];
            const scored = records.map(record => {
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
            const sessionDir = this.resolveSessionDir();
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }

            const filePath = path.join(sessionDir, `${record.id}.json`);
            fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
            return true;
        } catch {
            return false;
        }
    }

    private resolveSessionDir(): string {
        const session = this.config.session?.trim() || "default";
        return path.join(this.rootDir, session);
    }

    private resolveConclusionFilePath(): string {
        return path.join(this.resolveSessionDir(), "conclusion.txt");
    }
}
