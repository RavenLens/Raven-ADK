# Custom Memory

Custom memory is your own implementation of the memory layer. It can use any storage backend, apply custom retrieval or ranking, and connect to external services such as RavenAgentsHubDB.

## Type
Any — you decide what kind of memory the system represents.

## Description
By implementing `SchemaMemoryStore`, you have full control over how records are fetched, saved, and concluded. This is useful when the built-in stores do not match your infrastructure or when you need domain-specific preprocessing, anonymization, or ranking.

## Requirements
- Implement the `SchemaMemoryStore` interface from `@ravenlens/raven-adk/memory/store`.
- Provide implementations for:
  - `fetchMemory`
  - `saveMemory`
  - `fetchMemoryConclusionFile`
  - `writeMemoryConclusionFile`
- Decide your own duplicate detection, ranking, session scoping, and preprocessing rules.

## Usecases
- Connecting to an existing corporate knowledge base or vector database.
- Applying BM25, full-text search, or hybrid ranking.
- Running a summarization or anonymization agent before storing memory.
- Storing memory in RavenAgentsHubDB or any other external service.

## Code Example

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import {
  SchemaMemoryStore,
  SchemaMemoryConfig,
  MemoryRecord,
  MemoryFetchResult,
  FetchBySemantic,
  MemoryFetch
} from "@ravenlens/raven-adk/memory/store";

export class MyCustomMemoryStore implements SchemaMemoryStore {
  config: SchemaMemoryConfig;

  constructor(config: SchemaMemoryConfig) {
    this.config = config;
  }

  async fetchMemoryConclusionFile(): Promise<string> {
    // Fetch the conclusion from your backend
    return "";
  }

  async writeMemoryConclusionFile(fileContent: string): Promise<boolean> {
    const maxCharacters = this.config.conclusion?.maxCharacters;
    if (maxCharacters !== undefined && fileContent.length > maxCharacters) {
      return false;
    }
    // Persist the conclusion
    return true;
  }

  async fetchMemory(fetchBy: FetchBySemantic | MemoryFetch.Explore): Promise<MemoryFetchResult> {
    if (typeof fetchBy !== "number" && fetchBy.by === MemoryFetch.Sematic) {
      // Your semantic / keyword retrieval logic
    } else {
      // Your graph exploration logic
    }
    return undefined;
  }

  async saveMemory(record: MemoryRecord): Promise<boolean> {
    // Your persistence logic
    return true;
  }
}

const agent = new ReActAgent({
  model: /* your model */,
  systemPrompt: "You use a custom knowledge base.",
  messages: [{ type: "user", content: "Find the policy" }],
  tools: [],
  memory: new MyCustomMemoryStore({
    hasToRemember: "Company policies and procedures",
    session: "org-123"
  })
});
```

## Combining with other systems

Custom memory can be used together with built-in stores in a plural memory configuration:

```typescript
memory: [
  {
    memory: new MyCustomMemoryStore({
      hasToRemember: "Company policies",
      session: "org-123"
    }),
    name: "Company Wiki",
    purpose: "Custom retrieval over internal knowledge base."
  },
  {
    memory: new MemoryChromaDBStore({
      hasToRemember: "* User preferences",
      session: "user-123"
    }),
    name: "User Facts",
    purpose: "Standard factual memory."
  }
]
```

## Further Reading
- [SchemaMemoryStore source](../../../../src/agent/memory/stores/schema.ts)
- [Memory systems overview](../README.md)
- [Main Memory documentation](../../Memory.md)
