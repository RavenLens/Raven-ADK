# RLM (Recurrent Language Models)

## Overview

**RLM (Recurrent Language Models)** is a powerful agent pattern that enables efficient processing of large, complex datasets by using an orchestrator LLM to write and execute code that progressively analyzes data through recursive delegation to smaller, more cost-effective sub-models.

> RLM Drastically Improves a cost-efficiency ratio for your application reducing the problems of SOTA LLMs such as: Positioning Errors e.g: Lost-in-the-middle
![](./images/RLM%20performance.png)

RLM implements the **CodeAct pattern** ([learn more](https://learn.microsoft.com/en-us/agent-framework/agents/code_act?pivots=programming-language-csharp)), where:
1. An orchestrator LLM **writes executable code** to explore data
2. The code runs in a **secure sandbox** with access to the dataset
3. When detailed analysis is needed, code **recursively delegates** to sub-models
4. Results feed back to the orchestrator for the next iteration

This approach dramatically **reduces token costs** and **improves latency** when working with massive datasets that would otherwise overwhelm a single model's context window.

## Key Benefits

- **Cost Efficiency**: Use expensive large models (GPT-4, Claude) only for orchestration; delegate analysis to cheaper models (GPT-3.5, Claude-Instant)
- **Context Handling**: Process gigabytes of data without hitting context limits
- **Recursive Analysis**: Delegate sub-tasks to specialized models
- **Transparent Execution**: Monitor code execution, reasoning steps, and model calls via events
- **Iterative Refinement**: Orchestrator learns from execution results and refines strategy

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     RLM Orchestrator                        │
│  (Expensive LLM: GPT-4, Claude 3.5-Sonnet, etc.)           │
│  - Writes JavaScript code to explore data                  │
│  - Decides when to delegate to sub-models                  │
│  - Interprets execution results                            │
│  - Plans next iteration or finalizes answer                │
└─────────────────────────────────────────────────────────────┘
                           │
                 ┌─────────┴─────────┐
                 │                   │
        ┌────────▼────────┐  ┌───────▼────────┐
        │ RLM Environment │  │  Sub-Models    │
        │                │  │  (CodeAct)     │
        │ - Sandbox exec │  │                │
        │ - contextData  │  │ GPT-3.5,       │
        │ - llmQuery()   │  │ Claude-Instant │
        │ - console.log()│  │ Specialized    │
        └─────────────────┘  │ Models         │
                             └────────────────┘
```

## Installation & Setup

```typescript
import { RLMAgent, RLMContextEnvironment } from "@ravenlens/raven-adk/agent";
import { NodeJSSandbox } from "@ravenlens/raven-adk/tools/CodeExecutionSandboxes";
import { OpenAI } from "@ravenlens/raven-adk/models";
```

## Basic Usage: RLM Standalone

Use RLM when you have a large dataset and need to extract structured information through iterative analysis.

### Example 1: Analyzing Large Log Files

```typescript
import { RLMAgent } from "@ravenlens/raven-adk/agent";
import { NodeJSSandbox } from "@ravenlens/raven-adk/tools/CodeExecutionSandboxes";
import { OpenAI } from "@ravenlens/raven-adk/models";

// Load a massive log file (e.g., 10MB+ of server logs)
const hugeLogData = await fs.readFile("./logs/production.log", "utf-8");

// Initialize RLM with orchestrator and sub-models
const rlmAgent = new RLMAgent(hugeLogData, {
    model: new OpenAI({
        model: "gpt-5.5",  // Orchestrator: expensive, powerful
        apiKey: process.env.OPENAI_API_KEY
    }),
    submodels: [
        {
            model: new OpenAI({
                model: "gpt-5.5-mini",  // Sub-model 1: fast, cheap
                apiKey: process.env.OPENAI_API_KEY
            }),
            instruction: "Extract error messages and their frequency"
        },
        {
            model: new OpenAI({
                model: "gemini-3.5-flash-preview",  // Sub-model 2: reusable
                apiKey: process.env.OPENAI_API_KEY
            }),
            instruction: "Identify performance anomalies and latency issues"
        }
    ],
    maxIterations: 10,
    codeSandbox: new NodeJSSandbox()
});

// Listen to events
rlmAgent.onEvent("start_iteration", (iterNum) => {
    console.log(`▶ Iteration ${iterNum} started...`);
});

rlmAgent.onEvent("orchestrator_model_call", (model, result) => {
    console.log(`📝 Orchestrator decided:`, result.substring(0, 100) + "...");
});

rlmAgent.onEvent("execute_code_start", (code) => {
    console.log(`🔧 Executing code:\n${code.substring(0, 200)}...`);
});

rlmAgent.onEvent("submodel_call", (model, task) => {
    console.log(`🤖 Delegating to sub-model: ${task.substring(0, 80)}...`);
});

// Run the analysis
const result = await rlmAgent.invoke(
    "Analyze the logs and provide: 1) Top 5 error types, 2) Error frequency trend, 3) Performance bottlenecks"
);

console.log("✅ Final Analysis:\n", result);

// Get token usage for cost calculation
const usage = rlmAgent.getUsage();
console.log("📊 Token Usage:", {
    orchestrator: usage.orchestrator_llm,
    submodels: usage.submodels
});
```

**Key Points:**
- The orchestrator LLM **writes code** to search, filter, and analyze logs
- Code executes in the **secure sandbox** with full `contextData` access
- When pattern matching is needed, it **delegates to sub-models** via `llmQuery()`
- Sub-models provide faster/cheaper analysis for specific tasks
- **Iterations** allow the orchestrator to refine its approach based on results

### Example 2: Extracting Data from Large JSON

```typescript
import { RLMAgent } from "@ravenlens/raven-adk/agent";
import { NodeJSSandbox } from "@ravenlens/raven-adk/tools/CodeExecutionSandboxes";
import { OpenAI } from "@ravenlens/raven-adk/models";

// Example: 500MB of user behavior data
const userDataJSON = JSON.stringify(loadUserBehaviorData()); // Very large

const rlmAgent = new RLMAgent(userDataJSON, {
    model: new OpenAI({ model: "gpt-4", apiKey: process.env.OPENAI_API_KEY }),
    submodels: [
        {
            model: new OpenAI({
                model: "gpt-3.5-turbo",
                apiKey: process.env.OPENAI_API_KEY
            }),
            instruction: "Classify user segments based on behavior patterns"
        }
    ],
    maxIterations: 5,
    codeSandbox: new NodeJSSandbox()
});

const result = await rlmAgent.invoke(
    "Find users with purchase patterns indicating high lifetime value (LTV). Return top 100 user IDs with their LTV score."
);

console.log(result);
```

## Advanced Usage: RLM + ReAct Agent

Combine RLM with ReAct Agent to solve complex, multi-step problems that require both large data processing AND external tool usage.

### Example 3: Combine RLM for Data Analysis + ReAct for Actions
RLM goes first to analyse the large file, ReAct agent follows the RLM outcomes for performing logical `Reaconing + Acting` ***for a wise management of workflow*** 

```typescript
import { RLMAgent } from "@ravenlens/raven-adk/agent";
import { ReActAgent } from "@ravenlens/raven-adk/agent";
import { NodeJSSandbox } from "@ravenlens/raven-adk/tools/CodeExecutionSandboxes";
import { OpenAI } from "@ravenlens/raven-adk/models";

// Step 1: Use RLM to analyze massive dataset
const analyzeDataWithRLM = async (largeDataset: string) => {
    const rlmAgent = new RLMAgent(largeDataset, {
        model: new OpenAI({ model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY }),
        submodels: [
            {
                model: new OpenAI({
                    model: "gpt-3.5-turbo",
                    apiKey: process.env.OPENAI_API_KEY
                }),
                instruction: "Extract key metrics and anomalies"
            }
        ],
        maxIterations: 5,
        codeSandbox: new NodeJSSandbox()
    });

    return await rlmAgent.invoke(
        "Identify critical issues and generate a summary with recommended actions"
    );
};

// Step 2: Use ReAct Agent to act on RLM findings
const actOnFindings = async (rlmAnalysis: string) => {
    const reactAgent = new ReActAgent({
        model: new OpenAI({
            model: "gpt-4o",
            apiKey: process.env.OPENAI_API_KEY
        }),
        systemPrompt: "You are an operations agent that takes action on data analysis findings.",
        messages: [
            {
                type: "user",
                content: `Based on this data analysis:\n\n${rlmAnalysis}\n\nTake appropriate actions: create alerts, notify teams, schedule maintenance, etc.`
            }
        ],
        tools: [
            {
                name: "create_alert",
                description: "Create a system alert for the operations team",
                execute: async (params) => {
                    // Your alert creation logic
                    return `Alert created: ${params.message}`;
                }
            },
            {
                name: "notify_slack",
                description: "Send notification to Slack channel",
                execute: async (params) => {
                    // Your Slack notification logic
                    return `Notification sent to #${params.channel}`;
                }
            }
        ]
    });

    return await reactAgent.invoke();
};

// Orchestrate the full workflow
const orchestrateWorkflow = async () => {
    // Step 1: RLM analyzes massive data efficiently
    console.log("📊 Starting data analysis with RLM...");
    const analysis = await analyzeDataWithRLM(loadHugeDateset());
    console.log("✅ Analysis complete:\n", analysis);

    // Step 2: ReAct Agent acts on the findings
    console.log("\n🎯 Starting action execution with ReAct...");
    const actions = await actOnFindings(analysis);
    console.log("✅ Actions taken:\n", actions.messages.at(-1)?.content);
};

await orchestrateWorkflow();
```

### Example 4: RLM Preprocessing + ReAct Agent Reasoning

```typescript
import { RLMAgent, ReActAgent } from "@ravenlens/raven-adk/agent";
import { NodeJSSandbox } from "@ravenlens/raven-adk/tools/CodeExecutionSandboxes";
import { OpenAI } from "@ravenlens/raven-adk/models";

// Scenario: Answer complex questions over enormous search results
async function answerComplexQueryOverLargeDataset(query: string, searchResults: string) {
    // Step 1: Use RLM to filter and preprocess 10,000+ search results down to top 50
    const rlmAgent = new RLMAgent(searchResults, {
        model: new OpenAI({ model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY }),
        submodels: [
            {
                model: new OpenAI({
                    model: "gpt-3.5-turbo",
                    apiKey: process.env.OPENAI_API_KEY
                }),
                instruction: "Rank search results by relevance to the query"
            }
        ],
        maxIterations: 3,
        codeSandbox: new NodeJSSandbox()
    });

    const relevantResults = await rlmAgent.invoke(
        `Filter and rank search results for query: "${query}". Return top 50 most relevant results with rank scores.`
    );

    // Step 2: Use ReAct Agent to synthesize answer from filtered results + fetch additional context
    const reactAgent = new ReActAgent({
        model: new OpenAI({ model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY }),
        systemPrompt: "You are an expert research assistant.",
        messages: [
            {
                type: "user",
                content: `Based on these filtered search results:\n\n${relevantResults}\n\nAnswer the query: ${query}`
            }
        ],
        tools: [
            {
                name: "fetch_full_article",
                description: "Fetch the full text of an article for deeper analysis",
                execute: async (params) => {
                    // Fetch full article content
                    return "Full article content...";
                }
            }
        ]
    });

    const answer = await reactAgent.invoke();
    return answer.messages.at(-1)?.content;
}

// Usage
const result = await answerComplexQueryOverLargeDataset(
    "What are the latest advances in quantum computing?",
    hugeSearchResults // Could be 100MB+
);
```

## Case Studies

### Case Study 1: Log Analysis Pipeline

**Problem:**
- 500MB production logs daily
- Need to identify errors and performance issues
- Using GPT-4 directly would cost ~$50-100 per analysis
- Context window limitations prevent analyzing full logs

**Solution with RLM:**
- Orchestrator (GPT-4o): Writes code to scan logs, decide which patterns need analysis
- Sub-models (GPT-3.5-turbo): Analyze specific error categories, performance metrics
- Result: **90% cost reduction**, processes full logs in <2 minutes

**Token Cost Comparison:**
```
Traditional: 200K tokens × $0.015/1K = $3 per log file
RLM Approach:
  - Orchestrator: 50K tokens × $0.015/1K = $0.75
  - Sub-models (3 calls): 30K tokens × $0.0005/1K = $0.015
  - Total: $0.765 per log file (~75% savings!)
```

### Case Study 2: Customer Data Segmentation

**Problem:**
- 1 million customer records (database dump)
- Need behavioral segmentation for marketing campaigns
- Can't load full dataset into API requests
- Need fast turnaround for campaign timing

**Solution with RLM:**
- Orchestrator: Reads records in chunks, identifies patterns, delegates classification
- Sub-models: Classify customers into segments using domain-specific rules
- Iterative refinement: Orchestrator learns what works and refines approach
- Result: **65% faster** than sequential API calls, **80% cheaper**

### Case Study 3: Document Review & Risk Assessment

**Problem:**
- 10,000 contracts needing risk assessment
- Each contract 20-50 pages
- Legal review is complex (not just keyword matching)
- Can't use context-limited models effectively

**Solution with RLM:**
- Orchestrator (Claude 3.5-Sonnet): Writes code to extract sections, identify high-risk patterns
- Sub-models (GPT-3.5-turbo): Perform detailed risk scoring on specific sections
- Result: **Process all 10K contracts in 2 hours**, costs ~$150-200

## Event Monitoring

RLM emits detailed events for visibility into the reasoning process:

```typescript
rlmAgent
    .onEvent("start_iteration", (iterNum) => {
        console.log(`Iteration ${iterNum}`);
    })
    .onEvent("orchestrator_model_call", (model, result) => {
        // Orchestrator generated code
        console.log("Orchestrator decided:", result);
    })
    .onEvent("execute_code_start", (code) => {
        // Code execution starting
        console.log("Running code...", code);
    })
    .onEvent("execute_code_end", (output) => {
        // Code execution result
        console.log("Code output:", output);
    })
    .onEvent("submodel_call", (model, task) => {
        // Sub-model delegation
        console.log("Delegating to sub-model:", task);
    })
    .onEvent("end_iteration", (iterNum, result) => {
        // Iteration complete
        console.log(`Iteration ${iterNum} complete - Finished:`, result.isFinish);
    })
    .onEvent("finish", (result) => {
        // Task complete
        console.log("Final answer:", result);
    });
```

## Performance Optimization Tips

1. **Choose Sub-Models Wisely**
   - Use specialized models for specific tasks (e.g., JSON parsing, classification)
   - Align sub-model cost/speed with the frequency they're called

2. **Limit Context Chunking**
   - Extract relevant sections before RLM processing
   - Use preprocessing to reduce dataset size

3. **Tune maxIterations**
   - Too low: Orchestrator can't refine its approach
   - Too high: Unnecessary API calls and latency
   - Typical: 3-10 iterations

4. **Monitor Token Usage**
   - Use `rlmAgent.getUsage()` to track orchestrator vs. sub-model tokens
   - Adjust model selection based on actual usage patterns

## Best Practices

- ✅ Use RLM for **large dataset processing** (100MB+)
- ✅ Combine with ReAct Agent for **complex workflows**
- ✅ Use cheaper sub-models for **repetitive analysis tasks**
- ✅ Monitor events for **debugging and optimization**
- ❌ Don't use RLM for **simple, single-step queries**
- ❌ Don't forget to implement **error handling** in generated code
- ❌ Don't use expensive models for **all sub-models** (defeats cost reduction)