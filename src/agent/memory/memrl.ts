import { SchemaMemoryConfig, SchemaMemoryStore } from "./stores/schema";

export interface MemRLConfig<Store extends SchemaMemoryStore> {
    store: Store;
}

export class MemRL {
    config: MemRLConfig;

    constructor(config: MemRLConfig) {
        this.config = config;
    }
}
