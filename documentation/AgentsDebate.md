# Agents Debate

`AgentsDebate` is the RavenADK abstraction for coordinating several specialized
agents around one task. It supports local and remote participants, agent
selection, consultation, critique, and handoff workflows.

The design draws on multi-agent debate, group discussion, MetaGPT-style
delegation, and ChatDev-style role-based collaboration. Agreement between
agents is evidence for a solution, not proof that the solution is correct. A
final evaluator, verifier, or domain-specific check may still be required.

## Research Foundations

> [Improving Factuality and Reasoning in Language Models through Multi-Agent Debate](https://arxiv.org/abs/2305.14325), [GroupDebate: Enhancing the Efficiency of Multi-Agent Debate Using Group Discussion](https://arxiv.org/abs/2409.14051), [MetaGPT: Meta Programming for Multi-Agent Collaborative Software Development](https://arxiv.org/abs/2308.00352), and [Communicative Agents for Software Development (ChatDev)](https://arxiv.org/abs/2307.07924) show how multi-turn critique, organized discussion stages, specialized roles, structured handoffs, and bounded communication can improve collaborative agent workflows, which informs `AgentsDebate` participant descriptions, selection, consultation, critique, handoff, communication stages, clarification, and shared token and time boundaries.

## Core Concepts

### Debate participant

Each participant has:

- `name`: a unique identifier used when selecting or addressing the agent.
- `description`: the participant's specialization and role.
- `agentLogic`: the executable implementation.

The participant can be supplied in several forms:

1. A callback implementing `ExecutableAgentDebateFn`.
2. An object implementing `InvokableAgentDebate` with `invoke(options)`.
3. A startable workflow implementing `StartableAgentDebate` with `start()`.
4. A `ReActAgent` instance.

Callbacks and invokable objects receive the debate message history and an
optional abort signal. A startable workflow receives no arguments through its
`start()` contract. Use an adapter callback when the workflow needs the task
messages or needs to return a value.

```typescript
import { Graph, GraphMarkers } from "@ravenlens/raven-adk/graph";
import {
	AgentsDebate,
	type AgentDebateType,
	type ExecutableAgentDebateFn
} from "@ravenlens/raven-adk/agents";

const specialist: ExecutableAgentDebateFn<string> = async ({ messages, abort }) => {
	if (abort?.aborted) {
		throw new Error("Debate was aborted");
	}

	const task = messages.at(-1);
	return task?.type === "user" ? `Specialist response: ${task.content}` : "No user task";
};

const workflow = new Graph({ completed: false });
workflow
	.addNode("finish", () => ({ stateUpdate: { completed: true } }))
	.addEdge(GraphMarkers.START, "finish")
	.addEdge("finish", GraphMarkers.END);

const agents: AgentDebateType[] = [
	{
		name: "specialist",
		description: "Handles the task using domain-specific reasoning.",
		agentLogic: specialist
	},
	{
		name: "workflow",
		description: "Runs a deterministic workflow.",
		agentLogic: workflow
	}
];
```

### Shared task context

`AgentsDebateConfig.messages` is the message history supplied to debate
operations. The primary task is conventionally the last user message. The
history may also contain system, assistant, tool, reasoning, or compaction
messages supported by RavenADK.

The debate treats the history as input context. Participants do not mutate the
original array; each execution receives an independent copy when debate
messages or execution results are appended.

### Boundaries

`mutualBoundaries` describes limits shared by the debate:

```typescript
const boundaries = {
	tokens: 20_000,
	timeMs: 60_000
};
```

`tokens` limits the total budget consumed by communication and delegated work.
`timeMs` limits the total time allowed for the debate. Cancellation propagates
to participants through `AbortSignal`, and partial results are preserved when a
participant fails or the budget is exhausted.

## Configuration

```typescript
const debate = new AgentsDebate({
	agents,
	messages: [
		{ type: "user", content: "Design a reliable caching strategy." }
	],
	mutualBoundaries: {
		tokens: 20_000,
		timeMs: 60_000
	},
	abort: controller.signal
});
```

The configuration also accepts:

- `plugins`: plugins applied to participating Raven agents.
- `memory`: shared memory for recording or retrieving debate context.
- `abort`: a caller-owned signal used to stop the debate.

Shared memory uses namespaced or append-only debate records when participants
run concurrently, preventing parallel participants from overwriting the same
mutable state.

## Method Workflows

### `chooseBestAgents(options)`

Selects and orders the participants that best match the current task.

```typescript
const selection = await debate.chooseBestAgents({
	agentsCount: 2,
	instruction: "Prefer agents with practical production experience."
});
```

How it works:

1. Read the task from the configured message history.
2. Ask the available participants to assess their suitability.
3. Compare the assessments using a debate or selection judge.
4. Return the best participants first.
5. Include a reason for every selected participant.

`agentsCount` defaults to one. Negative, zero, non-finite, or larger-than-
available values are rejected rather than silently producing an unexpected
selection.

The returned agents retain their `agentLogic`, so the result can be passed to a
subsequent execution step.

### `invokeConsultation(options)`

Uses selected participants to advise one execution agent before or during task
execution.

```typescript
const result = await debate.invokeConsultation({
	choosenExecutionAgent: "specialist",
	choosenConsultationAgents: ["workflow"],
	invokeForStages: {
		begining: true,
		betweenExecutionReasoning: false
	}
});
```

How it works:

1. Use `choosenConsultationAgents`, or select them with
   `chooseBestAgents` when the list is omitted.
2. Run consultation before execution when `begining` is enabled.
3. Provide the consultation messages to `choosenExecutionAgent`.
4. Optionally consult again between execution reasoning stages.
5. Return the execution result and consultation records.

Each consultation record preserves which agent contributed, which stage it
contributed to, the messages it produced, and when it contributed. A stage can
contain records from multiple participants.

### `invokeCritique(options)`

Runs an execution agent, asks other agents to critique its result, and uses the
critique to improve the final answer.

```typescript
const result = await debate.invokeCritique({
	choosenExecutionAgent: "specialist",
	choosenCriticqueAgents: ["workflow"],
	useDebateBeforeExecution: false
});
```

How it works:

1. Run `choosenExecutionAgent` with the task context.
2. Use the explicitly supplied critics, or select critics through debate.
3. Send the candidate answer and task to the critics, preferably in parallel.
4. Collect each critic's messages and recommendations.
5. Give the critiques back to the execution agent for revision.
6. Return the final result together with all critique records.

Critique uses an explicit maximum number of rounds and preserves failed critic
executions instead of discarding the complete result.

### `invokeHandoff(options)`

Delegates the task to one or more selected agents and uses a conclusion agent to
combine or finalize their work.

```typescript
const result = await debate.invokeHandoff({
	choosenConclusionAgent: "specialist",
	handoffToAgentsCount: 2,
	executeHandoffParallel: true,
	instructions: "Return an actionable solution with stated assumptions."
});
```

How it works:

1. Debate over the configured agents and select the best handoff candidates.
2. Select up to `handoffToAgentsCount` candidates without duplicating agents.
3. Execute them either in parallel or in sequential batches.
4. Record every completed, failed, and aborted execution.
5. Send the collected handoff results to `choosenConclusionAgent`.
6. Return the conclusion messages and final result.

`executeHandoffParallel` supports these forms:

- `true`: execute all selected agents concurrently.
- `false`: execute selected agents one at a time.
- A number: execute that many agents concurrently per batch.

The result exposes the selected agents, each handoff execution, the conclusion
agent's messages, and the final answer. Raw participant results retain their
generic type, allowing callbacks, `ReActAgent`, and graph workflows to be mixed
without losing their result data.

## Communication Model

The debate has two conceptual communication stages:

- **Before execution**: participants analyze the task and propose approaches or
  identify the best specialist.
- **Meanwhile execution**: participants exchange information between execution
  steps or reasoning rounds.

Communication includes explicit instructions and boundaries. A room, event bus,
or protocol adapter connects local participants to remote agents through A2A,
ACP, GACP, WebSockets, or another transport without changing the participant
contract.

## Error and Cancellation Expectations

A debate run:

- validates that participant names are unique;
- rejects references to unknown execution, critic, consultation, or conclusion
	agents;
- propagates `AbortSignal` to callbacks and invokable participants;
- stops starting new work after cancellation or when a shared budget is
	exhausted;
- preserves partial communication and execution records;
- normalizes thrown values to `Error` instances in result records; and
- isolates mutable participant message arrays across parallel runs.

## Relationship to Other RavenADK Utilities

`AgentsDebate` is an orchestration layer. It can use existing RavenADK pieces
for specific jobs:

- `ReActAgent` performs an agent's reasoning and tool-use loop.
- `MultipleAnswers` runs independent candidates concurrently.
- `AgenticEvaluator` can judge candidate answers or compare handoff results.
- `Graph` can provide deterministic or stateful custom workflows through a
  startable participant or an adapter callback.

Debate coordinates these utilities without duplicating their execution,
evaluation, memory, or cancellation logic.
