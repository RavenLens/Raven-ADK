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
5. Tests for
    - ReAct Agent
        - Skills
        - Memory
6. Improve Skills
    - Give instruction what skill is valulable to the `SkillSharedConfig`
    - Make the system to evaluate whether skill ReAct Agent would like to create is what the `instruction` for skill appreciates when specified, when not specified whether is this skill greate and whether does the similar same skill exists
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
9. Prebuilt tools
    - Network search for:
        - local - the exploration for desktop apps with playwright
        - remote - usage of the remote tools for exploration
10. AJudge (Agentic Judgement)
11. Help for Voice
    - Prompting in voice - (Input voice)
    - Outputing in voice (Output voice)
    - Talking in voice - (Input + Voice) in real time
12. Compaction Chat History
    - i automatic
    - for LLM Class
    - for ReAct Agent
13. RavenHub
14. TODO tools and events
    - ReAct agent once executes todo tool communicates the updation state and events base on this tools
15. Add OpenRouter support as LLMs handler that will give hand for LLMs
