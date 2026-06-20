# Subagents
Subagents is the list of agents can be delegated to perform some specific task. Treat subagents as experts will be delegated to do some specifc task matches to their `role` and `roleDescription`. These agents carries specific definition.

> ***Subagents*** in **RavenADK** are defined as separate concept from tools. What makes them clearly more performant

## Subagent Work Description
1. Subagents are made to perform some very specific task(s) by having specific: `role`, `roleDescription`, `systemPrompt`, `model` and `tools`
2. Subagents inherits from the parent agent: 
    - `memory` - Subagents can read and write to same memory has the parental agent access to
    - `skills` - Subagents have access to same skills definition as the paranetal agent
    - `htil` transport configuration and hitl tools - so main hitl has to get specified `hitl` tools from subagent if these have to get hitl ***agreement ask*** before beeing invoked
3. **Optimized Execution**: When a subagent is called by a parent agent, it automatically runs with `withConclusion: false`. The parent agent acts as the orchestrator and produces the final summary once all subagents have finished.

## Parallel Execution
The `ReActAgent` supports parallel subagent execution. By setting `parallelizeSubagents: true` in the agent configuration, the agent can call multiple experts at once to solve different parts of a problem simultaneously.

### Delegation Protocol
The agent delegates tasks to subagents using the following internal syntax:
`[[RAVEN_CALL_SUBAGENT]] <Role> | <Detailed instruction>`

When parallelization is enabled, the agent can include multiple such lines in a single response.

## ReAct Agent
Add the subagents to the `ReActAgent` by giving the `subagents` field

```typescript
    import { ReActAgent } from "@ravenlens/raven-adk/agents";
    import { OpenAI, Anthropic } from "@ravenlens/raven-adk/models";

    const reactAgent = new ReActAgent({
        model: new OpenAI({
            model: "gpt-5.5",
            reasoningEffort: "xhigh",
            apiKey: "your-api-key",
        }),
        systemPrompt: `Your system prompt`,
        messages: [
            {
                type: "user",
                content: "Check the weather condition"
            }
        ],
        // Enable parallel subagents for faster execution
        parallelizeSubagents: true,
        // Optional: Specify your subagents here
        subagents: [
            {
                role: "actor",
                roleDescritpion: "You're the professional Hollywood actor",
                systemPrompt: `...Agent System Prompt`,
                model: new Anthropic({
                    model: "claude-sonnet-4-6"
                    apiKey: "your-api-key",
                    thinking: {
                        type: "enabled",
                        budget_tokens: 10_000,
                        display: "summarized"
                    },
                    max_tokens: 16_000
                }),
                // Optional list with tools,
                tools: []
            },
            // ... Define more subagents below
        ]
    });
```
