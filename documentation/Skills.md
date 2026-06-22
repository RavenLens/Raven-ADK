# Skills In RavenADK
RavenADK skills are designed to follow the [Agent Skills standard](https://agentskills.io/home) and can be used by agents such as ReAct.

Skills are the reusable instructions, scripts, and references your RavenADK agent can discover and apply while solving tasks.

## What You Get
- Dynamic skill creation support: agents can learn and persist new skills while interacting with users.
- Dynamic tools creation support as the scripts in `scripts` folder of the specific skill
- Skill grouping with wards: organize skills in nested folders (sub-wards) for clean discoverability.
- Pluggable storage: use local disk, MongoDB, or your own store implementation.

If you want skills to be fixed and not learned at runtime, set `dynamicSkillCreation: false` in your skills config.

## Skill Structure (Recommended)
Use a folder per skill, with `SKILL.md` as the source of truth.

```text
my-skill/
    SKILL.md
    scripts/
    references/
    assets/
    evals/
        evals.json
        files/
```

- `SKILL.md`: skill instructions and metadata.
- `scripts/`: helper scripts used by the skill.
- `references/`: supporting technical/reference material.
- `assets/`: images, templates, data files, etc.
- `evals/evals.json`: test cases used to evaluate skill quality.

## Storage Contract
All skill stores should follow [`SchemaSkillStore`](./src/agent/skills/stores/schema.ts).

### Required Store Behavior
- `discoverSkillFolder(fromLocation?)`: returns child folders/files for a location.
- `readSkillMeta(fromLocation?)`: returns only metadata/frontmatter from `SKILL.md` for fast routing.
- `readSkillFull(fromLocation?)`: returns the full `SKILL.md` content.
- `createSkillFile(skillFile, inLocation?)`: creates a new skill-related file (`skill`, `script`, `reference`, `documentation`, `assets`).
- `reloacateSkill(fromLocation, toLocation)`: relocates an existing skill folder, ward, or file subtree.

`config.session` is a scope prefix. When present, it is always applied before `root` and `fromLocation` resolution.

`config.dynamicSkillCreation` controls runtime writes. When set to `false`, runtime skill creation should be blocked by stores.

### Built-In Stores
- Local disk store: [`SkillDiskStore`](./src/agent/skills/stores/diskStore.ts)
- MongoDB store: [`SkillMongoDBStore`](./src/agent/skills/stores/mongodbStore.ts)

You can also build custom stores by implementing [`SchemaSkillStore`](./src/agent/skills/stores/schema.ts).

## Skill Discovery Types
RavenADK supports these entry types when discovering skill structure:

- Folder types: `skill-ward`, `skill`, `scripts`, `references`, `assets`
- File types: `skill`, `script`, `reference`, `documentation`, `assets`

This allows agents to quickly identify where the real skill definition lives (`SKILL.md`) and where supporting artifacts are stored.

## Manual Skill Maintenance APIs
Use these APIs when you want direct control over skill content in storage:

- `createSkillFile(skillFile, inLocation?)`
    - `skillFile.fileName`: target file name.
    - `skillFile.type`: one of `skill`, `script`, `reference`, `documentation`, `assets`.
    - `skillFile.content`: file body to store.
    - `inLocation`: optional folder override. When omitted, `skillFile.location` is used.
- `reloacateSkill(fromLocation, toLocation)`
    - Moves the skill node at `fromLocation` under `toLocation`.
    - Implementations should prevent destructive overwrites and return `false` on collisions.

## Evaluating Skill Quality (Recommended Workflow)
To validate that a skill is truly useful (and not only good on one prompt), use eval-driven iteration based on [Evaluating skill output quality](https://agentskills.io/skill-creation/evaluating-skills).

### 1. Define Test Cases
Create `evals/evals.json` in the skill directory with:
- realistic prompt
- expected output
- optional files
- assertions (after first run)

### 2. Run With And Without Skill
For each eval case, run twice:
- with the skill
- without the skill (or with previous skill snapshot)

Store outputs separately so results are comparable.

### 3. Grade Assertions
Save structured grading results (for example, `grading.json`) with explicit evidence for each pass/fail assertion.

### 4. Track Cost And Speed
Capture timing and token usage (for example, `timing.json`) and aggregate all evals into a benchmark summary.

### 5. Iterate
Use failed assertions + human review feedback to improve `SKILL.md`, rerun evals in a new iteration folder, and repeat until quality stabilizes.

## Advantages of Using Skills
- **Reuse Over Reasoning**: Reduce the need for high-reasoning LLM calls by providing verified procedural instructions.
- **Improved Consistency**: Ensure the agent follows the same steps for repeatable tasks across different sessions.
- **Enhanced Safety**: Execute complex logic in isolated sandboxes with optional Human-In-The-Loop (HITL) confirmation.
- **Dynamic Learning**: Agents can capture successful workflows and persist them as new skills for future use.
- **Zero-Dead Turns**: Skills exploration tools allow agents to find solutions without failing first.

## Automated Prompting & Discovery
When a `ReActAgent` is configured with a skill store, RavenADK automatically enhances the system prompt:
- **Available Skills Tree**: A hierarchical list of all available skills (names and descriptions) is injected at the bottom of the prompt.
- **Exploration Guidelines**: Instructions on how to use `skill_folder_discover`, `skill_meta_read`, and `skill_full_read` tools are provided.
- **Instructional Context**: The agent is encouraged to seek existing skills before inventing new approaches to non-trivial tasks.

## Safe Execution with Sandbox & HITL
RavenADK provides a robust system for executing skill-related scripts and CLI commands safely.

### Sandboxes
Scripts are executed within a `CodeExecutionSandbox`. You can use built-in sandboxes or bring your own.

#### Available Sandboxes Specification
| Sandbox | Environment | Context Isolation | Primary Use Case |
| :--- | :--- | :--- | :--- |
| **`LocalExecutionSandbox`** | Local Process | Opinionated `vm` | Running generic JS logic with common Node.js globals (`Buffer`, `process`) injected. |
| **`NodeExecutionSandbox`** | Local Process | Strict `vm` | Pure JavaScript execution where the caller provides a precise execution context. |
| **`E2BExecutionSandbox`** | Cloud Micro-VM | OS-level | Secure execution of multi-language scripts (Python, Node, Bash) in a remote environment. |

- **`LocalExecutionSandbox`**: Best for simple local tools. It automatically provides console overrides and standard Node.js utilities to the script.
- **`NodeExecutionSandbox`**: Best for RLM (Recurrent Language Models) where the agent needs a "scratchpad" to compute results using a provided data object.
- **`E2BExecutionSandbox`**: The most secure option. Recommended for untrusted code or when specific system dependencies (like specialized Python libraries) are required.
- **Custom Sandbox**: Implement the `CodeExecutionSandboxSchema` to use any execution environment.

### Human-In-The-Loop (HITL) Guardrails
If a HITL transport is provided in the `Skills` configuration, every script or CLI execution will trigger an **Acceptance Prompt**. The agent will pause and wait for the user to explicitly "Allow" or "Deny" the command execution.

## Configuration Example
Here is a complete example of setting up a `ReActAgent` with Skills, an E2B Sandbox, and Socket.io HITL.

```typescript
import { ReActAgent } from "@ravenlens/raven-adk/agent";
import { SkillDiskStore } from "@ravenlens/raven-adk/skills";
import { E2BExecutionSandbox } from "@ravenlens/raven-adk/sandboxes";
import { HITLSocketIo } from "@ravenlens/raven-adk/hitl";

// 1. Setup HITL Transport
const hitl = new HITLSocketIo({
    port: 3000,
    toolsUsage: {
        "skill_script_run": true,    // Require approval for scripts
        "skill_cli_execute": true    // Require approval for direct CLI
    }
});

// 2. Setup Sandbox
const sandbox = new E2BExecutionSandbox({ apiKey: process.env.E2B_API_KEY });

// 3. Setup Skill Storage with Sandbox and HITL
const skills = new SkillDiskStore({
    root: "./my-skills",
    dynamicSkillCreation: true,
    sandbox,
    hitl
});

// 4. Initialize Agent
const agent = new ReActAgent({
    model: myModel,
    systemPrompt: "You are a specialized developer assistant.",
    tools: [],
    skills,
    hitl
});
```

## Skill Events
The `Skills` interface emits events that can be listened to for logging, auditing, or UI updates.

| Event | Description |
| :--- | :--- |
| `readSkillFull` | Emitted when a full `SKILL.md` is read. |
| `readSkillMeta` | Emitted when skill metadata is read. |
| `discoverSkillFolder` | Emitted when skill wards or files are discovered. |
| `createSkillFile` | Emitted when a new skill file is created. |
| `runSkillScript` | Emitted when a skill script is executed (includes results). |
| `executeSkillCLI` | Emitted when a direct CLI command is executed. |
| `removeSkill` | Emitted when a particular skill is removed. |
| `reloacateSkill` | Emitted when a skill is moved. |

### Listening to Events
You can listen to these events directly via the `ReActAgent` instance:

```typescript
agent.onEvent("runSkillScript", (scriptLocation, runtime, args, result) => {
    console.log(`Script executed at ${scriptLocation}. Success: ${result.success}`);
});
```

## Practical Tips
- Keep skills focused: fewer, clear instructions outperform long rule lists.
- Write assertions that are objective and verifiable.
- Keep skill metadata in frontmatter so `readSkillMeta` can route quickly.
- Store reusable logic in `scripts/` when repeated work appears in transcripts.
