export interface MemoryDefault {
    name: string;
    /** Describes what memory has to save */
    purpose: string;
    /** Additional instruction can be passed to provide agent information about harness where it moves */
    systemPrompt?: string;
    /** What the agent must remember in this system */
    hasToRemember?: string;
}
