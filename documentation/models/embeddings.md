# Embedding Models

Embedding models convert text into vectors for semantic search, retrieval-augmented generation (RAG),
clustering, and similarity comparisons. RavenADK exposes one small contract for embedding providers.

## Public contract

Import the shared contract or a provider from the embeddings entry point:

```typescript
import type { EmbeddingModel } from "@ravenlens/raven-adk/models/embeddings";
import {
    GoogleEmbedding,
    OpenAIEmbedding,
    VoyageEmbedding
} from "@ravenlens/raven-adk/models/embeddings";
```

`EmbeddingModel.embed` accepts one string or an array of strings and always returns an array of
vectors. The order of the returned vectors matches the order of the input strings.

```typescript
async function createVectors(model: EmbeddingModel, text: string | string[]) {
    return model.embed(text);
}
```

## Providers

### OpenAI

```typescript
const model = new OpenAIEmbedding({
    model: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY
});

const vectors = await model.embed([
    "RavenADK supports agents.",
    "RavenADK supports retrieval."
]);
```

`OpenAIEmbedding` supports OpenAI embedding model IDs and custom OpenAI-compatible endpoints
through `baseURL`.

### Google Gemini

```typescript
const model = new GoogleEmbedding({
    model: "gemini-embedding-2",
    apiKey: process.env.GEMINI_API_KEY
});

const [vector] = await model.embed("Create a semantic representation of this text.");
```

`GoogleEmbedding` can use the Gemini API configuration. Vertex AI-specific configuration can be
added through the provider config when the adapter supports it.

### Voyage AI

```typescript
const model = new VoyageEmbedding({
    model: "voyage-3-lite",
    apiKey: process.env.VOYAGE_API_KEY
});

const vectors = await model.embed(["A document", "Another document"]);
```

`VoyageEmbedding` supports Voyage AI model families such as `voyage-3`, `voyage-3-lite`,
`voyage-code-2`, `voyage-law-2`, and `voyage-multilingual-2`.

## RAG and model consistency

Use the same embedding model, dimensions, and preprocessing strategy when indexing and querying a
vector store. Changing the embedding model usually requires rebuilding the stored vectors because
vectors from different models are not directly comparable.

The embeddings contract is used by the RAG features documented in
[Resource Augmented Generation](../augmented%20generation/RAG.md).

## Custom embedding models

A custom adapter only needs to implement the shared contract:

```typescript
import type { EmbeddingModel } from "@ravenlens/raven-adk/models/embeddings";

const customEmbedding: EmbeddingModel = {
    typeAPI: "model",
    apiName: { custom: "My embeddings" },
    config: { model: "my-embedding-model" },
    embed: async (text) => Array.isArray(text)
        ? text.map(() => [])
        : [[]]
};
```

Provider-specific options belong in the model configuration while the public `embed` method and
return type remain stable.
