1. Graph that supports: (done)
    - Execution (v)
        - Synchronous (v)
        - Asynchronous (v)
    - State - each node modifies state (v)
    - Events - each node execution has to be comunicated as the event (v)
        - node_start (v)
        - node_end (v)
        - node_state_change - when state has been changed (v)
2. Agents built as default as:
    - ReAct Agent
        Gives support to:
        - System prompt - overall specification what has agent todo -> specified by the user - we give some wrapper atop of what user says (v)
        - User prompt - the task given to agent todo (v)
        - Multi-agents execution (v)
        - Events Producing (v)
        - GACP - Graph Agent communication protocol - communicate bevies of agents on graph
            - Build RavenLens platform atop of that
        - MCP (Model Context Protocol) - support from the fround point (v)
        - A2A - agent communication protocol support for bevies of agents
        - ACP - agent communication protocol support for bevies of agents
        - Skills - explore and optionally create skills (when `creation: true`) -> (v) -> done as the separate class
        - Tools - v
            - Calling:
                - Local Tools calling
                - Remote tools calling - to support the tools
            - HITL - tool breaks all agents execution till use will give the answer - (v)
                - Has modes: - v
                    - A/B - user selects option - v
                    - Open - user types his answer - v
                - Has waiting period to be setup as optional option - when given llm will ignore prior given task - v
3. LLMs support (done)
    - Give standalone RunPod support to execute open-source models (v)
    - Support OpenAI (v)
4. Chat messages support - remembers chat messages (v)
    - User prompt (v)
    - AI Answer (v)
    - Tool usage (v)
5. Tests for  (v)
    - ReAct Agent (v)
        - Skills (v)
        - Memory (v)
6. Improve Skills
    - Give instruction what skill is valulable to the `SkillSharedConfig`
    - Make the system to evaluate whether skill ReAct Agent would like to create is what the `instruction` for skill appreciates when specified, when not specified whether is this skill greate and whether does the similar same skill exists
7. Add support for the:
    - Google models - with Gemini models (v)
    - Compressing standards
        - Make documentation for this
        - Implement the methods:
            - Compressing (v)
            - Storing aside of agent
    - Playwright support tools for browsing (v)
        - Make the screens (v)
        - Read the webpage text (v)
        - Add AutoClose plugin & Documentation (v)
        - Don't save snapshot on disk file as default but let a model to handle this instead (v)
    - Add concept of plugins to ReAct agent and:
        - make them executable according to place (v)
        - Make ReAct Agent places invoke - invoke from place from where agent has to be executed (v)
        - Add AutoClose plugin to browser tools (v)
            - Add to logic (v)
            - Add to documentation (v)
        - Deliver more execution places and make compression so called "compaction" to be compatible
    - Add support for media in the message (v)
        - Images (v)
    - Add skills and memory improvement (Hermes inspired)
        - Create tree with skills, memory concluded as file with constrained (hard limit) size and added to each prompt
            - Instruct agent to use its tools to explote these skills / memory as needed base on prompt
            - Above that skills and memory has to include some conclusions of the most important informations to reduce tokens usage
            - This gives model instantenous awareness about how to use a skill/memory and more awareness
    - Coding Sandboxes support like - ship these as tools that allow agent to execute some tools and scripts
        - https://www.daytona.io/
        - local
        - https://vercel.com/docs/sandbox
    - RLMs - Add support for improving the performance (v)
    - InfyAgent - Offloading the context to external files and reading the last 10 files and rest to read on demand with regexp, sequence read tools and more, delegate subtasks to be done by subagents for better overall agent results (v)
7. Agentic RAG support
    - For typical chatting with ai
    - For [ReAct Agent](./documentation/ReAct-Agent.md)
8. Benchmarking framework - show the benchmarks base on all runns for:
    - Ai llm classes e.g: OpenAI, Anthropic
    - For specified model - it evaluates each specific model
    - ReAct Agent - evaluates the react agent
        - Tool calls
        - Time
        - Skills
        and more
8.5. Connect with Hermes Agent
9. Prebuilt tools
    - Network search for:
        - local - the exploration for desktop apps with playwright
        - remote - usage of the remote tools for exploration
10. AJudge (Agentic Judgement)
11. Help for Voice
    - Prompting in voice - (Input voice)
    - Outputing in voice (Output voice)
    - Talking in voice - (Input + Voice) in real time
12. Compaction Chat History (v)
    - i automatic (v)
    - for LLM Class
    - for ReAct Agent (v)
13. RavenHub
14. TODO tools and events
    - ReAct agent once executes todo tool communicates the updation state and events base on this tools
15. Add OpenRouter support as LLMs handler that will give hand for LLMs
16. Frontend Libraries
    - Add Svelte ui package to handle the ui - it's the component library base on a Shadcdn
    - Add React same version
17. Add router model to scale the execution to particular model according to specification
    - This is to optimize costs
    - User writes his own conditions what model has to be triggered+
18. Prepare the TODO component as ReAct Agent plugin
    - It's to modify prompt - to isntruct llm to use planning
    - It's to give the tools to allow to construct todo list and update its state: planned, doing, done
    - It's to be in feature comptaoble with next core patterns for scalling for businesses