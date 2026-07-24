import { SchemaMemoryConfig, SchemaMemoryStore } from "./stores/schema";

export interface MemRLConfig<Store extends SchemaMemoryStore> {
    store: Store;
}

export class MemRL<Store extends SchemaMemoryStore = SchemaMemoryStore> {
    config: MemRLConfig<Store>;

    constructor(config: MemRLConfig<Store>) {
        this.config = config;
    }
}
