1. Update & add the drawnings of architecture
    - [Load balancing](./RealTime-Voice-Agent.specification.md#load-balancing-client---balancer-signaling-server---realtimevoiceagent) - has to include the establishing the connection with STUN and TURN and Signaling server
        - Make more detailed
            - Include the Full WebRTC Connection establishement phase
                - Use the Gemini phases
        - Add to title that's for LB alg
        - Signaling server - socket.io
        - WebRTC STUN, TURN, And strategies
        - Show the Socket.io protocols
    - [Drawning Agent Behaviour](./RealTime-Voice-Agent.specification.md#drawning-agent-behaviour)
        - Credentials have to be deliveried with webrtc to assign the media buffer to the specific user
        - Include the VAD socket.io event send when user finished speech - this event triggers the agent to process the text
        - Include events goes from the server when it starts to generate the answer
        - Include that client voice goes to stt model
    - [Agent Remote](./RealTime-Voice-Agent.specification.md#agent-remote)
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
