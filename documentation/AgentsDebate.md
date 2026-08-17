# Agents Debate

`AgentsDebate` coordinates structured-output agents around one task. The implemented workflows are consultation, critique, and handoff. Multi-agent agreement is evidence for a solution, not proof that the solution is correct; applications may still need a domain-specific evaluator or verifier.

## Participant Contract
Define participant as the runner of agent logic

Each `AgentDebateType` has:

- `name`: a unique participant identifier.
- `description`: the participant's role and specialization.
- `agentLogic`: a `ReActAgent` or an object implementing `invokeStructuredOutput(schema, options)`.
- `tokenizer`: a function used for token-boundary accounting.
- `debateBoundary`: optional per-agent token, time, and round limits.

Use ready participants
- Use ReActAgent
or define your own participant

Participants return the structured `DebateAgentResponse` protocol for workflow execution:

```typescript
{
  participate: boolean;
  continueConversation: boolean;
  messages: MessagesVariations[];
}
```

`invokeDebateAgent` can also invoke a participant with any caller-supplied Zod schema and returns the validated structured value.

## Configuration

```typescript
const debate = new AgentsDebate({
  agents,
  messages: [
    { type: "user", content: "Design a reliable caching strategy." }
  ],
  debateMutualBoundaries: {
    tokens: 20_000,
    timeMs: 60_000,
    maxRounds: 2
  },
  abort: controller.signal
});
```

`AgentsDebateConfig` also accepts `plugins` and shared `memory`. The `messages` array is the task context; workflow stages append to independent copies and do not intentionally mutate the caller's original history.

`debateMutualBoundaries` limits are shared across the debate configuration. `tokens` accounts for communication text using each participant's tokenizer. `timeMs` limits participant execution. `maxRounds` limits debate rounds. Per-agent boundaries cannot exceed the corresponding mutual boundary.

## Available Methods

### `invokeDebateAgent(agentLogic, schema, options)`

Invokes one participant with a message history and optional `AbortSignal`, then validates the response with the supplied Zod schema. For `ReActAgent`, its temporary message context is restored after invocation.

### `invokeConsultation(options)`

Uses explicitly named consultation agents to advise an execution agent. Automatic selection is not currently implemented, so `choosenConsultationAgents` is required.

```typescript
const result = await debate.invokeConsultation({
  choosenExecutionAgent: "specialist",
  choosenConsultationAgents: ["reviewer"],
  invokeForStages: {
    begining: true,
    betweenExecutionReasoning: false
  },
  loopsCount: 1
});
```

The workflow:

1. Validates the execution and consultation agent names.
2. Runs a consultation debate before execution unless `begining` is `false`.
3. Passes consultation messages to the execution agent.
4. Optionally runs a second consultation between execution stages.
5. Repeats the process for `loopsCount` iterations.

The result contains `consultation.begining` and `consultation.betweenExecutionReasoning` records, `choosenAgentResult` with the execution agent's complete message history, and `result` with its final `AIMessage`.

### `invokeCritique(options)`

Runs an execution agent, asks explicitly named critics to review the candidate, and gives the critiques back to the execution agent for revision.

```typescript
const result = await debate.invokeCritique({
  choosenExecutionAgent: "specialist",
  choosenCriticqueAgents: ["reviewer"],
  useDebateBeforeExecution: false,
  loopsCount: 1
});
```

`choosenCriticqueAgents` is currently required because automatic critic selection is not implemented. The result contains `agentsCritique`, the final `result`, and the execution message history returned as `executionMessages`. Critique failures are not silently converted into successful results by the workflow.

### `invokeHandoff(options)`

Scores eligible agents, delegates the task to the highest-scoring candidates, and asks a conclusion agent to combine their outputs.

```typescript
const result = await debate.invokeHandoff({
  choosenConclusionAgent: "conclusion",
  handoffToAgentsCount: 2,
  executeHandoffParallel: 2,
  handoffInstructions: "Return an actionable solution with assumptions."
});
```

The conclusion agent is excluded from handoff candidates. Candidate agents are asked for a finite numeric `score` and a `reason`; candidates are ordered by descending score, with configured order retained for ties.

`handoffToAgentsCount` defaults to one and is capped at the number of eligible agents. `executeHandoffParallel` controls execution concurrency:

- `true`: run all selected agents concurrently.
- `false` or omitted: use the default full selected batch.
- A positive number: run that many selected agents per batch.

The result contains:

- `selectedAgents`: selected participants with their selection reasons.
- `handoffExecutions`: every attempted execution, with `completed`, `failed`, or `aborted` status, batch number, result, and normalized error when present.
- `conclusionMessages`: the conclusion agent's complete response messages.
- `result`: the final conclusion `AIMessage`.

## Events

`AgentsDebate` exposes a typed event map through `onEvent` and `emitEvent`, following the event-listener pattern used by `ReActAgent`. Event names use lowercase snake_case notation.

```typescript
debate.onEvent("consultation_start", options => {
  console.log("consultation started", options.choosenExecutionAgent);
});

debate.onEvent("consultation_loop_end", event => {
  console.log("consultation loop", event.loop + 1, "messages", event.messages);
});

debate.onEvent("consultation_end", result => {
  console.log("consultation completed", result?.result.content);
});

debate.onEvent("consultation_error", error => {
  console.error("consultation failed", error);
});
```

The event map is exported as `AgentsDebateEvents`. The public workflow lifecycle events are:

- `debate_agent_start(agentLogic, schema, options)`
- `debate_agent_end(result)`
- `debate_agent_error(error)`
- `consultation_start(options)`
- `consultation_end(result)`
- `consultation_error(error)`
- `critique_start(options)`
- `critique_end(result)`
- `critique_error(error)`
- `handoff_start(options)`
- `handoff_end(result)`
- `handoff_error(error)`
- `conclusion_start(messages)`
- `conclusion_end(messages)`
- `conclusion_error(error, messages)`

Loop events are emitted for every debate round, consultation loop, critique loop, and handoff execution batch:

- `debate_loop_start`, `debate_loop_end`, `debate_loop_error`
- `consultation_loop_start`, `consultation_loop_end`, `consultation_loop_error`
- `critique_loop_start`, `critique_loop_end`, `critique_loop_error`
- `handoff_loop_start`, `handoff_loop_end`, `handoff_loop_error`

Each loop start/end event receives `{ loop, loops_count, messages }`. `loop` is zero-based, `loops_count` is the total expected number of loops, and `messages` contains the messages entering or produced by that loop. Loop errors add `reason`, containing the normalized failure message. Handoff loop errors can represent a failed participant while the overall handoff continues with the recorded failure.

`onEvent` accepts one listener for each event name and returns the `AgentsDebate` instance for chaining. Registering a second listener for the same name leaves the first listener in place. Event listeners may be synchronous or asynchronous; listener execution is scheduled independently and listener failures are reported as warnings without changing the workflow result. Workflow errors still emit their error event and are rethrown to the caller.

## Communication And Cancellation

Consultation and debate stages preserve participant names, messages, and timestamps in communication records. `AbortSignal` is passed to structured participants, prevents new handoff work after cancellation, and marks skipped handoffs as `aborted`. Participant failures are normalized to `Error` objects in handoff execution records.

## Related Utilities

`AgentsDebate` is an orchestration layer. It can use:

- `ReActAgent` for model reasoning and tool use.
- `AgenticEvaluator` elsewhere in an application for judging results.
- Custom structured participants for deterministic or remote workflows.
