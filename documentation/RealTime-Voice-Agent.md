# RealTime Voice Agent
RealTime Voice Agent is the agent user talks to and retrives response of what is going on now and the response

## Assumptions
- User can specify the tools, memory and skills and each agent step is communicating by voice where user is omnipotent to manage what agent should communicate
- Agent response is communicating as response by producing the voice representation of the response and the text
    - User can define how should look the response
- Realtieme agent as you can infer from above point focuses on voice communication but along that genrates the text response and while progressing the steps can be hidden to voice-communication or described in pursued fashion
- Straming - among the parts like the VAD, TTS, STT and DiT Live Avatar has to be specified the streaming to reduce the time of action - it's to base on some Fast Real Time engine or leightweight and capable TTS/STT model
- AI Agent has to hos the STT model infront to retrive the webrtc stream and streamline to the agent
    - Potentially user can modify the WebRTC (default) to sth different 
    - Tune the WebRTC channel parameters
- AI Agent has to give the response as consolidated WebRTC stream - it's to conclude the audio and Video to one `<video>` stream or send the `sound` avoiding the server

## Architecture Specification and Showcase
[Excalidraw overview](https://excalidraw.com/#json=GY_160oy2rlIf5Oq-aA6Q,wfIEBKGoL6u2kbxQWc3MpQ)
TODO: Improve base on Critique: https://share.gemini.google/IFopwB2R0iMf

### Description

#### v2
1. **Session, Ingestion, VAD (ASR - Automatic Speech Recognition), and Interruption Control**
    ### 1. Session
    Has to be made request to initialize the session or to use existsing one and send with each **stream VAD frame** to get the user id

    ### 2. VAD
    User uses on his device **VAD** model like: `Silero-VAD`, `WebRTC-VAD` or something other to detect the voice and send the detected chunk to the server as stream


    - VAD Model has to be fast to send output as fast as possible - use for this the model like `Silero-VAD`, runs locally and classigies retrived PCM Audio Buffers as **Speech** or **Silence**
    - For **Common VAD** we recommend `Silero-VAD` due to it's incredible effectiveness, small size - ONNX 2MB, small time and amazing abilities to catch-up speech
    - Use Microsoft Browser ONNX Runtime to load it on side of browser

    Shortcut:
    ```bash
    npm install @ricky0123/vad-web
    ```
    - It base on the event-driven api
    - It executes on [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) to avoid ui shutter
    - Handles state in stateless ONNX - since Silero-VAD is statefull (`RNN` or `GRU`)

    ```typescript
    import { MicVAD } from "@ricky0123/vad-web";

    const vad = await MicVAD.new({
    onSpeechStart: () => {
        console.log("User started speaking!");
    },
    onFrameProcessed: (probabilities, frame) => {
        // Fired every ~32ms at 16kHz of audio sampling (makes 512 chunks - Silero-VAD requires 512 chunks for frame) with audio frame data and speech probability
        if (probabilities.isSpeech > 0.5) {
        sendFrameToLLMServer(frame); // Stream raw float32 frame
        }
    },
    onSpeechEnd: (audio) => {
        console.log("User stopped speaking. Full utterance ready.", audio);
    }
    });

    vad.start();
    ```
    
    Or - play longer with
    
    ```bash
    npm install onnxruntime-web
    ```

    ### 2. Input Transport
    Micro-chunks of audio from VAD (e.g., 20ms _Opus_ frames) travel over a low-latency ___WebRTC___ data stream
    - WebRTC wins over the WebSockets because it's build for data streaming that minimalizes buffering, handles packet loss and _provides bitrate adaptation for changing the network conditions_

    #### Latency comparison:
    **WebSocket:** 100–200ms additional buffering.
    **WebRTC:** 20–50ms additional buffering. That 150ms difference compounds when you sum all components.

    ### 3. Barge-In Handling (Interruption)
    If the user speaks while the Avatar/TTS is outputting, the **VAD** triggers an instant `CANCEL` event down the pipe, clearing buffers for the LLM, TTS, and DiT models to freeze playback instantly

> - On Frontend side has to be library to automate this process
> - Backend: Provide API How to retrive chunks from the client and provide some Node.js openresolution for that
---
#### (Here starts Backend)
---
2. Use the **STT** modern ASR Streaming model to genrate transcript of the retrived audio chunks
    > Use Modern ASR Engine that builds the speech transcription for partially retrived VAD chunks

    Scenarios:
    - **STT** waits to retrive full sentence from VAD to generate output
3. Pass the _transcript_ to the **Voice Agent** instance
    #### Scenarios:
    - **Voice Agent** waits till the **STT** generate full transcript of audio
    
    #### Path of processing:
    1. **Voice Agent** produces thoughts, uses: skills, tools and memories and streams them to the selected **TTS model**
        - For selected thoughts, skills, memory, tools is used selected `translator` model that generates text describes what agent is doing now in understandable form - it's then put to the **TTS model**
            - For sake of efficiency - it's to be small-lightweight and fast model like these have `7-8B` parameters 
        - Calling the steps description can be disabled by:
            - `translator` - don't specify translator model
            <!-- TODO: Add more -->
        - Use events on **Voice Agent** to listen the progress and show it visually for better UX espacially when you've disabled **showcasing** thoughts, memory, skills and so on...

        #### Cheat Sheet:
        1. Use Fast LLM (Small LLM) to get the tasks accomplished as fast as possible

    2. **Voice Agent** once produces the response and send full content to the **TTS model**
        - Specify in ___system prompt___ the information about format - Response has to be in format ready to the answer

    3. [**RAG**](./augmented%20generation/RAG.md) / [**E-MemRL**](./memrl/Extanded-MemRL.md) - Add the RAG to the voice agent base on the user query similairty/distance and use this as information for better processing, you can use the [**E-MemRL**](./memrl/Extanded-MemRL.md) too
4. **TTS** - produces the speech and send it back to client or generates the direct answer when `LiveAvatarDiTModel` isn't specified
5. **LiveAvatarDiTModel** - It's the `DiT (Diffussion Transformer Model)` that 
* **Audio-to-Video Conditioning:** The model takes a base reference image/latent state of the avatar and conditions the diffusion process on the current incoming chunk of audio feature vectors or visemes.
* **DiT Frame Generation:** Utilizing lightweight spatial-temporal DiT architectures, it denoises latents in a single-step/few-step forward pass to generate lip-synced video frames (~24–30 FPS).
* **Sync Buffer:** Video frames are ***timestamp-aligned*** with the corresponding TTS audio frames to ensure lip-sync fidelity.

6. Response to client - TTS or TTS + DiT combined tracks are _combined_ to **WebRTC stream** and send to the client as WebRTC stream
    - Combining requires to have the server that will perform it e.g:
        - Specified by us
        - From provider: LiveKit, Janus, or Mediasoup

> Non-Blocking STT and TTS - it's to handle the partial processing to don't wait for full generation that reduces the response time -> it makes it really live

> Use:
> For pipelining: 
> - OpenAI's Realtime AP
> - Gemini Live
> For separation:
> - For **STT**: Deepgram, Whisper-Streaming
>   - **ASR:** there produces ***Partial Text Transcripts***
>   - **Turn Detection:** Semantic endpointing determines when a thought has concluded, passing the transcribed query to the ReAct agent
> - For **TTS** (Hight-speed-streaming engine): ElevenLabs, Cartesia, Piper


<!-- TODO: mention RAG usecase here and in that document -->




## TODO:
1. Stage 1: Specification
    - Define the RealTime Architecture Specification with connection the backend to frontend
        - Annotate the excalidraw changes
        - Send attach the changed exalidraw drawning
    - Backend specification
        - Define the configuration object for RealTime agent. Where it's to have:
            - VAD
                - Allow to use HuggingFaces API
                - Allow to use the Ollama models
                - Allow to use ONNX Models?
                - Maybee define the HuggingFace models to allow to use the VAD or unified object allows for embedding the models and for streaming the responses
            - Driver agent with:
                - If user uses the ReActAgent he's to use special version of `VoiceReActAgent` to differ the 2 responsibilities
                - description of `what has to communicate (what to include and what to exclude out of the speech)` and `how (the style)` like:
                    - memory usage
                    - tool - each tool can be described as voice agent tool with additional specification of what to say
                    - skills 
                    - thoughts - specification how to describe the thoughts
            - STT model
            - TTS
            - Live Avatar - model
        - Show the example configuration with called classes and VAD models
    - Frontend
        - Specification for Specification of frontend library - It's to include:
            - It can be made as separate js library
            - Handling video streams
            - Handling VAD
                - Use the VAD models locally:
                    - Silero VAD via ONNX Runtime Web via WebAssembly - package `@ricky0123/vad-web`


                - retriving vad stream - to show in text field
            - Retriving the textual stream
            - Handling the steps stream
            - Handling the response stream
                - voice
                - audio
            - Showing the visual responses
2. Stage 2: 

