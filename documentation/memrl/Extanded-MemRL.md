# E-MemRL (Extended MemRL)
RavenADK extends **MemRL** to learn the usefulness of a specific tool, skill, or memory item for a specific task and identifier. The learned value is kept in the retrieval policy and does not change the frozen LLM weights.

> To understand the base technique, check the [MemRL document](./MemRL.md).

<!-- 
TODO:
### Progress Path
1. Define MemRL for memory in unified way - MemRL has to wrap the RAG Database and 2nd database for storing the Q-scores where the RAG Database can be used for it
    - Q-Scores have to be able to be stored for specific user identififier or specific idnetifier
2. Define MemRL for skills in unified way wraps the basic skills store and its schema
    - Q-Scores have to be associated with skill name for the specific skill name for the specified identifier
    > Specified identifier has to be user in MemRL store as trait in unified format for either skills and MemRL
3. Define the MemRL to use the tools according to usefullness score
4. Define the RavenHub database implement the Q-Scores MemRL for memory and skills in cloud out of the box
 -->

## Work Behaviour
[Showcase](https://excalidraw.com/#json=O3_6EqoyVWfkTafCiiVib,_-lIv3s_8wQzNsQuZebEmQ)

## Support
RavenADK E-MemRL as default support these patterns of RavenADK:

### ReAct Agent
1. Specify MemRL configuration object
```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { OpenAI } from "@ravenlens/raven-adk";

const reactAgent = new ReActAgent({
    model: new OpenAI({
        model: "gpt-5.6-sol",
        apiKey: "your-api-key",
    }),
    /// ... Rest of config with tools, skills, memory and more
    e_MemRL: {
        /** Candidate index. It may be one namespaced DB or separate DBs. */
        episodeId: "test-episode-id",
        db: , // Database to store the Q-Scores, The best tools, memories and skill traces - use special memrl wrapper and its schema for the database
        /** Model used to convert the task intent into an embedding. */
        embeddingModel: new OpenAI.OpenAIEmbedding({
            model: "text-embedding-3-large",
            apiKey: "your-key"
        }),
        /** Enabled policies. Each resource has its own candidate namespace. */
        tools: true,
        skills: true,
        memory: true,
        /** Defaults are implementation-defined when omitted. */
        topK: 8,
        lambda: 0.5,
        explorationWeight: 0.1
    }
})
```
