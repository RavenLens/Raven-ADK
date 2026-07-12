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
[Simple Overview](https://excalidraw.com/#json=O3_6EqoyVWfkTafCiiVib,_-lIv3s_8wQzNsQuZebEmQ)

### Concepts
> We can attach the `episodeId` or keep it as `null` to explore all episodes without aggregating it to the collection
1. Each E-MemRL has configuration parameter is the `episodeId` the id of intents of user or some entity stored in vector database in in **Q-traces** store
2. User query -> [to] -> Intent generation
Problem: Because some models have limitations like 512 tokens or 8192 tokens we cannot paste the direct user query to the database<br>
Solution:

### Flow
1. We use some specified `Gate Keeper` model to make the summary of user ask if it **goes beyond the tokens limitation** of our model or **always** (base on config)
    - This resolves the problem with `Embedding Model` limitation of entry tokens
2. We paste this ask as the ***query*** to the Specified **VectorDB** to the `index` (in VectorDB world it's other name for NoSQL collection or SQL table) is made with usage of `episodeId` to seek for `Top-K` candidates according to the **similarity-score** (keep in mind to choose the similarity-metric matches to your task and vector nomrmalization or its lack)
    - **VectorDB** holds the user query
3. Handling the VectorDB response:
    - Database returns the specified `Top-K` of request candidates or nothing where no candidate was found for query
    - Each of retrived document has the *metadata* stores the `ID` of the **Q-Database** record
4. We use the specified `ID` of VectorDB record/s to find the answer/s in **Q-Database**. Where Q-Databse stores
    - Overall trace feedback score
    - **Optional:** Separate scores as optional for (each of this score represents usefullness of specified element in answering the query):
        - tools
        - memory
        - skills
5. We melt the **Retrived Similarity Search** with **Q-score** for each record of action and usefulness rate by leveraging on of following techniques
    - Adding them together and using highter score
    - Base on the Q-Score we make the decision - because Q-Score is the most important and valid metric in E-MemRL and MemRL
6. We paste to Agent the best or the `Top-K` melted candidates or `all candidates` are the [`QScoreTrace`](./Extanded-MemRL.md#trace-object) and the user query lead to the composition of the basic query (base on computation)
    - This serves as the **cheat-sheet** for the agent about what tool, memory and document to choose when asnwering to task base on previous score
    - Agent chooses the best **candiate** of them all base on the given task and the user query similarities to our query + Q-Score (where Q-Score is the most important)
        - Agent is informed about the meaning of the `Q-Score` and each field via the system prompt description along `ZOD Schema`
        - Agent chooses by him own (as default) because we cannot assure in advance the something with Score-Q will be more valid for out task (LLM the ReAct agent use will assest it better base on its frozen weights and its linear-algebra math)
7. Agent uses the specified trace base on that Agent generates the outcome and gives back as response
- **Idea:** E-MemRL strategy - user can specify the strategy how much user want to use already existsing trace and how much is about to explore new - uses same formula as [ToT (Tree-of-Thoughts) MCTS](../chains/Tree-of-Thoughts%20(ToT).md) that is `explorationConstant`
    - `explorationConstant (C)`:
        - Higher values (> 1.41) favor exploration (trying new, unvisited traces).
        - Lower values (< 1.41) favor exploitation (focusing on traces that already have high scores).
    - Response has exposed the trace (list) with its identifier is `traceId` with used `tools`, `skills` and `memory` along their **actual score** for specified `episodeId`
        - The `traceId` can be the trace to new id or already pasted id base on the selected E-MemRL strategy
8. You use the one of the method to give the feedback to the trace or make new trace with user inquiry the `Q-Score` for `full trace` and for specified `tool`, `memory` and `skill` - this closes the loop by modifying the Q-Score for record with [Selected Q-Score Updation Formula](./Extanded-MemRL.md#formula-for-updation)
    - Feedback 

#### Trace object
It's the object where is stored the feedback and subtraces from agent execution it's read from the memrl class <!-- TODO: Add the specification for the class -->

- Trace object referes to the steps the agent has took to compose the answer

```typescript
import { MemoryStorageSchema } from "@ravenlens/raven-adk/memory";

interface QScoreTrace {
    traceId: string;
    generatedTimestamp: number;
    recentUpdateTimestamp: number;
    qScore: number;
    tools: { 
        toolsList: {
            tool_name: string;
            qScore?: number;
        }[];
        qScore: number; 
    };
    skills: {
        skillsList: {
            /** Otherwise it's the skill `fileName` from the `SkillFileEntry` interface */
            skillName: SkillFileEntry["fileName"];
            type: SkillFileEntry["type"];
            location: string;
            /** Optional rating for specified skill */
            qScore?: number;
        }[];
        /** It's the optional ranking for all used skills */
        qScore?: number;
    };
    memory: {
        /** (Optional) It's the individual score used for the all used memory by the agent - registered by usage of tools to get the memory */
        qScore?: number;
        memory: { 
            /** It's the name attached to the memory object has multiple memory */
            name: "memory name";
            /** It's the name of the database was used to carry the memory */
            dbStorageName: "ChromaDB",
            memory: MemoryStorageSchema.MemoryFetchResult
        }[];
    };
    /** Agent response from moment the trace was generated with `commit` method */
    rootResponse: string;
    /** List with subtraces - when feedback method is applied the new trace is attached with qScore given there */
    subTraces?: Omit<QScoreTrace, "qScore"> & {
        qScoreBefore: number;
        /** Q-score after apply the measurement */
        qScoreAfter: number;
        /** Is the user query from usage of this feedback point */
        userQuery: string;
        /** Agent response from moment subtrace was generated */
        response: string;
    }[];
}
```

- This `QScoreTrace` object is parsed and pasted to the ReAct Agent __along the basic user intent (query)__ stored in the **VectorDB** that chooses whether to use it for generating outcome
- Optional Q-Scores for entries serves as the kind of hookpoint for agent in choosing the one trajectory to specificly follow

#### Methods:
- Check is the trace new - when agent has decided to generate new trace
    - `trace.isNew()` - checks whether is the trace new one. `true` when trace is new or `false` when trace was established before. When `false` is the result it means the agent didn't choose to use the best trace to generate the outcome
- User feedback methods - user gives the feedback for full trace or method
    - `trace.feedback(0.8)` - measures full trace and applies the given Q-score to trace. For new trace it's used as the finish **Q-Score**. For new traces it's insert to the [E-MemRL updation formula](./Extanded-MemRL.md#formula-for-updation)
    - `trace.tools.get("tool_name").feedback(0.4)` - updates the measurement for specified tool usage in this trace
    `trace.tools.feedback(0.5)` - updates the Q-score for overall tools usage
    - `trace.memory.feedback(0.9)` - updates the Q-score for the full memory usage in that trace. Currently updation of specific memory record isn't possible
    - `trace.skills.feedback(0.8)` - updates the Q-score for each used skill
    - `trace.skills.get("skill_id").feedback(0.4)` - updates the Q-score for the specified skill
        - `skill_id` - it's the **skill name** or **path**
    - `trace.commit()` - it's used to apply the all feedback changes to the existsing `traceId`. It adds the subtrace to the QScore trace
        - `commit()` on new trace (`isNew()`) results in making this trace and has same result as `commitNew()` method
    - `trace.commitNew()` - it's used to commit the new trace with new `traceId` out of the action user has picked up. After using it:
        - User intent will land in VectorDB for `episodeId` index with `ID` of **Q-Database**
        - The `QScoreTrace` is combined in the score
        - `commitNew()` on new trace (`isNew()`) results in making this trace and has same result as `commit()` method
- Automatical feedback method - uses another agent to measure the trace and give the feedback score and to automatically update the Q-score for trace and for tools 
    - `trace.selfEvaluate(runner)` - scores the full trace with usage of the evaluator - it gives the full-trace feedback and 
        - parameter `runner` - it's the `ReActAgent` that is given to evaluate the trace and score the point **base on the result of the task** (it's to get the score)


#### Formula for updation
E-MemRL leverages the **Retrival-Policy** is used to update the Q-Score for choosing the next actions according to the best score. The retrival policy math formula can be **TDE (Temporal Difference Error)** or **Monte Carlo style rule**

* **TDE (Temporal Difference Error)** - Formula:<br>
$Q(s, m) ← Q(s, m) +α[r +γ max Q(s
′
, m′
)−Q(s, m)]$

* **MCSR (Monte Carlo Style Rule)** - Formula:<br>
$Qnew ← Qold + α(r − Qold)$

#### TODO:
1. Make the events able to be listened by multiple listeners with same logic for Graph and the ReActAgent - in order to register the `QScoreTrace`
2. Define the MemRL configuration object that has to have:
    - Choosen formula for updation the Q-Score
    - Vector database - e.g: as object or pre-prepared class with configuration has to have specified measurement-metric and more. It'll store the documents in the selected `episodeId` or in the `rootMemrRL` (**root one**)
    - Q-Database - is the database will store the Q-Scores for fetched similiar query document

#### Pinups
- You can but don't have to give the feedback
- Feedback scoring
    - Trace feedback - is the most important scoring point. The scoring for the `tool`, `memory` and `skill` acts as the helper and cannot be given if no trace feedback is given. If you would try to `commit()` or `commitNew()` the `tool`, `skill` or `memory` feedback without adding the trace feedback (`trace.feedback(0.5)`) it'll return the error by `throw new Error` and memrl `.onEvent` handler
    - Feedback for each of unit has to be given in `0.0 - 1.0` floating point number range
    - `tool`, `skill` and `memory` `.feedback()` acts like a helper for agent to know what tool for such action is the best to use
- Giving feedback for existsing method will add the new trace to the subtraces with attached the 
- Lack of feedback for the new trace will not save the trace with its Q-Scores to the database
- Lack of feedback for already saved trace won't update the score of used trace
- You can feedback the full-trace or particular tool, memory or skill

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
