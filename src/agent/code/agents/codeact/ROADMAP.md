## Requirements
- produce `error` event when something doesn't work

## 1) Logic

### Requirements
1. Make snapshot of each file from workspace files list - read the file content and save to the array efficivelly - as the `Buffer` or string
    - Get what method is the best to save it
2. Define Graph Logic with nodes
    - Events list
    - Define different message type for the code and for the message that is codeact patterns abstraction with function that doesn't affect the model - cause I don't want to rewrite the logic
        - Some method can write it
    - HITL - hitl has to be triggered for common tools base on the strategy 
    - Sandobx - collect sandbox execution code and outcome in separate store
    - System prompt
        - `Executor` - has to specify the validation commands it can use to validate the executed code
    - Define tools
        * Tools: Everything is a tool approach - executor is a tool too but tool call delegates the action to the node specified with graph
        * Events: User can listen events on these tools
        * HITL: User has to be able to specify hitl for these tools with the helpers

        
        - Default Tools List:
            - read_directory
            - read_file
            - write_file - create new file, override or update - agent dedices whether to create or update the files
                - it's to produce livetime event shows the lines of code are writing
                    - this can be done on stream
            - create_file - creates empty file
            - create_directory - create empty directory/ies
            - delete_file - deletes the file
            - delete_directory - deletes directory with custom files
            - write_changes_path - tool used to apply the change to the specified path with a `config.writeMode` style
            - validate_code - executes the code in sandbox with the validation command
            - sandbox - exeucted the code or the tool in given sandbox
                - sandbox has to have access to the packages like from `npm` to allow to check the execution state
        - Custom Tools - allow to extend the basic tools list with custom tools
            - Custom tools have to allow to listen events on them e.g: git tools
    - Produce events
        - Each tool call - has to be the event made for the desired tool
    - Define HITL - hitl has to be called for the specified tools
    - Nodes
        - planner - specify the planner node when `plan` property was specified
            - It's to be separate node iterates above the projects and makes the plan with the user given query
            - It's to:
                - Use tools: typical, mcp and ast, lsp
                - Use skills
                - Use memory
                - Execute code as a sandbox with same state as a executor
                - produce the `plan_start`, `plan_result` and `plan_progress` events
        - executor - is the model executes the actions
            - It's to:
                - use `tools`
                    - define `LSP` and `AST` tools
                    - Give proper description how to use these tools in system prompt
                - generate typical messages
                - generate the code - as the vscode agent - these have to generate the code as a 
            - use `validationCommands` after `sandbox` passed execution back to this node
            - Store code in some object that has `executionOutput` field with a state will be then assigned to it, object can look like this: `{ code: "//...code", executionOutput: { stdout: "...otuput", status: "error" | "success" } }` - this is stored after agent made the code and once the code was done the agent assigned the output and decides whether to write this to the path
        - sandbox - is the node to where is goind the code the `executor ` has wrote
            - guide the result of execution the code to a `executor` - it's then evaluating the state of execution
        - error - use to produce the error
3. Register each step in the `messages`
4. Define plugins

### Excalidraw drawning
Specification for how should it work base on the above Requirements


## 2) Documents
- Write the documetns

## 3) Rollback
Allow to rollback each specified action