# Session Token Budget Management

## HUMAN Note
- Concept can be implement as class wrapper that takes the models with `decorator` and modifies the quota is exceeded
```typescript
import { SessionBudgetTokens } from "@ravenlens/raven-adk/session-budget";

type BudgetReachedDecision =
    | {
        action: "stop";
    }
    | {
        action: "append_message";
        message: AIMessage;
    }
    | {
        action: "invoke_conclusion";
        model: AgentModel;
        reservedTokens: number;
    }
    | {
        action: "extend_budget";
        additionalTokens: number;
    };

type BudgetReachedContext = {
    sessionId: string;
    reason: "total" | "input" | "output" | "reasoning";
    usage: SessionTokenUsage;
    budget: SessionTokenBudgetLimits;
    remainingTokens: number;
    messages: MessagesVariations[];
    lastModelResult?: LLMAnswer;
    agentRole?: string;
};

const agent = new ReActAgent({
    model: new OpenAI({ model: "gpt-5.6-sol", apiKey: "" }),
    systemPrompt: "",
    messages: []
});

// Use as the decorator
const budgetSession = new SessionBudgetTokens(agent, {
    budget: 100_000, // session cannot exceed 100_000 tokens
    alertPercentage: 80, // Tokens budget close event
    conclusionReserveTokens: 1_000, // Setup tokens to reserve
    // Use to handle the outcome
    onBudgetReached: async context => ({
        verdict: "stop",
        stopMessage: {
            type: "ai",
            content: "The token budget was exhausted."
        }
    })
});

// Listen events
budget.onEvent("budget_session_started", () => {

});

// ... more events

// Call this method instead of agent dedicated one - it invokes the `agent.invoke` method
budget.invoke({ messages: [], /** ...Rest of options */ });

const usage = budget.usage;
const reservation = budget.reserve(...);
```

- Listen events from [Events](#recommended-events)
- It's interoperable for the models and agents

- For parallel subagents, independent wrappers are not enough if they each maintain separate counters. They must share one controller with atomic reservations:
```typescript
const reservation = session.tryReserve(...);

if (!reservation) {
    // Do not launch this branch.
}
```

## Purpose

Implement one reusable token-budget abstraction for RavenADK agent executions. It must support `ReActAgent` and other multi-step agents such as `CodingAgent`'s', including subagents, function subagents, structured-output retries, tool loops, parallel execution, and optional conclusion generation.

The feature has two separate responsibilities:

1. **Usage Accounting:** record the token usage reported by every model call.
2. **Events Emitting** - each accounting and reaching budget has to trigger the events can be listened with `onEvent` and `onAnyEvent` this impacts UX in way displays budget reaching
3. **Implementation Elegance** - `SessionBudgetTokens` is class clears the spaghetti code from [Current Snippet](../../../../documentation/BudgetTokens.md)
4. **Budget Enforcement:** prevent new model work once the configured session budget is exhausted and provide a controlled final outcome.

Conversation compaction remains a separate concern. Compaction protects the model context window; session budgets protect the total execution allowance. A compaction plugin may be used together with this feature, but its context estimate must not be treated as billed usage.

## Design Decision

Session budgeting belongs in a core execution abstraction, not exclusively in `ReActAgentPluginSpec`.

The current plugin lifecycle is not sufficient for hard enforcement:

- `before_model_call` can make a preflight decision, but it does not know the actual usage of the call.
- `after_model_call` runs after the provider has already consumed tokens.
- Plugins do not currently receive the `LLMAnswer` directly.
- Event listeners are notifications and cannot reliably prevent a graph transition.
- Parallel subagents can pass independent checks against the same remaining budget.

Plugins should remain available for observability and policy customization. The agent execution loop must call the budget abstraction before and after every model invocation.

Recommended layering:

```text
Agent execution loop
	calls preflight, reservation, reconciliation, and exhaustion handling

SessionTokenBudget
	owns limits, usage, reservations, thresholds, and lifecycle state

Provider model
	enforces per-request output and reasoning limits

Plugin
	observes budget events or supplies optional policy hooks
```

## Session Scope

A session is the lifetime of one logical agent task, not necessarily the lifetime of one JavaScript object.

The implementation must make the scope explicit:

- `invoke()` starts a new budget session by default.
- Repeated calls can share a session when the caller supplies the same budget-session object.
- A root `ReActAgent` and all of its subagents share the same session when the configured budget is a total orchestration budget.
- Parallel branches reserve budget before they start so they cannot all spend the same remaining tokens.
- `serve()` must create or receive a session per queued task unless the caller explicitly requests a worker-wide budget.
- Usage from a previous session must not silently affect a new session.

`ReActAgent.usedTokens` may remain as a compatibility field, but the authoritative state should be the session budget object. If `usedTokens` continues to be cumulative, its documentation must say that clearly. Prefer exposing both session usage and lifetime usage if both are needed.

## Token Categories

The canonical usage shape is:

```typescript
interface SessionTokenUsage {
	input: number;
	output: number;
	reasoning: number;
}
```

Define total usage as:

```text
total = input + output + reasoning
```

Provider usage is authoritative whenever it is returned. `reasoning` is included in `total` even when a provider reports it separately from output. Do not add reasoning twice when a provider already includes reasoning in its output count; provider adapters must normalize their `LLMAnswer.tokens` contract consistently.

Tool execution, plugin execution, memory callbacks, compaction, and token estimation do not consume model tokens unless they make a model call. Their duration and monetary cost may be tracked separately in a future resource budget.

## Budget Configuration

The initial public configuration should support a total limit and optional category limits:

```typescript
interface SessionTokenBudgetLimits {
	maxTotalTokens?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	maxReasoningTokens?: number;
}
```

All limits are optional. A missing limit means unlimited for that dimension. Values must be finite, non-negative integers. Invalid values should fail fast during construction or be normalized according to the repository's existing configuration policy; they must never create an accidental unlimited budget.

The budget configuration should also support threshold alerts and exhaustion behavior:

```typescript
type SessionTokenBudgetThreshold = {
	percentage: number;
	id?: string;
	once?: boolean;
};

type SessionTokenBudgetExhaustionContext = {
	reason: "total" | "input" | "output" | "reasoning";
	usage: SessionTokenUsage;
	limits: SessionTokenBudgetLimits;
	remainingTokens?: number;
	lastModelResult?: LLMAnswer;
};

type SessionTokenBudgetExhaustionResult =
	| { action: "stop" }
	| { action: "append_message"; message: AIMessage | UserMessage }
	| { action: "invoke_conclusion"; model?: AgentModel; maxOutputTokens?: number };

interface SessionTokenBudgetOptions {
	limits: SessionTokenBudgetLimits;
	thresholds?: SessionTokenBudgetThreshold[];
	onThreshold?: (event: SessionTokenBudgetThresholdEvent) => void | Promise<void>;
	onExhausted?: (
		context: SessionTokenBudgetExhaustionContext
	) => SessionTokenBudgetExhaustionResult | Promise<SessionTokenBudgetExhaustionResult>;
	conclusionReserveTokens?: number;
}
```

`onExhausted` is a user-supplied outcome function. It may return a local message, request a separately budgeted conclusion model call, or stop without appending anything. The function must not be invoked automatically through an ordinary event listener because its result controls graph execution.

## Counting Model Calls

Every model call must have the following lifecycle:

```text
1. Build the exact messages and model options that will be sent.
2. Estimate input tokens when an estimator is available.
3. Check remaining budget and reserve estimated capacity atomically.
4. Reduce the provider output limit to the remaining allowance when supported.
5. Invoke the model with the existing abort signal.
6. Reconcile the reservation with authoritative LLMAnswer.tokens.
7. Emit usage and threshold events.
8. If a limit was reached, stop before scheduling another graph node.
```

The preflight estimate is a scheduling guard, not final accounting. It can be approximate because provider tokenization may differ and media can be difficult to estimate. The returned `LLMAnswer.tokens` is the source of truth for actual usage.

If no tokenizer is available, use the existing bounded fallback estimate used by conversation compaction, but mark the reservation as estimated. Never report an estimate as authoritative usage.

A request must not start if its known input estimate already exceeds the remaining input or total budget. If the input is allowed but the output allowance is smaller than the provider's configured default, pass the reduced allowance through a provider-neutral option where possible. Provider adapters map that option to `max_tokens`, `maxOutputTokens`, `max_completion_tokens`, or the equivalent API field.

## Reservations and Parallelism

The controller must support reservations:

```typescript
interface TokenReservation {
	id: string;
	estimatedInputTokens: number;
	reservedOutputTokens: number;
	reservedTotalTokens: number;
}
```

`tryReserve()` must be atomic from the perspective of concurrent branches. A reservation reduces available capacity immediately. `reconcile()` releases unused estimated capacity and adds the actual usage.

For parallel subagents:

- reserve for every branch before launching `Promise.all()`;
- reject or skip branches that cannot reserve capacity;
- reconcile each branch independently;
- apply the shared session policy when the aggregate limit is reached;
- never rely on each child agent's private `usedTokens` field for global enforcement.

Function subagents that call models through an event callback must report their `llm_result` usage into the same shared session. A function subagent that cannot provide usage cannot participate in a hard token budget and must be documented as unmetered or rejected by configuration.

## Threshold Alerts

Thresholds are based on the configured limit and actual reconciled usage:

```text
percentage = totalUsage / maxTotalTokens * 100
```

For category limits, calculate the corresponding category percentage as well. Thresholds should be evaluated after reconciliation and only when a threshold is crossed. A threshold at `80` fires when usage moves from below 80% to at least 80%; it must not fire repeatedly after every later model call unless `once` is false.

The event payload should contain enough information for dashboards and policy decisions:

```typescript
interface SessionTokenBudgetThresholdEvent {
	sessionId: string;
	threshold: number;
	percentage: number;
	usage: SessionTokenUsage;
	limits: SessionTokenBudgetLimits;
	remainingTokens?: number;
	source: "model_call" | "reservation";
	agentRole?: string;
}
```

### Recommended events:

- `budget_session_started`
- `budget_reservation_created`
- `budget_usage_updated`
- `budget_threshold_reached`
- `budget_exhausted`
- `budget_session_finished`

Events are for telemetry and notification. `budget_exhausted` should be emitted before the exhaustion outcome is executed, but event delivery must not be the mechanism that decides whether the graph continues.

Threshold callbacks must be failure-isolated. A failing alert callback must not consume budget, corrupt accounting, or resume an already stopped agent.

## Exhaustion Behavior

When any configured limit is reached, the session enters a terminal `exhausted` state. No new model call may begin unless the exhaustion handler explicitly creates a separately reserved conclusion call.

Supported policies:

### Stop

Return the messages collected so far and mark the graph state with a machine-readable budget reason, for example:

```typescript
{
	budgetExceeded: true,
	budgetExhaustionReason: "total"
}
```

This is the only policy that guarantees no additional model tokens after exhaustion.

### Append a Local Message

Append the message returned by `onExhausted` without invoking an LLM. This is useful for a predictable fallback:

```typescript
{
	type: "ai",
	content: "The response was stopped because the token budget was exhausted."
}
```

The message must be appended exactly once, and the graph must finish afterward.

### Invoke a Conclusion Model

If graceful summarization is required, reserve a conclusion allowance before the main work begins:

```typescript
conclusionReserveTokens: 1000
```

The conclusion handler may use only this reserved amount. It must call the same session controller, disable tools, and use a bounded output limit. If the conclusion fails or the reserve is unavailable, fall back to a local message or stop. Never make an unbounded conclusion call after the working budget is exhausted.

The existing `concludeAndAppendConclusionMessage()` and `concludeWithStructuredOutput()` paths must participate in the same accounting. Conclusion and structured-output retry calls are model calls, not free post-processing.

## Abort Integration

Budget exhaustion should use the existing `ReActAgentAbortable` graph transition, but it should remain distinguishable from user cancellation:

- user cancellation: `state.isAborted === true`, reason `aborted`;
- budget exhaustion: `state.isAborted === true` or a separate terminal state, reason `budget_exceeded`;
- provider failure: normal error path, with usage reconciled if available.

If an internal controller aborts the provider request, preserve the budget reason and emit the budget event exactly once. An already-running provider request may still incur tokens; reconciliation must happen if a response arrives after the stop signal.

## ReActAgent Integration

`ReActAgent` should accept either budget options or an injected session controller. Injection is preferred for shared root/subagent accounting:

```typescript
interface ReActAgentConfig<...> {
	// existing fields
	tokenBudget?: SessionTokenBudget;
}
```

The integration points are:

1. At the beginning of `runGraph`, create a new session only when one was not injected.
2. Before `model.invoke()` in `main_node`, estimate and reserve.
3. After `model.invoke()`, reconcile `LLMAnswer.tokens`.
4. Apply the same wrapper to every subagent model invocation.
5. Apply it to function-subagent `llm_result` events.
6. Apply it to conclusion and structured-output calls.
7. Check the session before routing to `tools_node`, a subagent node, or another `main_node` pass.
8. Pass the shared controller to child `ReActAgent` instances.
9. Emit the budget events through `ReActAgentEvents` and `ReActAgentStreamChunk` where streaming consumers need them.

The current `calculateUsedTokens()` should delegate to or update the controller instead of being a second independent accounting system. Keep it as a compatibility method only if existing public consumers depend on it.

## Plugin Integration

The existing `ReActAgentPluginSpec` should not be overloaded with the core budget algorithm. Add optional budget-specific plugin hooks only after the controller contract is stable.

Suitable plugin responsibilities:

- subscribe to budget events;
- add metrics or cost attribution;
- change thresholds before a run;
- choose a policy before the session starts;
- attach a budget summary to graph state or final metadata.

If a plugin must influence exhaustion behavior, expose a typed policy hook on the budget controller or config. Do not infer a return value from `plugin_result` after the graph has already continued.

The existing compaction plugin can continue to run at `before_model_call`. It should reduce context usage but must not alter the session's authoritative consumed-token count.

## Other Agent Types

Other agents should integrate through a small execution adapter rather than depend on `ReActAgent` internals:

```typescript
interface MeteredModelInvoker {
	invoke(options?: InvokeOptions): Promise<LLMAnswer>;
	invokeStructuredOutput(
		schema: z.ZodTypeAny,
		maxRecallTries?: number,
		options?: InvokeOptions
	): Promise<LLMAnswer>;
}
```

The adapter performs preflight, reservation, invocation, reconciliation, and event emission. `AgentsDebate`, Tree of Thoughts, RAG loops, and future agents can then share the same controller while retaining their own scheduling rules.

`AgentsDebate` already estimates message tokens and enforces per-agent and mutual debate boundaries. It should either migrate to the shared controller or remain explicitly separate with an adapter that converts its `consumedTokens` into session reservations. Do not silently count the same debate messages both as estimated context and as provider-reported usage.

## Protocol Integration

The existing protocol `TaskRequest.budget.maxTokens` should map to `maxTotalTokens` for the task session. `serve()` must:

1. create a task-scoped session from the queued request budget;
2. pass the session to `invoke()`;
3. complete the task with usage and budget status;
4. fail or cancel according to the exhaustion policy;
5. avoid carrying usage from one queued task into the next unless worker-wide budgeting was explicitly configured.

The result usage should include at least `inputTokens` and `outputTokens`; add reasoning and total usage when the protocol version permits it.

## Invariants

The implementation is correct only if these invariants hold:

- actual usage is reconciled exactly once per model result;
- a model call cannot start without a successful preflight when a finite budget applies;
- no new graph node requiring model work is scheduled after exhaustion;
- parallel reservations cannot oversubscribe the budget;
- threshold events fire on crossings, not on every update by default;
- conclusion calls are budgeted and bounded;
- child agents share the intended parent session;
- user abort and budget exhaustion remain distinguishable;
- alert and policy callback failures cannot corrupt the session;
- compaction estimates are not reported as actual consumption;
- a new invocation does not inherit old session usage accidentally.

## Validation Plan

Add focused tests before broad integration tests:

1. One model call updates input, output, reasoning, and total usage.
2. A second call is rejected when the total budget is already exhausted.
3. A call receives a reduced output allowance equal to the remaining budget.
4. An 80% threshold fires exactly once when configured with `once: true`.
5. A category limit stops the session even when total usage remains available.
6. A local exhaustion message is appended once and no conclusion model is called.
7. A reserved conclusion call is allowed only within its reserve.
8. A failed alert callback does not stop or corrupt the agent.
9. Parallel subagents cannot oversubscribe a shared session.
10. Function subagent usage is included through `llm_result` events.
11. Main-agent, subagent, conclusion, and structured-output usage all share the expected session.
12. `serve()` applies a queued task's `budget.maxTokens` and resets task scope correctly.
13. User abort is reported differently from budget exhaustion.
14. A provider with missing or estimated usage follows the documented unmetered/estimated policy.

## Implementation Order

1. Define `SessionTokenUsage`, limits, reservation, event, and exhaustion result types.
2. Implement a standalone `SessionTokenBudget` with validation, threshold crossing, reservations, and reconciliation.
3. Add a metered model invocation adapter for normal and structured-output calls.
4. Integrate the adapter into `ReActAgent` main, subagent, function-subagent, and conclusion paths.
5. Share the controller across child agents and parallel branches.
6. Add ReAct budget events and stream mappings.
7. Map protocol task budgets into task sessions.
8. Add plugin observers and documentation examples.
9. Migrate or adapt other agent families such as `AgentsDebate` and Tree of Thoughts.
10. Add the validation tests and update public API documentation.

## Non-Goals

This feature does not initially promise:

- exact preflight token counts for every provider or media type;
- cancellation of tokens already accepted by a provider;
- monetary cost enforcement without provider pricing metadata;
- automatic selection of a cheaper model;
- replacing context compaction;
- treating tool output size as billed model usage without provider accounting.

