# Resource Augmented Generation (RAG) in RavenADK

RAG enhances Language Model capabilities by providing them with relevant, retrieved context from external knowledge bases before generating a response. This reduces hallucinations and allows the model to "know" facts about your specific data without fine-tuning.

<!-- TODO: Add voice agent example here -->

## How RAG Works in RavenADK

RavenADK implements a high-level `ResourceAugmentedGeneration` class that acts as a wrapper for either **Standalone Models** (`AgentModel`) or the **ReAct Agent**.

1.  **Retrieval**: It takes a query and fetches relevant `RAGDocument`s from a vector database specified in config. You can paste there the user inquiry or your own prepared by you or preprocessing llm
2.  **Augmentation**: It formats these documents into a context block and injects them along with specific instructions into the conversation messages.
3.  **Generation**: It then executes the target model or agent's `invoke` or `invokeStructuredOutput` method. Returns the model/agent answer

### Integration with ReAct Agent and Models

You can "register" any component that implements the standard LLM schema or the ReAct Agent.

<!-- TODO: Add `chromaDbInstance` there -->
```typescript
import { ResourceAugmentedGeneration } from "@ravenlens/raven-adk/augmented_generation";
import { OpenAI, OpenAIEmbedding } from "@ravenlens/raven-adk/models";
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { ChromaDB } from "@ravenlens/raven-adk/vector_databases/chromadb";

const embeddingModel = new OpenAIEmbedding({ 
    apiKey: "your-api-key", 
    model: "text-embedding-3-small" 
});

const ragBase = new ResourceAugmentedGeneration({
    query: "What is the state of AI Development at our company?",
    database: chromaDbInstance,
    model: embeddingModel
});

// Using with a Standalone Model
const modelResult = await ragBase
    .register(new OpenAI({ model: "gpt-5.5" }))
    .invoke({ method: "invoke" });

// Using with a ReAct Agent
const agentResult = await ragBase
    .register(new ReActAgent({ /* config */ }))
    .invoke();
```

#### Oppurtunities
- Get structured output `.invoke({ method: "invokeStructuredOutput", params: [z.object()] })`
```typescript
const modelResult = await ragBase
    .register(new OpenAI({ model: "gpt-5.5" }))
    .invoke({ method: "invoke" });
```

## Vector Databases

### Out of the Box Support for Commercial Vector-Databases
RavenADK provides out-of-the-box support for **Pinecone**, **ChromaDB**, and **InMemoryRAGDb**.

#### Importing
```typescript
import { ChromaDB, PineconeDB, InMemory } from "@ravenlens/raven-adk/vector_databases";
// Or via specific exports
import { ChromaDB } from "@ravenlens/raven-adk/vector_databases/chromadb";
import { PineconeDB } from "@ravenlens/raven-adk/vector_databases/pinecone";
import { InMemoryRAGDb } from "@ravenlens/raven-adk/vector_databases/inmemory";
```

#### Manual Interaction
You can interact with the databases directly using the same interface used by the RAG component:

```typescript
const db = new ChromaDB({ client: chromaClient, model: embeddingModel });

// Save a document
await db.save({
    id: "doc_1",
    title: "Project Raven",
    content: "RavenADK is a high-performance agent framework.",
    keywords: ["AI", "Agents"],
    subMemoryIds: []
});

// Fetch documents manually
const docs = await db.fetch("How does Raven work?");
```

### InMemory Store (`InMemoryRAGDb`)
The `InMemoryRAGDb` is a specialized, local-first vector store intended for testing, prototyping, or scenarios where persistence is managed externally. It executes similarity search directly in memory using standard algorithms.

#### Features
- **Algorithm Selection**: Supports `Cosine Similarity` (default) and `Euclidean Distance`.
- **Transparency**: Offers a `getAll()` method to inspect all stored documents and their embeddings.
- **Fast Prototyping**: No external service dependency.

#### Showcase: RAG Pipeline with Euclidean Distance
You can specify the algorithm in the `RAGConfig` to change how semantic similarity is calculated:

```typescript
import { InMemoryRAGDb } from "@ravenlens/raven-adk/vector_databases/inmemory";
import { ResourceAugmentedGeneration } from "@ravenlens/raven-adk/augmented_generation";

const inMemoryDb = new InMemoryRAGDb(embeddingModel);

const rag = new ResourceAugmentedGeneration({
    query: "Tell me about the Raven project",
    database: inMemoryDb,
    model: embeddingModel,
    // Choose Distance/Similarity algorithm
    similarityAlgorithm: "Euclidean Distance" 
});

const result = await rag.register(agent).invoke();
```

#### Manual Interaction and Inspection
`InMemoryRAGDb` allows for manual document management and full state inspection:

```typescript
const db = new InMemoryRAGDb(embeddingModel);

// 1. Manually saving documents (supports arrays or single objects)
await db.save([
    { id: "1", title: "Ref A", content: "...", keywords: [], subMemoryIds: [] },
    { id: "2", title: "Ref B", content: "...", keywords: [], subMemoryIds: [] }
]);

// 2. Fetch using specific algorithm manually
const nearestNeighbors = await db.fetch("query string", "Cosine Similarity");

// 3. Inspect the entire database state
const allDocuments = db.getAll();
console.log(`Stored ${allDocuments.length} documents.`);
```

> **Important:** Always use same embedding model in retriever, that you've used while making documents to get the proper `Cosine Similarity`/`Euclidean Distance` documents (similar semantic meaning documents). This is due to Dimension difference among embedding models, different trainined parameters and architectures of embedding models.

### Creating Your Own Database
To use a different database provider, implement the `RAGDbSchema`:

```typescript
import { RAGDbSchema, RAGDocument } from "@ravenlens/raven-adk/aeval";

export class MyCustomDB implements RAGDbSchema {
    name = "CustomDB";
    async fetch(query: string | string[]): Promise<RAGDocument[]> {
        // Your retrieval logic here
        return [];
    }
    async save(document: RAGDocument): Promise<number> {
        // Your storage logic here
        return 1;
    }
}
```

## Embedding Models

Embedding models are used to convert text into vectors that the database can understand.

### Standalone Embedding Models
RavenADK features implementation of embedding models are compliant with Anthropic, OpenAI and Google Gemini. Use these models accordingly with base model you use to process the information hence these have to be convergent e.g: use same OpenAI Embedding Model as you used to make documents e.g: use `text-embedding-3-small` when you've made documents with `text-embedding-3-small`

```typescript
import { OpenAIEmbedding } from "@ravenlens/raven-adk/models";

const embeddingModel = new OpenAIEmbedding({
    apiKey: process.env.OPENAI_API_KEY,
    model: "text-embedding-3-small"
});

const vectors = await embeddingModel.embed("RavenADK is awesome");
```
> Use provider according to your base model e.g: gemini-embedding-2 with Google Gemini Flash 3.5 or `Voyage AI` embedding models for anthopic
> Keep in mind: For a day (29.06.2026), Anthropic doesn't provide its own embedding models, and they recommend using [VoyageAI models](https://docs.voyageai.com/docs/embeddings) according to [this Anthropic announcement.](https://platform.claude.com/docs/en/build-with-claude/embeddings#how-to-get-embeddings-with-anthropic)

### The Schema
```typescript
export interface EmbeddingModel extends Omit<StandardLLMShema, "invoke" | "invokeStructuredOutput" | "tts" | "stt"> {
    embed(text: string | string[]): Promise<number[][]>;
}
```

### Implementing a Custom Embedding Model
If you want to use a custom embedding provider (e.g. **HuggingFace e5** or local model e.g: your own):

```typescript
import { Mutual } from "@ravenlens/raven-adk/models";

const myModel: Mutual.EmbeddingModel = {
    apiName: { custom: "local-transformer" },
    config: { model: "all-MiniLM-L6-v2" },
    async embed(text) {
        // Call your local embedding API
        const input = Array.isArray(text) ? text : [text];
        return [[0.1, 0.2, ...]]; 
    }
};
```

