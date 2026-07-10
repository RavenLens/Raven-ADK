# Workflow
You can establish AI-Workflow with usage of specified RavenADK features:

## Possibilities
### 1. [Graph (Click to check more)](./Graph.md)
Use Graph to compose complex interactions. Share states among `nodes` and establish connections with `edges`.

### 2. [Sequential Runner (Click to check more)](./SequentialRunner.md)
Use as simplifier to make actions will run in sequence one after another

### 3. [ReAct Agent (Click to check more)](./ReAct-Agent.md)
Use to construct workflows demands Reasoning and Acting for objective tracking and accomplishement

### 4. [MultipleAnswers (Click to check mode)](./Multiple-Answers.md)
Use to construct flows where multiple models will answer to same question/task and choose the best result or pick one is the best with usage of sepearte LLM-as-a-judge with `getBest()` method

## Obseravibility
Take advantage of [OpenTelemetry](./Telemetry.md) to monitor workflow performanance along each step with backend agnostic apporach. You can leverage any OLTP provider e.g: Jaeger, **RavenHub** or your own/preferred

## Conclusion
RavenADK is a realm for your AI-driven Workflow, no matter whether you need to implement this for youreself, your mvp or for application is used by millions of users a day
