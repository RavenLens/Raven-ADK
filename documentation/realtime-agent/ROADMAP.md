1. Accomplish the periodical strict logic flags
    - Prepare specialistic `TTS` class of models
        - Prepare the interface in `base.ts` with the specification
        - Allow the model to get the custom parameters preset like the voice or according to the specific model
        - Add to config the specifiation of the model
        - Add to the documentation how to use some model like this
    - In `canAgentCommunicate` and for `speak` methods
        <!-- TODO: Add after establishement of rigid Mem0, MemRL and MemP systems --> - Memory - each memory tool has to be executed in this fashion additionally 
        - HITL - seems like the toughtest
            - Merge with main and ship changes to be unified
            - Change config:
                - `actionsDescribeVoiceInstruction`
                    - specify the what to say before and after
                    - Add to JSDoc and to the Documentation that HITL will talk only when has specified to talk
                - `toolsUsage.describeVoiceInstruction` - add the `beforeInstructions` and `afterInstruction` with the string says what to describe before and after tool execution
            - Add the logic of hitl talking
        - Adjust with the memory merged to the main
    - Add Avatar model and sync this with speech
        - Ask ai what can be the model providers to specific one step stage 
        - Add support for multiple specific options like `AvatarOneStepPipeline`, `AvatarTwoStepPipeline`
        - Add config with `speech` and interruption options
    - Add the documentation for RealTime for RealTimeAgent base on `config`

        
    ### After above points accomplishement
    - Make unit tests for each of RealTimeAgent feature
    - Connect the frontend with the backend
    - Test the frontend and backend correlation with simple chat made to test the realtime agent connections
2. Agent Accomplishement
    1. Add `adapters` concept to code and Agent config
    2. Make the logic of agent with events streaming and compilance with spec from the [spec document](./RealTime-Voice-Agent.specification.md)
3. Make the Clietn library `@ravenlens/ravenadk-client` with `@ravenlens/ravenadk-client/realtime-voice-agent`
    - Make
        - [According to Client specification](./RealTime-Voice-Agent.specification.md#client-ravenlensravenadk-client)
        - Adapters concept
    - Make documentation - add to the this package [documentation folder](../../documentation/) as `Client` subfolder
    - publish to github and npm and add documentation in this repo as folder
        - refer to documentation from markdown file
4. Documentation in file [RealTimeVoice agent](./RealTime-Voice-Agent.md)
    - describe the possible packages and how to use them:
        - ravenadk as agent hosting
    - Show in config how to use the tts from plugin to make the custom voice communication (voice cloning)
    - Add the adapters specification and condifuration and show how to user the custom adapter
    - Include instructions in documentation how to use the model communications internally from the architecture
5. Move specification document to the `specification` folder
6. Implement the LoadBalancer (repeat Rust for the best performance)
