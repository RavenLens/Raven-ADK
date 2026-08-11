# Workflows

A workflow is an executable definition of how work moves through a set of steps, how those steps exchange state, and when execution finishes.

## Workflows
RavenADK provides two main execution formats for building workflows

- Use a [`Graph`](./Graph.md) when work needs task delegation back and forth, branching, fan-out or fan-in, or state that is kept and updated across delegations.
- Use a [`SequentialRunner`](./SequentialRunner.md) when every step executes in a fixed sequence and each step consumes the result of the previous step.

> Agents can be embedded in either format. An agent is a workflow step: in a graph it can be the logic for a node, and in a sequential workflow it can be one of the runners.

## Graph Workflows

Choose a graph when the workflow's control flow is dynamic. Nodes can delegate to other nodes with `callNode`, edges can branch to multiple tasks, and every node can update the shared graph state. This makes `Graph` useful for workflows where agents hand tasks back and forth, revisit an earlier task, or coordinate parallel branches.

### Executing a Graph Workflow

The following workflow sends a request to a planner, delegates the planned work to an executor, and stores each result in the shared state. The planner can delegate back to itself when it needs another planning pass.

```typescript
import { Graph, GraphMarkers } from "@ravenlens/raven-adk";

type WorkflowState = {
	request: string;
	plan?: string;
	result?: string;
};

const graph = new Graph<WorkflowState>({
	request: "Prepare a release checklist",
});

graph
	.addNode("planner", async (state) => {
		const plan = await createPlan(state.request, state.plan);

		if (plan.needsAnotherPass) {
			return {
				stateUpdate: { ...state, plan: plan.text },
				callNode: "planner",
			};
		}

		return {
			stateUpdate: { ...state, plan: plan.text },
		};
	})
	.addNode("executor", async (state) => ({
		stateUpdate: {
			...state,
			result: await executePlan(state.plan!),
		},
	}))
	.addEdge(GraphMarkers.START, "planner")
	.addEdge("planner", "executor")
	.addEdge("executor", GraphMarkers.END);

// Start execution and read the final shared state.
await graph.start();
const finalState = graph.getState();
```

`Graph` is also suited to multi-agent delegation. Add an agent-backed function as a node, return its output through `stateUpdate`, and connect that node to the next task. A node may use `callNode` to delegate to one node or several nodes before control returns to the original flow.

## Sequential Workflows

Choose a sequential workflow when the order is the workflow. `SequentialRunner` passes each runner's operational object to the next runner, so the output of one step becomes the input for the following step. It also supports separate retry limits for thrown errors and functional failures (`success: false`).

### Executing a Sequential Workflow

Each item in the runner list contains an identifier and an async function. An agent can be embedded exactly like any other step by invoking it inside a runner and returning its output as the next state.

```typescript
import { SequentialRunner } from "@ravenlens/raven-adk";

const workflow = new SequentialRunner([
	["research", async () => ({
		success: true,
		state: await collectReleaseChanges(),
	})],
	["review-agent", async (prior) => {
		const review = await reviewAgent.invoke({
			changes: prior?.state,
		});

		return {
			success: true,
			state: review,
		};
	}],
	["publish", async (prior) => {
		if (!prior?.state) {
			return {
				success: false,
				args: { reason: "The review did not produce a result" },
				state: undefined,
			};
		}

		await publishChecklist(prior.state);
		return { success: true, state: "published" };
	}],
], {
	error: 1,
	failure: 2,
});

workflow.onEvent("rollback", (id, type, count) => {
	console.log(`Retrying ${id} after ${type}; attempt ${count}`);
});

// Start execution and read the final runner result.
const finalResult = await workflow.invoke();
```

In this format, `reviewAgent` can be a RavenADK agent such as a `ReActAgent`, initialized with the model and tools required by the application. The runner only needs the agent's invocation to return a value that can be placed in the next runner's `state`.

## Choosing an Execution Format

Use [`Graph`](./Graph.md) for delegation-oriented workflows: conditional routing, loops, shared mutable state, and multiple tasks that coordinate with one another. Use [`SequentialRunner`](./SequentialRunner.md) for pipeline-oriented workflows: a known order, state passed from step to step, and retries isolated to the failing step.
