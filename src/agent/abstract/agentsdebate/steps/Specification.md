# Specification for `AgentsDebate`

- `invoke()` method - executes given task as the last message in chat history with usage of 
    - specified modes:
        - `handoff` - delegates task to the $N$ number if the best agents choosen at the begining by the debate. Return resolved task and choosen agent with the history assiciated with each agent
        - `consultation` - consultst the tasks and steps to resolve the problem with the other agents by firing debate at the begining, menawhile the conversation. Returns result and agents were picked to conversation and its communiication from each stage of the communication
- `chooseBestAgent()` - choose one or $N$ the best agents that matches to the task given in the question
