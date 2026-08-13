/* TODO: Finish the specification & Make the schema memory for the coding agent according to the specification */

import { DeterministicMemoryConfig, DeterministicMemorySchema } from "../schema/deterministicMemorySchema";

export interface CodeMemoryConfig<StoredMemory = unknown>  extends DeterministicMemoryConfig<StoredMemory> {
    
}

export class CodeMemory<StoredMemory = unknown> implements DeterministicMemorySchema {
    typeMemory: "deterministic" = "deterministic";
    config: CodeMemoryConfig<StoredMemory>;

    constructor(config: CodeMemoryConfig<StoredMemory>) {
        this.config = config;
    }
}

