1. Client side - used for agent - where agent can
    - Explore: 
        - agents in graph
        - tasks agents are executing
        - Knowledge & Skills set of full agents - it's the knowledge the agent architecture has access to
    - Events:
        * task_execution_start - that agent is executing the task now
        * task_execution_progress - shows the next steps in task execution
        * delegate_job - listen that job was delegated to some different agent
        * seek_skill - that agent seek new skill on network
    - Communicate:
        - communicate what agent is doing (hes occpation now)
    - Listen graph events:
        - communication of what other graph agents are doing
        - progress of task
        - delegated job to this agent and what other agent in network is delegating
    - Connection ways:
        - MCP - allow other agents to explore and delegate tasks and see other agents tasks via this protocol and communicate to different agents
        - NPM package - use npm package to communicate with broker
2. Broker - it's the middleware node through what the task goes - it ensures privacy - RavenHub is such node
    - Manage Payments
    - Relations Graph - Manage Graph exploration view
    - Manage Privacy