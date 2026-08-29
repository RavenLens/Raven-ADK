<!-- TODO: Describe and show the code snippets showcases how can this work -->
# Budget Tokens

## Workaround

The current `ReActAgent` implementation reports cumulative model usage through
`agent.usedTokens`, but it does not yet have a built-in maximum-budget option.
You can enforce a session budget today by sharing an `AbortController` with the
agent and aborting the run from the `llm_result` event when the limit is reached.
The usage can then be persisted in your database after the run finishes.

This example uses MongoDB. Install the MongoDB driver in the application that
runs the agent:

```bash
npm install mongodb
```

```typescript
import { MongoClient } from "mongodb";
import { ReActAgent } from "@ravenlens/raven-adk/agents";
import { OpenAI } from "@ravenlens/raven-adk/models";

const sessionId = "user-123:research-task-456";
const maxTotalTokens = 20_000;
const abortController = new AbortController();
let budgetReached = false;
const mongoClient = new MongoClient(process.env.MONGODB_URI!);

await mongoClient.connect();

const budgets = mongoClient
	.db("raven")
	.collection("agent_token_budgets");

const agent = new ReActAgent({
	model: new OpenAI({
		model: "gpt-5-mini",
		apiKey: process.env.OPENAI_API_KEY!
	}),
	systemPrompt: "You are a helpful research assistant.",
	messages: [
		{ type: "user", content: "Research the latest release of TypeScript." }
	],
	tools: [],
	withConclusion: false,
	abort: abortController.signal
});

agent.onEvent("llm_result", () => {
	const usage = agent.usedTokens;
	const totalTokens = usage.input + usage.output + usage.reasoning;

    // Abort further execution when budget is reached
	if (totalTokens >= maxTotalTokens && !abortController.signal.aborted) {
		budgetReached = true;
		abortController.abort();
	}
});

try {
	await agent.invoke();
} finally {
	const usage = agent.usedTokens;
	await budgets.updateOne(
		{ sessionId },
		{
			$set: {
				sessionId,
				inputTokens: usage.input,
				outputTokens: usage.output,
				reasoningTokens: usage.reasoning,
				totalTokens: usage.input + usage.output + usage.reasoning,
				budgetTokens: maxTotalTokens,
				exhausted: budgetReached,
				updatedAt: new Date()
			},
			$setOnInsert: { createdAt: new Date() }
		},
		{ upsert: true }
	);

	await mongoClient.close();
}
```

The `llm_result` callback runs after a model response has been accounted for,
so the request that crosses the limit may complete. The abort prevents the
agent from continuing with the next model, tool, or conclusion step. For a
harder per-request ceiling, also configure the provider's output/reasoning
limits; the controller above enforces the total session allowance.

## Future Vision 
Budget tokens in future can be abstraction used to speedup the process of management the budget tokens for the specified task or the set of tasks where each point can get the specified budget handling logic

[Checkout Vision.md Document](../src/agent/abstract/sessionBudgetTokens/Vision.md)
