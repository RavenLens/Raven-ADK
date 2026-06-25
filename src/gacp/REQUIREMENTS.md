1. Client side - used for agent - where agent can
    - Explore: 
        - agents in graph (Discovery)
        - tasks agents are executing (Occupation)
        - Queue Status: Current load, throughput limits, and queue length of other agents
        - Knowledge & Skills set - query the network for specific files, data, or reasoning traces
        - Market: Explore free or paid knowledge/skills shared by community or organization
    - Task Delagation
        - Delegate full task to specific agent
        - Delegate one task to multiple different agents and combine the outcome or choose the best
        - Delegate part of task to different agents and combine their results in one outcome
        - Queue tasks and wait for results
    - Events:
        * task_execution_start - that agent is executing the task now
        * task_execution_progress - shows the next steps in task execution
        * task_queued - notification that a task has been placed in an agent's queue due to throughput limits
        * delegate_task - listen that job was delegated to some different agent (Supports **Synchronous** and **Asynchronous** modes)
        * retrived_delegation_task - notification when an agent seeks to fulfill a delegated task
        * seek_skill - agent is searching the network for a new specialized skill/tool
        * seek_knowledge - agent is searching for specific knowledge/data sets
        * failure - structured reporting of failures (e.g., payment_required, agent_error)
    - Communicate:
        - share inner reasoning traces and accumulated knowledge with the mesh
        - communicate current occupation, throughput limits, and queue capacity
    - Connection ways:
        - GACPMiddlewareBrokerConnector (MQTT) - centralized, high-speed pub/sub for marketplace and organization-wide meshes
        - GACPServerlessBrokerConnector (WebRTC) - peer-to-peer, fully encrypted communication for maximum privacy
        - MCP - allow other agents to explore and delegate tasks via Model Context Protocol
        - NPM package - use the Raven ADK package for direct integration

2. Broker (Orchestrator) - the middleware node for centralized coordination (e.g., RavenHub)
    - Manage Payments: Facilitate the "buying" of knowledge and skills
    - Queue Management: Handle task buffering for agents at maximum throughput
    - Relations Graph: Maintain and present the exploration view of the agentic mesh
    - Knowledge Hub: Visualize and manage silos of agent knowledge in one place
    - Privacy & Security: Manage secure knowledge distribution via **Replication**
    - Constraint Management: Restrict agent access based on user subscription levels or organizational policies
    - Marketplace: Host shared agents, skills, and knowledge from the community or organization
4. MCP server
    - Make MCP server to allow to use this protocol from some tools like HermesAgent, Langchain and others
