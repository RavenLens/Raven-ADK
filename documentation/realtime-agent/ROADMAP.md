1. `RealTimeVoiceAgent` on **RavenADK**
    1. Update config (done)
        - Local Execution - allow to run agent locally without any server hosted
        - Remote execution - Agent acts as the server
    2. Make the RealTime Agent Logic
        - Take the ReAct Agent and modify it with plugins
        - On local device acts as the local Events driven stream
        - On remote device acts as the socket/io server and webrtc peer
            - From remote device can be connected
    3. Documentation
        - Show in config how to use the tts from plugin to make the custom voice communication
        - Include instructions in documentation how to use the model communications internally from the architecture

2. Architecture drawning - make the drawning how does the RealTime Agent architecture is supposed to work
    - local - include various carriers
    - remote
    - direct communication
    - load balancers communication

2. Load balancer
    - Write load balancer in Rust will communicate with provided `server endpoints` to get its count, load and distribute the connections accordingly

    - Ship the load balancer as separate npm package `@ravenlens/ravenadk-loadbalancers` (list with balancers and algorithms)
        - Specify description covers the `RealTimeVoice-Agent`

3. Server
    - endpoint(s) - provide the list with endpoints addresses to connect with Load Balancer or Server directly - this has to be setup aside the Load balancer config

    - Ship the server as the npm downloadable npm package `@ravenlens/ravenadk-sfu` provides the servers to host livetime agent

4. Client - make client library that ships
    - Connect to local agent or remote agents - offers 2 connectivity options depends whether has to connect to local or remote agent
        - On local side the communication among `@ravenlens/ravenadk-client` is done via `Browser Events` or `IPC` or `local connection` according to the specification
        - On remote side connect to the load balancer or server LiveTimeVoice agent via the option 

        ```typescript
        interface ConnectionSpecRemote {
            mode: "remote";
            target: "realtime-voice-agent" | "loadbalancer";
            endpointURL: string;
        }

        interface ConnectionSpecLocal {
            mode: "local";
            carrier: {
                type: "events" | "ipc" | "local-connection";
                eventsPrefix?: string;
                // ipcConfig...
                // local-connection Config...
            }
        }
        ```
    - Connectivity to Load balancer or the server directly - it can be specified as the param
    - VAD - execution of voice is automatically detected
    - STT on device - optionally with format like ONNX or TFLITE or TorchScript the STT model can run on user device
    - WebRTC handshaking and streaming - the WebRTC sends the PCM/Opus buffers to the servers
    - Interruption - interruption is streamlined to the servers directly with feedback retrived
    - Response with Audio/Video - response is retrived on client
    - Showcase - video is shown as the liveavatar
    - Text Communication - RelaTime Voice Agent text events are retrived and processed by client

1. **Decouple the "Media Plane" from the "Agent Plane":** Use a specialized **Selective Forwarding Unit (SFU)** or **Media Server** (e.g., implemented in Rust for high performance) to handle the server connection and media routing
2. Allow agent to be executed locally