# MemRL - Episodic Memory with Runtime Reinforcement Learning

**Paper:** [MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory](https://arxiv.org/pdf/2601.03192)

MemRL helps a `ReActAgent` choose among similar past experiences by learning
which ones produced good outcomes. It does not fine-tune the LLM. Instead, it
stores a Q-score for each retrieved resource and updates that score from user
or evaluator feedback.

## What MemRL Stores

MemRL has two responsibilities:

1. Your VectorDB or RAG system finds semantically similar candidate memories.
2. MemRL filters and re-ranks those candidates with their learned Q-scores.

Each learned score is scoped by this logical key:

```text
scope + resourceType + resourceId
```

Use `episodeId` as the default `scope`. It should identify the user, tenant,
session, workspace, or another entity whose learning must remain isolated.

> `episodeId` isolates MemRL Q-scores. It does not automatically filter the
> VectorDB. Your semantic query must apply the same trusted identity filter.

## Before You Start

You need:

- A semantic search implementation that can filter records by trusted identity
  metadata such as tenant, user, and session.
- A feedback signal from a user, evaluator, or application outcome. Rewards are
  numbers from `0` (failure) through `1` (success).
- Database-backed `scoreStore` and `traceStore` implementations when Q-scores
  must survive process restarts. The built-in stores are process-local only.

## Choose the Episode Scope

Choose a scope before creating MemRL. The scope determines which Q-scores are
read and updated.

| Desired learning boundary | Example `episodeId` |
| --- | --- |
| One user across all sessions | `tenant:acme:user:user-42` |
| One user in one session | `tenant:acme:user:user-42:session:chat-19` |
| One workspace shared by a team | `tenant:acme:workspace:payments` |

The following example keeps both semantic records and Q-scores isolated to one
user session:

```typescript
const tenantId = "acme";
const userId = "user-42";
const sessionId = "chat-19";

const episodeId = `tenant:${tenantId}:user:${userId}:session:${sessionId}`;
```

Use the same `episodeId` for later requests from the same learning boundary.
Use a different value for a different user, session, or workspace.

## Step-by-Step ReActAgent Integration

The current `ReActAgent` does not automatically invoke MemRL's deterministic
memory hooks. Use the explicit bridge below around each agent run. This makes
the data flow and identity boundary visible in your application.

### 1. Fetch Semantic Candidates for the User

The VectorDB query is your authorization boundary. Filter it with server-side
identity values, not values supplied directly by an untrusted client. Store the
same identifiers as metadata when memories are written.

```typescript
import type { MemRLCandidate } from "@ravenlens/raven-adk/memory";

type UserScopedVectorStore = {
  search(input: {
    query: string;
    filter: {
      tenantId: string;
      userId: string;
      sessionId: string;
      episodeId: string;
    };
    topK: number;
    similarityThreshold: number;
  }): Promise<Array<{
    id: string;
    similarity: number;
    content: string;
  }>>;
};

// Provide an adapter for ChromaDB, Pinecone, or your own vector database.
declare const vectorStore: UserScopedVectorStore;

async function fetchCandidatesForUser(
  vectorStore: UserScopedVectorStore,
  query: string,
  identity: { tenantId: string; userId: string; sessionId: string; episodeId: string }
): Promise<MemRLCandidate[]> {
  const matches = await vectorStore.search({
    query,
    filter: identity,
    topK: 8,
    similarityThreshold: 0.8
  });

  return matches.map((match) => ({
    resourceId: match.id,
    resourceType: "memory",
    // MemRL expects normalized similarity in the inclusive range [0, 1].
    similarity: match.similarity,
    content: match.content,
    metadata: identity
  }));
}
```

If your VectorDB returns a distance or another non-normalized metric, convert
it to a valid similarity score before passing it to MemRL, or configure
`normalizeSimilarity` with the correct conversion for that backend.

### 2. Create a User-Scoped MemRL Instance

Set `episodeId` to the scope chosen above. MemRL uses it to read and update the
same user's Q-scores on every request.

```typescript
import { MemRL } from "@ravenlens/raven-adk/memory";

const memrl = new MemRL({
  name: "User deployment episodes",
  purpose: "Learn which deployment strategies work for this user session.",
  episodeId,
  topK: 8,
  similarityThreshold: 0.8,
  utilityWeight: 0.7,
  learningRate: 0.2,
  // Add persistent implementations in production:
  // scoreStore: yourScoreStore,
  // traceStore: yourTraceStore
});
```

`retrieve()` first admits only the semantic top-K records whose normalized
similarity is greater than or equal to `similarityThreshold`. It then computes:

$$
utility = (1 - utilityWeight) \cdot similarity + utilityWeight \cdot qScore
$$

The candidate with the highest utility is ranked first. A new resource starts
with `initialQScore`, which defaults to `0.5`.

### 3. Retrieve Q-Scored Context and Run ReActAgent

Fetch candidates from the user's scoped database, then pass the same
`episodeId` as `scope` to MemRL. The returned trace records the resources that
can later receive feedback.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { OpenAI } from "@ravenlens/raven-adk/models";

const userRequest = "Deploy the API without downtime.";
const identity = { tenantId, userId, sessionId, episodeId };

const candidates = await fetchCandidatesForUser(
  vectorStore,
  userRequest,
  identity
);

const retrieval = await memrl.retrieve(candidates, {
  scope: episodeId
});

const recalledContext = retrieval.candidates.length
  ? retrieval.candidates.map(({ candidate, qScore, utilityScore, rank }) => [
      `Experience ${rank}`,
      `Q-score: ${qScore.toFixed(3)}`,
      `Utility: ${utilityScore.toFixed(3)}`,
      candidate.content
    ].join("\n")).join("\n\n")
  : "No eligible prior experience was found for this user scope.";

const agent = new ReActAgent({
  model: new OpenAI({
    model: "gpt-5.6-sol",
    apiKey: process.env.OPENAI_API_KEY!
  }),
  systemPrompt: [
    "You are a deployment assistant.",
    "Use the recalled experiences only when they are relevant to the request.",
    "Recalled experiences:\n" + recalledContext
  ].join("\n\n"),
  messages: [{ type: "user", content: userRequest }],
  tools: []
});

const result = await agent.invoke();
console.log(result.messages.at(-1));
```

At this point, MemRL has fetched Q-scores only from `episodeId`. A matching
resource under another user's scope has its own Q-score and cannot affect this
ranking.

### 4. Record What Was Used and Apply Feedback

After the outcome is known, select the resources that actually influenced the
response. The example below uses the first ranked candidate as an explicit
application policy. Replace it with your own attribution logic when the agent
can use more than one candidate.

```typescript
const selectedCandidate = retrieval.candidates[0]?.candidate;

if (selectedCandidate) {
  await memrl.selectCandidates(retrieval.trace.traceId, [{
    resourceId: selectedCandidate.resourceId,
    resourceType: selectedCandidate.resourceType
  }]);

  // Example: the deployment completed successfully.
  await memrl.applyFeedback(
    retrieval.trace.traceId,
    1,
    "manual",
    undefined,
    { outcome: "deployment_succeeded" }
  );
}
```

MemRL updates only the Q-score record associated with the trace's scope and
selected resource. It does not edit the original document in your VectorDB.
The default update rule is **Monte Carlo Style Update** Formula:

$$
Q_{new} = Q_{old} + learningRate \cdot (reward - Q_{old})
$$

### 5. Inspect a Specific User's Q-Score

Use the same `episodeId` to read a resource's learned value for that user or
session.

```typescript
const qScore = await memrl.getQScore({
  resourceId: "rolling-deploy-v1",
  resourceType: "memory"
}, episodeId);

console.log(qScore);
// {
//   scope: "tenant:acme:user:user-42:session:chat-19",
//   resourceId: "rolling-deploy-v1",
//   resourceType: "memory",
//   qScore: 0.6,
//   updates: 1
// }
```

On the next request, repeat steps 1 through 4 with the same `episodeId`. MemRL
will use the stored Q-scores to re-rank that user's eligible semantic matches.

## Optional Candidate Provider

`candidateProvider` is useful when your application has a shared retrieval
adapter. It receives `context.semanticSearch.topK` and
`context.semanticSearch.similarityThreshold`, allowing the VectorDB query to
use the same limits that MemRL enforces before Q-score lookup.

It is not called automatically by `ReActAgent` today. Call `retrieve()` as in
the integration above, or invoke the MemRL lifecycle hook from your own
orchestrator.

## Identity and Persistence Checklist

- Use a stable, trusted `episodeId` for the Q-score learning boundary.
- Filter the VectorDB query by the same tenant, user, session, or workspace.
- Pass that same ID to `retrieve(..., { scope: episodeId })` and `getQScore()`.
- Persist `retrieval.trace.traceId` with the application run when feedback will
  arrive later.
- Use database-backed `MemRLScoreStore` and `MemRLTraceStore` implementations
  in production. Include `scope` in the score-store key or unique constraint.
- Keep the semantic document store and Q-score store separate unless one
  storage implementation deliberately supports both responsibilities.

## Common Questions

### Does `episodeId` filter my VectorDB automatically?

No. `episodeId` scopes Q-scores within MemRL. Your VectorDB query must filter
candidate documents by the same identity metadata.

### Does feedback change the original memory document?

No. `applyFeedback()` updates the MemRL Q-score record and appends feedback to
the trace. It does not modify the source memory, skill, or tool record.

### Can I learn across all sessions for one user?

Yes. Use a user-level scope such as `tenant:acme:user:user-42`, and filter the
VectorDB by that user without a session constraint.

## Further Reading

- [MemRL description](./MemRL-Description.md)
- [Extended MemRL specification](./Extanded-MemRL.md)
- [Memory systems overview](../README.md)
- [Main Memory documentation](../../Memory.md)
