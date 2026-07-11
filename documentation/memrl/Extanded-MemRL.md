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
        vectorDB: vectorDB,
        /** Store for Q-values. It may be backed by RavenHub. */
        qScoreDB: qScoreDB,
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

`e_MemRL` is a policy configuration. It does not replace `tools`, `skills`, or `memory` in the regular `ReActAgent` configuration. A disabled policy leaves that resource on its normal RavenADK path.

## Behaviours
E-MemRL uses one episode lifecycle for all resource types, but the candidate representation and reward policy differ for memory, skills, and tools.

### Overall
1. **Start an episode.** Create an `episodeId` and resolve the policy identifier. The identifier can be a user, session, organization, tenant, agent role, or a composition of these values. The same identifier must be used when reading and updating Q-values.
2. **Build the intent.** Use the current user request and only the task context needed to understand it. Do not embed the complete unbounded transcript by default.
3. **Handle long or multi-intent requests.** If the request is larger than the embedding model's context limit, create a bounded task summary or split the request into independent intent segments. Embed each segment, retrieve candidates for each segment, merge and de-duplicate candidates by stable candidate ID, and retain the segment that caused each match. The original request must still be available to the agent; summarization is only for retrieval.
4. **Generate the query embedding.** Call the configured `embeddingModel` once per unique intent segment. Cache the result for the duration of the episode. If embedding fails, continue with the normal RavenADK behavior and do not update Q-values for that episode.
5. **Run Phase 1: semantic recall.** Search `vectorDB` for the top-$K$ candidates for each enabled resource. Filter by resource namespace and policy identifier where supported. The vector index stores searchable descriptions; it must not be treated as the Q-value store.
6. **Run Phase 2: utility-aware selection.** Load the Q-value for every Phase 1 candidate and normalize both similarity and Q-value to the range $[0, 1]$. Rank candidates with:

   $$
   U(c \mid s) = (1 - \lambda) \cdot Similarity(c, s) + \lambda \cdot Q(c \mid identifier)
   $$

   `lambda = 0` means similarity-only retrieval and `lambda = 1` means Q-value-only retrieval. In normal operation, `lambda` should be between `0` and `1`.
7. **Explore candidates with insufficient evidence.** When exploration is enabled, add a bounded UCB1 term to the utility score:

   $$
   Selection(c \mid s) = U(c \mid s) + \gamma \sqrt{\frac{\log(N + 1)}{visits(c) + 1}}
   $$

   Here `gamma` is `explorationWeight`, `N` is the number of selections in the policy scope, and `visits(c)` is the candidate's selection count. For a flat list of memories, skills, or tools, this UCB-style re-ranking is sufficient. Full Monte-Carlo Tree Search is only needed when E-MemRL is selecting a multi-step plan.
8. **Use the selected candidates.** Inject selected memory into context, load selected skill instructions, and expose selected tools to the model. A high score is a preference, not permission: tool safety rules, HITL approval, required tools, and excluded tools always take precedence.
9. **Record the experience.** Store the intent, selected candidate IDs, similarity scores, Q-values used, actions taken, execution results, latency, errors, and final outcome. This is the Intent-Experience-Utility triplet required by MemRL.
10. **Calculate reward after an outcome is observable.** A retrieval or tool invocation alone is not proof that the candidate was useful. Prefer explicit user feedback or a validated task outcome. Self-evaluation may be used when configured, but it should be marked as an inferred reward.
11. **Update Q-values.** Update only the candidates that were actually selected or materially used. Keep updates idempotent by `episodeId` and perform them asynchronously when possible so learning does not delay the user response. A Q-value update must not rewrite memory content, skill files, tool definitions, or model weights.
12. **Isolate policies.** Q-values are keyed by at least `resourceType`, `candidateId`, and `identifier`. A tool's score must not be reused as a skill's score, and a score learned for one user or tenant must not leak into another scope unless an explicit shared scope is configured.

The minimum conceptual Q-value record is:

```typescript
type EMemRLResource = "memory" | "skill" | "tool";

interface QScoreRecord {
    resource: EMemRLResource;
    candidateId: string;
    identifier: string;
    q: number;                 // normalized value in [0, 1]
    visits: number;
    rewardTotal: number;
    lastReward?: number;
    lastEpisodeId?: string;
    updatedAt: string;
}
```

An implementation may use one physical `qScoreDB` for all resources, but it must preserve these logical namespaces. A vector document should also have a stable candidate ID, resource type, searchable text, and optional version. New candidates start with a neutral prior, normally `q = 0.5`, unless the application supplies a justified prior.

### ReAct Agent Integration

The E-MemRL lifecycle maps to the ReAct graph as follows:

1. **Before the main model call:** build the intent, retrieve memory, retrieve skills, and calculate the tool allowlist.
2. **During the model and tool loop:** keep the selected candidate IDs in episode state. `tool_invoked` records a proposed tool action; `tool_executed` records its actual result, failure, denial, and latency.
3. **After the final conclusion:** evaluate the task outcome, assign reward, and update Q-values for the candidates that contributed to the episode.

When several tools are called in parallel, record and update each tool separately. Do not assign the complete final reward to every tool automatically; use per-action success, output relevance, and contribution evidence for credit assignment.

### Memory

For memory, a candidate is a stable memory record, such as a `MemoryRecord`, a conclusion entry, or a RAG document. The candidate's searchable text should include its title, content, and keywords. The Q-value is separate from the factual content.

The memory policy works as follows:

1. Build the intent from the current request and resolve the memory scope, for example `userId`, `sessionId`, or `organizationId`.
2. Retrieve semantically similar records from the memory vector namespace.
3. Re-rank the records with similarity and the Q-value for the same identifier.
4. Add only the selected records to the model context, subject to context-size and privacy limits. A low-confidence result may be omitted rather than forced into the prompt.
5. After the task, reward a record when it materially helped produce a correct or accepted result. Useful signals include explicit user feedback, evaluator approval, successful completion, or a later correction that confirms or contradicts the memory.
6. Update the record's Q-value without changing the record's title, content, keywords, or relationships. If the factual content is wrong, use the normal memory correction or deletion path; Q-value learning alone must not conceal stale information.

Memory rewards should be scoped narrowly. A preference can be useful for one user and irrelevant for another, while a general fact may use a shared organization scope. The scope must therefore be part of the Q-score key rather than an implicit global setting.

### Skills

For skills, a candidate is a stable skill identifier, normally its skill path or canonical name, optionally combined with a skill version. The vector representation should be made from the skill name, metadata, description, supported use cases, and relevant frontmatter. Do not index every script and asset as an independent skill candidate unless the application explicitly wants that behavior.

The skill policy works as follows:

1. Embed the task intent and retrieve skill metadata candidates.
2. Re-rank candidates with semantic similarity and the skill's Q-value for the configured identifier or task scope.
3. Read the full `SKILL.md` and related files only for selected skills. Metadata retrieval remains cheap; loading every skill into the prompt defeats the purpose of the policy.
4. Allow the agent to apply the selected skill using the existing skill execution and sandbox rules.
5. Record whether the skill was read, applied, or actually executed. Reading a skill is not itself a successful outcome.
6. Reward the skill when its use improves the objective: a script completes, an artifact passes validation, the task needs fewer retries, or the user accepts the result. Penalize irrelevant detours, invalid instructions, execution failures, and user corrections.
7. Update the Q-value for the skill identifier and scope. Do not rewrite `SKILL.md` as a side effect of a Q-score update. Skill content changes should create a new version or trigger an explicit re-index operation.

A skill with a high Q-value is still subject to capability checks, sandbox restrictions, and HITL approval. E-MemRL may prefer a skill; it cannot grant the skill new permissions.

### Tools

For tools, a candidate is an executable action identified by a stable tool name and, when necessary, a version. Its vector document should include the tool description, argument schema, supported operations, and relevant domain tags. The tool Q-value should normally be scoped by task domain, agent role, tenant, or another identifier that reflects where the tool is useful.

The tool policy works as follows:

1. Embed the task intent and retrieve the tools that are semantically relevant.
2. Re-rank available tools with similarity, Q-value, and optional exploration.
3. Apply hard constraints after ranking: required tools remain available, excluded tools remain unavailable, and HITL or authorization rules cannot be bypassed.
4. Expose the resulting allowlist or preference ordering to the model. E-MemRL must never execute a tool merely because it has a high Q-value; the model or application flow must still select the action.
5. Record `tool_invoked` when the model requests a tool and `tool_executed` when execution finishes. Capture valid output, error output, denial, timeout, latency, and argument-validation failures.
6. Assign a small immediate reward for a valid execution and a larger episode reward for contributing to a successful final objective. Penalize failed execution, invalid arguments, irrelevant results, unnecessary calls, and user correction.
7. Update only the invoked or materially contributing tool candidates. If multiple tools contributed, use conservative credit assignment instead of copying the full episode reward to every tool.

The following events are not equivalent:

| Event | Meaning for learning |
| --- | --- |
| Tool retrieved | The tool looked relevant semantically; no reward yet |
| Tool exposed | The policy allowed the model to consider it; no reward yet |
| Tool invoked | The model selected it; record an action, but do not assume success |
| Tool executed | The action completed or failed; assign an immediate execution signal |
| Task completed | Use the final outcome to assign the main reward |

Tool learning must never weaken authorization, safety, sandbox, rate-limit, or HITL controls. If the policy has no candidates or its score store is unavailable, the agent should fall back to the configured normal tool set rather than silently removing all tools.

## Guarantees and Non-Goals

- E-MemRL learns retrieval and action usefulness at runtime; it does not fine-tune or modify the LLM.
- Similarity retrieval is always the first phase; Q-value and exploration affect the second phase.
- Memory, skill, and tool scores are logically separate even when they share a physical vector database or Q-score database.
- A score is evidence about usefulness in a scope, not proof of correctness, authorization, or safety.
- Feedback must be attributable to an episode and should be auditable. Inferred rewards should be distinguishable from explicit user feedback.
- If embedding, vector retrieval, Q-score retrieval, or feedback evaluation fails, E-MemRL degrades to the normal RavenADK path and avoids inventing a score update.
