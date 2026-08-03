## Stage 1st - Documentation of predevelopement (done for stage 1st)
1. Define Readme document [README.md](./README.md)
    - Add the code snippets showcases the memory usage
        - For specific memory
        - Usecase
    - Add Requirements for each memory from document
        - It's to base on the code snippet and memory pattern e.g: Some memory may use the RAG like MemP, MemRL, Mem0 and BM25 seatch like all of them and Custom
    - USecases - Add the best scenarios for each memory
        - base on the my documentation
2. For each specific memory
    - Describe each memory system and the best usecase
    - Show the sections:
        - Requirements
        - Usecases - show examples when it's worthy to use something like this memory system
        - Code Example - showcases the code snippet
            - include that memory system can be combined with other systems
3. Add the refference from the [Memory Document](../Memory.md)
    -  It;s to guide to the memory section

## Stage 2nd - Define the logic
- Code Memory system universal schema has to work with the custom or the specific memory system
    1. Add the code in the code files in the `memory` folder
        ## Assumptions
        - Invoke:
            - before conversation start - manually
            - before agent run
            - before each subagent
            - after each agent
            - after main orchestrator call
            - after conversation run by agent - automatically by agent e.g: Mem0 to keep memory updated
            - after conversation - run manually
        - Implement the universal events list for the agent
        - Implement the schema methods to call the agent
        - Allow to invoke multiple methods from multiple different or same memory systems automatically or separatelly
            - Events should be listened separatelly
        - Multiple stores have to be applied
        - Apply the telementry for this

        ## Steps:
        1. Add universal interface will be the schema base on the ReAct agent logic / Agentic logic
            - Base on the invoke places - determines where the agentic logic can be called for memory
        2. Make the implementation of the code for each memory in separate files
            - Each memory has to follow its specification from the arXiv paper and memory file specification
        3. Make the ReActAgent adjusted
            1. Adjust the code of config
            2. Adjust the logic - base on the places where memory can be called
    2. Add to the documentation the spec - base on the done logic and memory config
        - for each file as is in the **Part 2**
    3. Allow to combine multiple same memories in array
- ReActAgent logic - Implement the logic
    - Agent has to choose the memory and use the above point schema for the memory usecase
    - Agent has to execute the memory after, before and meanwhile the steps
- Implement the memory systems
- Telemetry support - Add after merge this branch with the main by marging this with telemetry branch
    - Include in the documentation
    - Record the specific memory usage according to user configuration

---
### Part 2
- Configure the general memory documentation [General Memory](./README.md)
    - Adjust the code examples base on the done logic
- Configure each subsequent memory file
    - Use real file schema
    - Show the correct storage and the plural implementation of the memory
    - Show the code for each document as separate
- Configure the [Memory.md](../Memory.md) file to show the memory implementation
