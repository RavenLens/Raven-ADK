1. Accomplish the periodical strict logic flags
    - Configure speech at the begining (done)
        - Add to config `communicationSpeechLevels` the `beforeLogicProcessing`
            - Add option to specify whether has it to be blocking or asynchronous - non-blocking logic
                - Describe in documentation that first speech generation from agent can flush the initial conversation from WebRTC channel - it could be separate channel but this may be overhelming for the client
                - Add the static or dynamic specification by processing with some llm where the tts model will be called from
        - Add to agent documentation - that it can be used to say like **Siri** Hi how can I help you today or process the transcript and generate the request
    - Add Speech models to flush the speech was before it started
    - Prepare specialistic `TTS` class of models
        - Prepare the interface in `base.ts` with the specification
        - Allow the model to get the custom parameters preset like the voice or according to the specific model
        - Add to config the specifiation of the model
        - Add to the documentation how to use some model like this
    - ReAct Agent events should be listenable for the instance at the backend
        - Allow ReAct agent to listen multiple events - implement in the emitEvent, onAnyEvent and onEvent logic will trigger for each listener instead only for one
        - Make the `onLogicEvent` at the `RealTimeVoiceAgent` with JSDoc description for what it does
    - RealTimeVoiceAgent plugins
        - Plugins have to be configured to be spoken **before** or **after** the execution - add this to the logic of these plugins the specific wrapper
            - Add wrapper
            - Add configuration options **before** and **after**
    - In `canAgentCommunicate` and for `speak` methods
        - Instructions to be done:
            - Base on specific entry decide whether to speak: hitl, plugin, voice agent tool, subagent, memory, skills
                - If some called tool has `sayLoad` = **false** meanwhile `CommunicationSpeechLevelsDetails` has it specified then don't sat it
            - Instruct the transcriber how to prepare the transcription base on the `actionsVoiceDescriptionInstruction` - pass the instruction to transcriber
        - Skills - each skill object carries the `actionsVoiceDescriptionInstruction` and has to be checked whether `sayAloud` is off while 
            - after and before `tools` execution cannot be spoken or has to be prepared with given instruction to `speak` method
        - Memory - each memory tool has to be executed in this fashion additionally
        - Tools - add the speech options
            - Add the instruction whether to tell after tool execution and before tool execution
                - Add to config options `before` and `after` as optional
        - Subagent
            - Add option to configure the description of subagent for `before` and after
            - Add the logic
        - HITL - seems like the toughtest
            - Change config:
                - `actionsDescribeVoiceInstruction`
                    - specify the what to say before and after
                    - Add to JSDoc and to the Documentation that HITL will talk only when has specified to talk
                - `toolsUsage.describeVoiceInstruction` - add the `beforeInstructions` and `afterInstruction` with the string says what to describe before and after tool execution
            - Add the logic of hitl talking
    - Add the blocking behaviour for speech
        - Add the configuration option can specify the speech behaviour and how to deal with speech when other is still talking
            - How to deal with other is still talking can be - set of behaviours to deal with the other agent is talking to don't cause streaming overlapping sounds: queue, stop-previous, deny-current
                - Add this to the config object

        
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
