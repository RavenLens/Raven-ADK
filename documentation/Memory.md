# Memory
Memory in RavenADK agents provide you way to remember data from interactions with user and get them recalled in next iterations what makes vivid user interactions. Such informations can be manipulated via Memory: 
    - user name
    - user preferrences
    - user given task
    - user conversation style schema - it can be 
Finally you've full agency to decide what agent has to remember, what should so you decide the agent behaviour

## Configuring memory for ReAct Agent
1. Singular Memory Object - use when you want to store memory in one consolidated source
```typescript
    import { ReActAgent } from "@ravenlens/raven-adk/agents";
    import { tool } from "@ravenlens/raven-adk/tools";
    import { SkillMongoDBStore, SkillDiskStore } from "@ravenlens/raven-adk/skills/store";
    import { MemoryChromaDBStore } from "@ravenlens/raven-adk/memory/store";

    const reactAgent = new ReActAgent({
        systemPrompt: `Your system prompt`,
        messages: [
            {
                type: "user",
                content: "Check the weather condition"
            }
        ],
        // ...Rest of config
        // Optional agent memory -> use to remember and read the information
        memory: new MemoryChromaDBStore({
            // Optional: Don't specify if you'd like to use the default connection is on address `127.0.0.1:8000`
            chromaDBConfig: {
                host: "your-chromadb-address",
                port: 8000
            },
            hasToRemember: [
                "* User name",
                "* User subjects of interest: e.g: Ferrari Cars, Apple devices"
            ].join('\n'),
            session: 'your-session-id',
        }),
    });

    // ... Rest of agent logic
```

2. Plural memory - use when you want to store specific informations at specific places

```typescript
    import { ReActAgent } from "@ravenlens/raven-adk/agents";
    import { tool } from "@ravenlens/raven-adk/tools";
    import { SkillMongoDBStore, SkillDiskStore } from "@ravenlens/raven-adk/skills/store";
    import { MemoryChromaDBStore, MemoryMongoDBStore,  } from "@ravenlens/raven-adk/memory/store";

    const reactAgent = new ReActAgent({
        systemPrompt: `Your system prompt`,
        messages: [
            {
                type: "user",
                content: "Check the weather condition"
            }
        ],
        // ...Rest of config
        // Optional agent memory -> use to remember and read the information
        memory: [
            {
                memory: new MemoryChromaDBStore({
                    // Optional: Don't specify if you'd like to use the default connection is on address `127.0.0.1:8000`
                    chromaDBConfig: {
                        host: "your-chromadb-address",
                        port: 8000
                    },
                    hasToRemember: [
                        "* User name",
                        "* User subjects of interest: e.g: Ferrari Cars, Apple devices"
                    ].join('\n'),
                    session: 'your-session-id',
                }),
                name: "User Preferences",
                purpose: "Save user preferences",
            },
            {
                memory: new MemoryMongoDBStore({ /* config */ }),
                name: "User details",
                purpose: "Store details about the user like: his name, where was born and all he explicitly unvails. Like he's writing letter to his girlfriend"
            }
        ]
    );

    // ... Rest of agent logic
```

> - Name `name` of memory object should be with whitespace -> this is to adjust fetch and save tools for this action and properly show memory system to agent in its instructions
> - Beware that more plural memory systems you add more bloated context window of LLM will be additionally it'll load more tokens - **it adds modularization buy with additional tiny cost**
> - If operation takes to mych time use the `parallelTools: true` in ReAct Agent config

#### In Plural Memory you can
- Define multiple memory stores for different data like: user preferences, company data/projects and others
- Sepearate entities like: company from user and/or separate his projects


## Controlling what agent can remember
Pass to agent config object `memory.hasToRememeber` output with output value will be string. This has to be list with specification for agent according with what has it to rememeber

## Memory model
This subsection describe how the agent memory work.

> RavenADK memory is graph of knowledge with mutual relations assigned as edges where nodes are the wards of knowledge e.g: user prefferences like birthday, user friends, user used programs and so on. Each information is connected to another communication with weight. RavenADK memory system base too on the weight system where the more relevant informations gets higher weight and less vibrant lower weight

#### Memory details
- Memory is fetched with these techniques:
    - semantically (base on semantic search) or according to relevance
    - by exploration like the tower - agent can explore the knowledge by going through it like you go from one city stree to another
- You can disable memory if you don't want to use it

## Memory Conclusion System
The memory conclusion is a built-in system to `ReActAgent` provides a high-level awareness for the agent. Instead of always performing deep semantic searches for every turn, the agent is provided with a "conclusion" of its entire long-term memory at the start of each session.

- **Awareness:** It gives the agent an immediate summary of who the user is, their core preferences, and the state of ongoing goals.
- **Wiser Exploration:** With the conclusion in the system prompt, the agent can decide more intelligently when it needs to use `fetch_memory` to dive deeper into specific knowledge nodes.
- **Token Efficiency & Accuracy:** By having the most relevant facts upfront in a condensed form (max 2048 words), the agent avoids redundant tool calls and reduces token usage while maintaining high accuracy in its interactions.
- **Interoperability**: Conclusion will be rememebred for either singlular and plural for memory each separatelly

## Advanced: Memory Conclusion Plugin
To maintain the memory conclusion automatically, you should use the `MemoryConcludePlugin` via `createMemoryConclusionPlugin`. This plugin runs after each agent session and evaluates whether the new interaction contains durable information that should be integrated into the long-term conclusion.

### How it works
The plugin spawns a separate internal "conclude agent" after the main agent finishes its run. This internal agent:
1. Analyzes the full transcript of the interaction.
2. Compares new findings with the existing memory conclusion.
3. Consolidates everything into an updated summary.
4. Updates the underlying memory store with the new conclusion if changes were made.

### Usage
```typescript
import { createMemoryConclusionPlugin } from "@ravenlens/raven-adk/memory";
import { openai } from "@ravenlens/raven-adk/models";

const memoryConcludePlugin = createMemoryConclusionPlugin({
    model: new OpenAI({ model: "gpt-5.5-nano" }),
    systemPrompt: "You are an expert at identifying user preferences and facts."
});

const agent = new ReActAgent({
    // ... other config
    memory: myMemoryStore,
    plugins: [memoryConcludePlugin]
});
```

> Beware that usage of Plugin triggers the another LLM infference loop that produces costs and increments time occupation for task to be done. Nevertheless results of its usage are times better than without

### Built-In Stores
- ChromaDB store: [`MemoryChromaDBStore`](../src/agent/memory/stores/chromadb.ts)
- Disk store: [`MemoryDiskStore`](../src/agent/memory/stores/diskStore.ts)
- MongoDB store: [`MemoryMongoDBStore`](../src/agent/memory/stores/mongodbStore.ts)

## Creating custom memory store
You can build your own memory store by implementing the `SchemaMemoryStore` interface. This allows you to use any database or storage system of your choice (e.g., PostgreSQL with pgvector, Pinecone, or even a simple file-based system).

```typescript
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

    /**
     * Fetches the conclusion file 
     */
    async fetchMemoryConclusionFile(): Promise<string> {
        // Implement logic to fetch the conclusion file
        return "";
    }

    /**
     * Writes the action conlusion at the end of prompt
     * @param fileContent 
     */
    async writeMemoryConclusionFile(fileContent: string): Promise<boolean> {
        const maxCharacters = this.config.conclusion?.maxCharacters;

        if (maxCharacters !== undefined && fileContent.length > maxCharacters) {
            return false;
        }

        // Implement logic to save the conclusion file
        return true;
    }

    /**
     * Fetches the memory from your database.
     * @param fetchBy - The fetch configuration (Semantic or Explore).
     */
    async fetchMemory(fetchBy: FetchBySemantic | MemoryFetch.Explore): Promise<MemoryFetchResult> {
        if (typeof fetchBy !== "number" && fetchBy.by === MemoryFetch.Sematic) {
            console.log("Fetching semantically using keywords:", fetchBy.words);
            // Implement your semantic search logic here
        } else {
            console.log("Exploring knowledge graph...");
            // Implement your exploration logic here
        }
        
        return undefined; // Return MemoryRecord | MemoryRecord[] | undefined
    }

    /**
     * Saves a memory record to your database.
     * @param record - The memory record to save.
     */
    async saveMemory(record: MemoryRecord): Promise<boolean> {
        console.log("Saving memory record:", record.title);
        // Implement your save logic here
        return true;
    }
}
```
    }
}
```

To use your custom store, simply pass it to the `ReActAgent` configuration:

```typescript
const reactAgent = new ReActAgent({
    // ... other config
    memory: new MyCustomMemoryStore({
        hasToRemember: "User name and preferences",
        session: "user-123"
    })
});
```

### Built-In Skill Stores (Reference)
- Local disk store: [`SkillDiskStore`](../src/agent/skills/stores/diskStore.ts)
- MongoDB store: [`SkillMongoDBStore`](../src/agent/skills/stores/mongodbStore.ts)

You can also build custom skill stores by implementing [`SchemaSkillStore`](../src/agent/skills/stores/schema.ts).
