# FactChecker

`FactChecker` is the RavenADK library abstraction for checking whether a specified sentence or claim is factually **truthy** or **falsy**.

It does not choose a source or a model by itself. Instead, you provide one or more verifier functions, called `FactSentry`s. A verifier can be a deterministic function, a standalone model, a `ReActAgent`, or a RAG-augmented model or agent.

FactChecker is useful when factual correctness is the main concern:

- Check a sentence or a larger piece of text against external evidence.
- Run several independent verifiers and preserve each result.
- Replace a falsy text range with a correction returned by the verifier.

## Core API

```typescript
export interface TruthnessState {
	/** Zero-based inclusive start offset in the checked text. */
	from: number;
	/** Zero-based exclusive end offset in the checked text. */
	to: number;
	truthy: boolean;
	/** Text inserted by improve() for a falsy range. */
	baseOnRecource: string;
}

export type FactSentry = (
	fact: string
) => TruthnessState | Promise<TruthnessState>;

export interface FactCheckerConfig {
	toCheck: string;
	verifiers: FactSentry | FactSentry[];
	judge?: FactCheckerJudgeConfig;
}

export interface FactCheckerJudgeConfig {
	model: AgentModel;
	systemPrompt?: string;
	tools?: Tool<any, any>[];
}
```

The spelling `baseOnRecource` is part of the current public API and must be used exactly. Despite its name, the current `improve()` implementation treats it as replacement text. Put a source citation in the same string when the corrected text needs to retain its evidence.

## Basic verification

The verifier receives the complete `toCheck` string. For a whole-sentence verdict, use `from: 0` and `to: fact.length`.

```typescript
import { FactChecker, type FactSentry } from "@ravenlens/raven-adk";

const sentence = "The Pacific Ocean is the largest ocean on Earth.";

const verifier: FactSentry = async (fact) => {
	// Replace this example with a database lookup, search request, or policy check.
	const truthy = fact === sentence;

	return {
		from: 0,
		to: fact.length,
		truthy,
		baseOnRecource: truthy
			? fact
			: "The Pacific Ocean is the largest ocean on Earth."
	};
};

const checker = new FactChecker({
	toCheck: sentence,
	verifiers: verifier
});

const ratings = await checker.check();
console.log(ratings[0].truthy); // true

const correctedText = await checker.improve(ratings);
console.log(correctedText);
```

`check()` accepts either one verifier or an array of verifiers. All verifiers receive the same input and run concurrently. The returned array has the same order as the configured verifier array.

## Resolving verifier conflicts

Two verifier results conflict when their ranges overlap and their `truthy` values differ. Different verdicts for disjoint ranges are not a conflict; they can describe different claims in the same text.

FactChecker does not silently use the first result, the last result, or a majority vote. Configure the optional `judge` with an AEval model when conflicting results need to be resolved:

```typescript
import { FactChecker, type FactCheckerJudgeConfig, type FactSentry } from "@ravenlens/raven-adk";
import { OpenAI } from "@ravenlens/raven-adk/models";

const judge: FactCheckerJudgeConfig = {
	model: new OpenAI({
		model: "gpt-5-mini",
		apiKey: process.env.OPENAI_API_KEY
	}),
	systemPrompt: [
		"Resolve conflicts between factual verifiers.",
		"Compare the claim, each verifier's evidence, and the proposed truthy/falsy result.",
		"Select the candidate with the strongest reliable support."
	].join("\n")
};

const verifierA: FactSentry = async (fact) => ({
	from: 0,
	to: fact.length,
	truthy: true,
	baseOnRecource: "Evidence supporting the original claim."
});

const verifierB: FactSentry = async (fact) => ({
	from: 0,
	to: fact.length,
	truthy: false,
	baseOnRecource: "Corrected text based on contradictory evidence."
});

const checker = new FactChecker({
	toCheck: "The claim that needs a decision.",
	verifiers: [verifierA, verifierB],
	judge
});

// The AEval judge evaluates each competing result and the strongest candidate wins.
const resolvedRatings = await checker.check();
const resolvedText = await checker.improve(resolvedRatings);
```

Internally, FactChecker creates an `AgenticEvaluator` for each candidate in the conflict group. The evaluator receives the original claim, all competing verifier results, and the candidate currently being scored. Its `score` is used first, its `verdict` (`BEST`, `GOOD`, `POOR`, or `REJECTED`) breaks ties, and the original verifier order is the final deterministic tie-breaker.

When a conflict exists without `judge`, `check()` throws an error. This fail-closed behavior prevents `improve()` from applying an arbitrary correction. A conflict group is reduced to the winning `TruthnessState`; non-conflicting ratings remain in the returned array.

The judge can also use tools to inspect additional evidence:

```typescript
const judge: FactCheckerJudgeConfig = {
	model,
	tools: [webSearchTool, internalKnowledgeTool],
	systemPrompt: "Resolve verifier conflicts using the available evidence tools."
};
```

Use the judge only when there is a real disagreement. A single verifier or a set of verifiers that agree does not invoke AEval.

```typescript
const checker = new FactChecker({
	toCheck: "The statement to verify.",
	verifiers: [
		verifierFromCompanyKnowledgeBase,
		verifierFromTrustedWebSearch
	]
});

const ratings = await checker.check();
// ratings[0] comes from verifierFromCompanyKnowledgeBase
// ratings[1] comes from verifierFromTrustedWebSearch
```

For claim-level corrections, return non-overlapping ranges. `from` is zero-based and inclusive; `to` is zero-based and exclusive.

```typescript
const text = "The first claim is correct. The second claim is wrong.";

const claimRating: TruthnessState = {
	from: text.indexOf("The second claim is wrong."),
	to: text.length,
	truthy: false,
	baseOnRecource: "The second claim has been corrected."
};

const checker = new FactChecker({
	toCheck: text,
	verifiers: async () => claimRating
});

const corrected = await checker.improve([claimRating]);
// "The first claim is correct. The second claim has been corrected."
```

`improve()` applies falsy replacements from right to left, so earlier offsets remain valid. It does not run the verifiers again and does not mutate `config.toCheck`.

## Using a standalone model

Models from `@ravenlens/raven-adk/models` can produce the structured verdict. The model is responsible for deciding truthfulness; the adapter adds the text range required by `FactChecker`.

```typescript
import { FactChecker, type FactSentry } from "@ravenlens/raven-adk";
import { OpenAI } from "@ravenlens/raven-adk/models";
import { z } from "zod";

const FactVerdictSchema = z.object({
	truthy: z.boolean(),
	// This is the corrected text for the checked range, not only a URL.
	baseOnRecource: z.string().min(1)
});

const model = new OpenAI({
	model: "gpt-5-mini",
	apiKey: process.env.OPENAI_API_KEY
});

const modelVerifier: FactSentry = async (fact) => {
	const result = await model.invokeStructuredOutput(FactVerdictSchema, 3, {
		messages: [
			{
				type: "system",
				content: [
					"Verify the factual claim using reliable knowledge.",
					"Return truthy=false when the claim is unsupported or incorrect.",
					"When it is false, baseOnRecource must be a corrected replacement sentence."
				].join("\n")
			},
			{ type: "user", content: fact }
		]
	});

	const aiMessage = result.answer.find(message => message.type === "ai");
	if (!aiMessage || aiMessage.type !== "ai") {
		throw new Error("Fact verifier did not return an AI message.");
	}

	const verdict = FactVerdictSchema.parse(aiMessage.structuredOutput);
	return {
		from: 0,
		to: fact.length,
		...verdict
	};
};

const factChecker = new FactChecker({
	toCheck: "The claim to verify.",
	verifiers: modelVerifier
});

const ratings = await factChecker.check();
const corrected = await factChecker.improve(ratings);
```

The same adapter works with `Google`, `Anthropic`, `RunPod`, or a custom implementation of `StandardLLMShema`. Only the model invocation changes.

## Using a ReAct Agent

Use a `ReActAgent` when factual verification requires actions such as web browsing, calling an API, executing code, or consulting several tools before deciding.

The following example uses a small Wikipedia lookup tool. In production, replace it with the browsing or search tool appropriate for your application.

```typescript
import { FactChecker, ReActAgent, type FactSentry } from "@ravenlens/raven-adk";
import { OpenAI } from "@ravenlens/raven-adk/models";
import { tool } from "@ravenlens/raven-adk/tools";
import { z } from "zod";

const FactVerdictSchema = z.object({
	truthy: z.boolean(),
	baseOnRecource: z.string().min(1)
});

const wikipediaLookup = tool(
	async ({ topic }: { topic: string }) => {
		const response = await fetch(
			`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`
		);

		if (!response.ok) {
			return "No Wikipedia evidence was found for this topic.";
		}

		const data = await response.json() as {
			extract?: string;
			content_urls?: { desktop?: { page?: string } };
		};

		return JSON.stringify({
			extract: data.extract ?? "",
			source: data.content_urls?.desktop?.page ?? ""
		});
	},
	{
		toolName: "wikipedia_lookup",
		toolDescription: "Look up a topic and return its Wikipedia summary and source URL.",
		toolArguments: z.object({
			topic: z.string().min(1)
		})
	}
);

const agentVerifier: FactSentry = async (fact) => {
	// Create a fresh agent so each verification has an isolated message history.
	const agent = new ReActAgent({
		model: new OpenAI({
			model: "gpt-5-mini",
			apiKey: process.env.OPENAI_API_KEY
		}),
		systemPrompt: [
			"You verify factual claims.",
			"Use the available evidence tool before deciding.",
			"Return a corrected replacement sentence in baseOnRecource when the claim is false."
		].join("\n"),
		messages: [
			{
				type: "user",
				content: `Verify this claim: ${fact}`
			}
		],
		tools: [wikipediaLookup],
		withConclusion: false
	});

	const result = await agent.invokeStructuredOutput(FactVerdictSchema);
	const aiMessage = [...result.messages]
		.reverse()
		.find(message => message.type === "ai");

	if (!aiMessage || aiMessage.type !== "ai") {
		throw new Error("ReAct fact verifier did not return an AI message.");
	}

	const verdict = FactVerdictSchema.parse(aiMessage.structuredOutput);
	return {
		from: 0,
		to: fact.length,
		...verdict
	};
};

const checker = new FactChecker({
	toCheck: "The sentence that needs evidence.",
	verifiers: agentVerifier
});

const ratings = await checker.check();
const corrected = await checker.improve(ratings);
```

The difference from the standalone model example is that the ReAct agent can gather evidence through its tools before producing the structured `FactChecker` result.

## Using RAG to find relevant information

RAG is useful when the authoritative evidence is stored in an internal knowledge base, documentation set, or vector database. `ResourceAugmentedGeneration` retrieves the documents relevant to the claim and injects them into a registered model or agent before invocation.

This example uses the built-in in-memory vector database. Replace it with a persistent RAG database for production use.

```typescript
import {
	FactChecker,
	RAGChain,
	VectorDatabase,
	type FactSentry
} from "@ravenlens/raven-adk";
import { OpenAI, OpenAIEmbedding } from "@ravenlens/raven-adk/models";
import { z } from "zod";

const FactVerdictSchema = z.object({
	truthy: z.boolean(),
	baseOnRecource: z.string().min(1)
});

const embeddingModel = new OpenAIEmbedding({
	model: "text-embedding-3-small",
	apiKey: process.env.OPENAI_API_KEY
});

const database = new VectorDatabase.InMemory.InMemoryRAGDb(embeddingModel);
await database.save([
	{
		id: "raven-adk-language",
		title: "RavenADK language support",
		content: "RavenADK is a TypeScript-native agent framework.",
		keywords: ["RavenADK", "TypeScript"],
		subMemoryIds: []
	}
]);

const ragVerifier: FactSentry = async (fact) => {
	const model = new OpenAI({
		model: "gpt-5-mini",
		apiKey: process.env.OPENAI_API_KEY,
		messages: [{ type: "user", content: fact }]
	});

	const rag = new RAGChain({
		query: fact,
		database,
		model: embeddingModel
	});

	const result = await rag
		.register(model)
		.invoke({
			method: "invokeStructuredOutput",
			params: [FactVerdictSchema]
		});

	const aiMessage = result.answer.find(message => message.type === "ai");
	if (!aiMessage || aiMessage.type !== "ai") {
		throw new Error("RAG fact verifier did not return an AI message.");
	}

	const verdict = FactVerdictSchema.parse(aiMessage.structuredOutput);
	return {
		from: 0,
		to: fact.length,
		...verdict
	};
};

const checker = new FactChecker({
	toCheck: "RavenADK is a TypeScript-native agent framework.",
	verifiers: ragVerifier
});

const ratings = await checker.check();
const corrected = await checker.improve(ratings);
```

RAG finds relevant information; it does not make the final truth decision by itself. The registered model or ReAct agent must be instructed to treat the retrieved documents as evidence and return the structured verdict.

The same RAG chain can register a ReAct agent instead of a standalone model:

```typescript
const result = await new RAGChain({
	query: fact,
	database,
	model: embeddingModel
})
	.register(agent)
	.invoke({
		method: "invokeStructuredOutput",
		params: [FactVerdictSchema]
	});
```

## Combining verifiers

Independent verifiers are useful when one source can be incomplete or unavailable. Each verifier receives the full text, so the application decides how to interpret disagreements.

```typescript
const checker = new FactChecker({
	toCheck: "The claim to verify.",
	verifiers: [modelVerifier, agentVerifier]
});

const ratings = await checker.check();

for (const [index, rating] of ratings.entries()) {
	console.log(`Verifier ${index}: ${rating.truthy ? "truthy" : "falsy"}`);
	console.log(rating.baseOnRecource);
}
```

For multiple verifiers, do not pass overlapping falsy ranges to `improve()` unless the replacement behavior is intentional. Overlapping replacements can change the text selected by a later replacement.

## FactChecker compared with AEval

FactChecker and [AEval](AEval.md) both evaluate generated content, but they answer different questions.

| Concern | FactChecker | AEval (`AgenticEvaluator`) |
| --- | --- | --- |
| Main question | Is this sentence or claim factually true? | Does this response satisfy the requested outcome and quality bar? |
| Input | One text string in `toCheck` | A conversation whose last message is the AI response |
| Evidence | Verifier functions, models, tools, or RAG context | The evaluator agent's context and optional tools |
| Result | One or more `TruthnessState` records with ranges and evidence/replacement text | `score`, `verdict`, `reasoning`, `metrics`, and optional `improvements` |
| Improvement | Replaces falsy ranges using `improve()` | Feeds improvement guidance back to the original model or agent and can retry with `loop()` |
| Best fit | Factual claims, citations, dates, measurements, and domain assertions | Correctness against requirements, completeness, style, code quality, and general response evaluation |

### Use FactChecker when

- The important question is whether a claim is supported by a known source.
- You need a truthy/falsy result for a sentence or a text range.
- You want to correct a false claim using evidence from a model, tool, or RAG database.
- You can express verification as one or more `FactSentry` functions.

### Use AEval when

- The output must be compared with a user request or an explicit expectation.
- You need a graded score, a named verdict, reasoning, metrics, or improvement guidance.
- The original model or agent should be rerun automatically until it reaches the required quality threshold.
- The evaluation concerns more than factuality, such as tone, format, completeness, or code quality.

### Use both

For a response that must be factually correct and also satisfy broader quality requirements, run them as separate stages:

```typescript
// 1. Generate a draft with a model or ReAct agent.
const draft = "Generated answer containing one or more factual claims.";

// 2. Verify and correct factual claims.
const factChecker = new FactChecker({
	toCheck: draft,
	verifiers: ragVerifier
});
const ratings = await factChecker.check();
const factCheckedDraft = await factChecker.improve(ratings);

// 3. Evaluate the corrected response against the user's full expectations.
// Construct AgenticEvaluator with the conversation containing factCheckedDraft,
// then call evaluate() or loop() as described in AEval.md.
```

In short: use FactChecker for **claim-level factual verification**, AEval for **response-level evaluation and iterative improvement**, and combine them when both guarantees are required.
