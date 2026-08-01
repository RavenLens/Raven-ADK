# Self-Improvement in RavenADK

RavenADK implements advanced agentic patterns that allow models to improve their own performance, expand their capabilities, and consolidate knowledge over time.

## CASCADE Pattern (Self-Developed Expertise)

RavenADK follows the **CASCADE** pattern ([arXiv:2512.23880](https://arxiv.org/abs/2512.23880)), which enables agents to develop their own expertise. Instead of relying solely on a fixed set of tools, the agent can:

* **Discover** gaps in its current capabilities.
* **Create** new skills (structured instructions and scripts) to handle repeatable tasks.
* **Refine** and relocate existing skills to optimize its "knowledge base."

In the `ReActAgent`, this is represented by the agent's ability to use skill management tools to build a library of reusable know-how.

## Dynamic Skill Auto-Creation

The Skill system in RavenADK can be configured to allow the agent to manage its own skill library. When `dynamicSkillCreation` is enabled, the agent gains access to tools that let it create folders and files compatible with the [Open Skills standard](https://agentskills.io/home).

### How it works

The `Skills` class manages the prompt and tool definitions for skill creation. Here is how the dynamic skill creation is configured and exposed to the agent:

```typescript
// From src/agent/skills/skills.ts

export interface SkillSharedConfig {
    /**
     * Allows the agent to create new skills during execution
    */
    dynamicSkillCreation?: boolean;
    /**
     * Allow to dynamically remove the skill(s)
     */
    dynamicSkillRemoval?: boolean;
    /**
     * Skill relocation
    */
    dynamicSkillRelocation?: boolean;
    // ...
}

// ... inside Skills class
if (this.config.dynamicSkillCreation) {
    promptLines.push(
        "When creation is allowed (strict gate):",
        "- Create a skill only after exploration confirms no same or meaningfully similar skill already exists.",
        "- Create a skill only after the agent has developed or validated a reusable process during the current task.",
        "- Do not create speculative, empty, or duplicate skills.",
        ""
    );
}
```

When enabled, the agent can call `skill_folder_create` and `skill_file_create` to persist new reasoning patterns or code scripts for future use.

## Memory-Driven Improvement

RavenADK uses a sophisticated memory system that goes beyond simple key-value storage. It enables self-improvement through two primary mechanisms:

### 1. Long-Term Record Management

Agents use `fetch_memory` (semantic search) and `save_memory` to store and retrieve durable facts, user preferences, and important decisions. This allows the agent to "learn" from past interactions and avoid repeating mistakes or asking the same questions.

### 2. Memory Conclusion (Recursive Consolidation)

A unique feature of RavenADK is the **Memory Conclusion**.

* **The Loop**: At the beginning of a session, a condensed "conclusion" of all historical memory (max 2048 words) is injected into the system prompt.
* **Self-Update**: At the end of an interaction, the agent (or a specialized sub-agent) reviews the transcript and the old conclusion to produce a new, consolidated conclusion.
* **Improvement**: This process allows the agent to remember "more" by abstracting specific interactions into general principles and facts, effectively increasing the density of its knowledge without hitting context limits.

By combining **Skills** (procedural knowledge) and **Memory** (declarative knowledge), RavenADK agents continuously evolve to become more efficient and specialized for better accuracy.

***

_For more technical details, see the_ [_Skills_](https://github.com/RavenLens/Raven-ADK/blob/main/src/agent/skills/skills.ts) _and_ [_Memory_](https://github.com/RavenLens/Raven-ADK/blob/main/src/agent/memory/memory.ts) _implementations._
