# Debate (MAD) - Mutliple Agents Debate
> IT sonds like Mutual-Assured-Desctruction - sick name - use it in [README.md](../../../../README.md)


Is the place allows agents to communicate among themself **locally** and **remotelly** without or with using any communication protocol like A2A, ACP or GACP


## arXiv Paper mentions agents communication
- [Improving Factuality and Reasoning in Language Models through Multi-Agent Debate](https://arxiv.org/abs/2305.14325)
Authors: Yilun Du, Shuang Li, Antonio Torralba, Joshua B. Tenenbaum, Igor Mordatch
arXiv ID: 2305.14325
Key Concept: Demonstrates that enabling LLMs to review and critique each other's responses over multiple conversational turns drastically improves task accuracy on reasoning and translation tasks.

- [GroupDebate: Enhancing the Efficiency of Multi-Agent Debate Using Group Discussion](https://arxiv.org/abs/2409.14051)
Authors: Tongxuan Liu, Xingyu Wang, Weizhe Huang, et al.
arXiv ID: 2409.14051
Key Concept: Evaluates multi-turn intra-group and inter-group conversations to optimize communication costs while raising performance on complex reasoning benchmarks.

- [MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework](https://arxiv.org/abs/2308.00352)
Authors: Sirui Hong, Mingchen Zhuge, Jonathan Chen, et al.
arXiv ID: 2308.00352
Key Concept: Encapsulates Standardized Operating Procedures (SOPs) into multi-agent dialogue roles to stream software development pipelines and resolve complex problems.

- [Communicative Agents for Software Development (ChatDev)](https://arxiv.org/abs/2307.07924)
Authors: Chen Qian, Xin Cong, Cheng Yang, et al.
arXiv ID: 2307.07924
Key Concept: Demonstrates how turn-based conversational communication between specialized persona-driven agents leads to efficient end-to-end software building.

## Reason why I should implement

### Business
- Improve agents intelligence
- Improve User Retrival by making apps fosters the collaboration
- Reduce cost by using agents with specialization to give the notions about the specific subject
- Reduce time of multiple re-asking or delegation to specific agent since the agent can be choosed automatically

### Technological

## Reason why I shouldn't implement
- Communication protocols can allow agents to communciate themself without needance to use something like this interface

## Vision Specification
- Interface enfroces subsequent stuff to happen for the agents. **These interfaces are grasped from concept**:
    - From **MAD** Concept:
        - **The best agent selection:** Use this concept to debate among the agents to choose the best AI agent to where tasks can be delegated
            - Select the best agent
            - Use in the **RavenAI DB** / **RavenHUB** as the part of **Router** architecture
        - **Share thoughts:** Share thoughts from the multiple agents and the agent is specialist is the boss
            - Placese to share:
                - Share before the conversation
                - Share meanwhile the conversation - agent can join some type of room and share the tassk
            - What to share:
                - thoughts
                - propositions of the resolution
            - **As MAD paper says:** Play to reach the consensus in conversation but don't trat the consensus as the final answer e.g: use other methods as MemRL, MemP -> Mention this in the documentation
    - From **Group Debate** document:
        - Specify the set of professional agents and make them engaged in the conversation
        - Make the each discussion step boundary explicilty told
    - From **MetaGPT**:
        - Give agents ability to ***handoff*** the tasks by specify `handoff`  parameter
        - Give each agent explicit constraints as the description
        - Subscribe the subject in the between agents communication - allow agent to communicate the agents by pushing the messages to some subjects that other agents subscribe
    - From **ChatDEV**:
        - give each agent description of the task todo
        - make the explicit boundaries: maximum roundes, time for conversation, budget tokens
        - Allow agents to request the clariffication from other agent like this publishes the informatation it subscribes
    - **Handoff execution:** Use it to share the execution of stuff
    - This interface can ship communication protocols allows agents to communicate themself additionally what would be nice to have
- List with specification:
    - Use class for communication `AgentsDebate`
    - **Specify Agents:** Specify list with communication agents, roles, description and budget tokens for conversation
    - Options:
        - `handoff` - allow agents to handoff task to the best agent
        - `memory` - each agent can use the shared memory for each agent from the memories systems  - the debate is treat as the agentic systems because current systems are made for the singular agents not the bevies
        - `protocols` - allow to use protovols to cpmmunicate and handoff tasks to external agents like these specified on RavenAI DB Platform
        - `boundaries` - specify explicit boundaries like: 
            - `tokens` - specify tokens budget for agent communication among the agents for `before` and `meanwhile` stages
            - `time` - time agents can talk for the same phases as are specified for the `tokens`
            > Agents can ask other agents to clarrify the talking
    - Specify conversation stages
        - `talkBefore` (talk before converaation) - optionally specify budget tokens
        - `talkMeanwhile` (talk meanwhile conversation) - optionally specify budget tokens
    - Specify communication protocols - allow to use communication protocols to talk with other agents as A2A, ACP & GACP - if the protocols are specified 
    - Use to select the best agent to perform the task from the given list
        - GACP protocol or A2A or other can be leveraged to get the list of remote agents and delegate task to that specific agent
    - Use the specific methods: 
        - `choseBestAgent()` - use to get the best agent for the task by discussions among the the given agents - each agent has to show its skill and all votes for the agent should be enrolled - like choosing papa. Returns the unit from list is the best agent
        - `invoke(options: { /* ... */ messages: [] })` - this is list with messages and task to be done by the agents where agents can subscribe the subjects it needs to learn. It returns:
            - result of task
            - communication of agents - from stages: `before`, `meanwhile` that have to be assigned to the proper field
            - choosen agent to make the task

- Sandbox/Room for agents communication - agents joins to room to communicate something with the specific agents
    - each agent joins to the room  and can send message to other agent is connected locally or remotelly
    - Should be connected with remote protocols as: GACP, A2A and ACP
    - Should work locally as the events exchange among agents with usage of some protocol of device as ipc or other localhost capable protocol like HTTP SSE / WebSockets
- Specification where conversation can happen
    - before solving the task
        - specify the amount of budget tokens by all agents or single agent
            - assign to single agent or all agents as budget or do both - while single agent budget can cause other agent to talk less or be omitted - when one agent takes full budget
    - 
- Specification for the debate steps or explicit boundaries like **budget tokens** of talk or **time** of conversation to take a place to happen
