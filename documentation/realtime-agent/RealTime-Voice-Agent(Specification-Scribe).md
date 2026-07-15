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
[Excalidraw overview](https://excalidraw.com/#json=qTWuhR2aBWnccYwYBOU7W,g_yhBKsRLi1p--B75h9bFw)
TODO: Improve base on Critique: https://share.gemini.google/IFopwB2R0iMf

### List of models to use for the fast RealTime Agent
1. VAD Streaming - **Discriminative model -> Classificator** - Classifies the speech or non-speech
    - Open Source (Self-Hosted):
        - **Silero VAD (v4/v5)**: The gold standard lightweight DNN (~1MB) for real-time speech/non-speech chunk classification (runs in 1ms per 30ms audio chunk).
        - **Ten VAD**: Optimized C++ / WebAssembly implementation for sub-millisecond edge/client detection.
    - Closed Source (Managed/APIs):
        - **Deepgram Flux End-of-Turn**: An integrated endpointing mechanism that combines VAD and turn-detection directly inside the STT engine.
2. STT Streaming - Generates the speech out of detected VAD chunks
    - Open Source (Self-Hosted):
        - **NVIDIA Parakeet-TDT (v3)**: High throughput RNN-Transducer/TDT model designed for sub-100ms streaming frame recognition on GPU.
        - **Distil-Whisper / Whisper-Streaming (v3 Turbo)**: Chunked autoregressive transcriptions using local websocket streaming wrappers.
    - Closed Source (Managed/APIs):
        - **Deepgram Nova-3 / Flux**: The fastest streaming STT API yielding sub-150ms transcript chunks with integrated speaker diarization.
        - **OpenAI GPT-Realtime-Whisper**: OpenAI’s dedicated streaming-optimized ASR pipeline.
3. ReAct Agent or Driver Agent (reasoning engine)
    1. Reasoning Models - models to choose the actions and tools - used in agents and subagents
        - Open Source (Self-Hosted):
            - Qwen-2.5-Coder-7B / Qwen-2.5-7B-Instruct: Extremely low Time-To-First-Token (TTFT) when deployed with vLLM/SGLang; natively handles function calling and structured tool outputs.
            - DeepSeek-R1-Distill-Llama-8B / Qwen-8B: Ultra-fast reasoning distillation models for quick chain-of-thought routing.
        - Closed Source (Managed/APIs):
            - OpenAI gpt-4o-mini / gpt-4.5-turbo: Optimized for sub-200ms first-token responses and function tool invocation.
            - Claude 3.5 Haiku / Gemini 1.5 Flash: Built for real-time tool orchestration with minimal TTFT.
    2. Fast Translating models - Translates ReAct action outputs into clean conversational sentences for speech synthesis
        - Open Source (Self-Hosted):
            - Llama-3.2-3B-Instruct / Qwen-2.5-3B: Sub-50ms TTFT small language models (SLMs) trained to strip out code/JSON and output pure spoken conversational text.
            - Phi-3.5-mini (3.8B): High-throughput reasoning-to-text formatting.
        - Closed Source (Managed/APIs):
            - GPT-4o-mini: Ideal for quick roleplay translation/formatting.
            - Groq Llama-3.3-70B (LPUs): Blazing fast generation speed (~300+ tokens/sec) on Groq infrastructure.
4. **TTS Streaming**
    > Generates Speech ***PCM Audio Stream***
    - Standard Text-to-Voice
        - Open Source:
            - CosyVoice2-0.5B: Ultra-low ~150ms streaming latency with high MOS speech quality.
            - Kokoro v1.0 (82M): Ultra-lightweight ONNX model capable of sub-50ms CPU execution.
        - Closed Source:
            - Cartesia Sonic / Ink-Whisper: Sub-100ms streaming audio generation via WebSocket.
            - ElevenLabs Turbo v2.5 / Scribe v2: Low-latency conversational voice engine.
    - Zero-Shot Voice Cloning
        - Open Source:
            - Fish Speech 1.5 / Fish Audio S2 Pro: Dual-AR transformer model for zero-shot voice clone generation.
            - F5-TTS / XTTS v2: Flow-matching and VITS-based zero-shot voice cloning from 5–10 second reference audio samples.
        - Closed Source:
            - ElevenLabs Custom Voice Engine / PlayHT 2.0: Real-time voice cloning via streaming API endpoints.
5. Live Avatar
    > **TTS stream** (***Sythesized PCM Audio Stream***) is the only thing required by this stage (result of step ***4th*** is requirement)

    - Two-Step Pipeline (Feature Extraction → DiT Generation)
        > Use this flow for (Maximum Visual & Sync Quality) - it generates the highest fidelity Video in `300-600ms` added latency
        > **Latency is tradeof for sake of quality**
    
        - Step 1 (Audio Feature Extractor): Wav2Vec2.0 / HuBERT / Whisper Encoder — Converts TTS recived `on fly` audio streams into frame-aligned speech embeddings or viseme/blendshape targets.
            > This step outputs **intermediate dense acoustic feature vectors (embeddings)** required by the *Step 2* to produce the video frames
            > - At this step: These `high-dimensional acoustic embeddings` capture exact *phoneme boundaries* and *emotional dynamics*
        - Step 2 (DiT Generation): EchoMimic V2 / Hallo3 / EMO 2 (Diffusion Transformer) — Latent diffusion models taking audio frame embeddings to render 2D/3D facial frames.
            > This step requires only the `Step 1 output` (*latent acoustic vectors*) along the base avatar frame/latent state (the image of avatar will be talking e.g: human). **TTS stream frames are ignores** since the DiT is trained to understand acoustic **fetures vector embeddings** 
            > - ***DiT*** model runs in this step: focus purely on transforming `high-dimensional acoustic embeddings` generated at step 1st to the facial deformation, head turns, body movement and realistic eye-blinks
            > - This step outputs **raw video frames (or raw image latents)**
        
        > Neither step outputs a combined **video-audio** ***WebRTC*** stream. It's required to use **WebRTC Combining Server** (or **Media Server** like LiveKit/Mediasoup) is to take both streams. `It multiplexes both into unified RTP packets, applies time-sync headers (NTP/RTP timestamps), and publishes them as a synchronized MediaStream (Audio Track + Video Track) over WebRTC to the client.`
    - One-Step Real-Time Avatar Engine (Single-Pass Latent Streamers)
        > Use this flow for ultra-low latency streaming - it generates the highest fidelity Video in `50-150ms` added latency
        > **Quality of output is trafdeoff here for the sake of latency**
        
        > This pipeline features these hidden mechanisms:
        > **Direct Audio Conditioning**: The model takes mel-spectrograms or audio frame features directly into an **integrated adapter layer** (e.g., cross-attention or pixel-wise feature addition) within the DiT.
        > **Few-Step Distillation**: Models like LiveAvatar use Self-Forcing / Distribution Matching Distillation to denoise video frames in just 1 to 4 steps, hitting 20–45+ FPS.
        
        - Open Source / Code Bases:
            - LiveAvatar / AvatarForcing: Algorithms designed for 1-step progressive distillation (TurboTalk) for infinite real-time audio-driven avatar streaming.
            - RAP (Real-time Audio-driven Portrait): Hybrid-attention Video DiT for real-time talking portrait animation.
        - Closed Source / Managed Services:
            - Tavus Phoenix Engine / Simli Realtime API: Sub-300ms real-time WebRTC audio-to-avatar generation.

### Description
1. User Starts talking e.g: `by click on button` or `continous stream`
2. VAD Classifier detects the user speech chunks and streams the particular PCM audio chunks to the STT Model
    > VAD can run locally or via API
3. STT Model retrives stream of chunks and **on fly** generates the transcription **stream**
    > STT can run on cloud via api/locally on server or locally on client side - you should decide
4. ReAct Agent Collect full STT once it finish to compose the full request is able to be processed by ReAct Agent driving LLM `(This is bottleneck)`
5. ReAct Agent **Resoning Model** executes the given task
    - **Fast Translation Model (SLM)** - when agent begins or reasons, speech **TTS model** generates speech description **on fly** base on the **reasoning chunk** and sends to the **TTS model**
        - This can be turned on/off via settings e.g: turn off at the begining or at the end
    - Conversation tokens bypass the **SLM** and stream directly to the **TTS Model**
    - Reasoning - Agent reasoning is in form prepared to be streamed directly to the **TTS model** - System prompt instructs agent to do it **(To reduce bottleneck)**
    - Tools, Knowledge, Memory and Skils - execution is send to the **Fast Translation Model** translates them and stream to TTS Model -> `(This is bottleneck)` - bottleneck done delibaratelly to transcribe action
        - Each Tool ... and other can have given description what should be done
6. **TTS Model** Generates speech and streams to the WebRTC Server 
> Voice can be one from set or voice clonned by specific open-source model
7. (Optional) Live Avatar Generation - TTS stream is send to the generating system can work in 1-step (consolidated = one-genrative-ai-model) or 2-step (separated) mode
    - 2-Step Pipeline (Feature Extraction → DiT Generation)
        - 1st Step: Generates the **dense hight-demiensional acoustic features embedding=vector** / **Phoneme-Viseme Embeddings** for voice dynamic specificly to allow the next step to produce the outcome. The outcome is streamed on fly to the step 2nd
        - 2nd Step: Generates the video frames and streams them on fly to the **WebRTC Combining server**

    - 1-Step Pipeline (Avatar Engine): Use the 
        > the model inference layer itself outputs raw video frames alongside the audio stream.

    > Neither of this step outputs the WebRTC combined audio and video hence the step **8th** is required
8. **WebRTC Combining server**
    - **RavenADK** comes with WebRTC Server combines the Audio stream with Video Stream for `6th + 7th` step to consolidated **WebRTC Stream**
    - **RavenADK** comes with WebRTC Server takes **TTS model stream** is the **PCM Audio Stream** and makes the audio **WebRTC Stream**
    - Server takes the stream of pure step 6th (PCM Audio stream - when Live Avatar is disabled) or 6 + 7 and combines them
        - step 6, 7 streams are generated on fly and retrived by **WebRTC Combining server** meanwhile step 6 has to be generate before 7 to make avatar able to stick with it but step 7th captures sep 6th stream frames on fly and generetes the avatar (this is to reduce bottleneck)
    ![alt text](./images/webrtc-combining-server.png)


#### Sub Questions
- Can be some LLM used to process the STT chunks and generate the response on fly instead of waiting for full answer - to mitigate the bottleneck from step **4th**
- Does exists some STT models can run locally on user browser side via e,g: CPU or GPU? Give me the list of such models? Can them run locally on mobile device? How does `Wispr Flow` resolved it?
```markdown

**Yes, absolutely.** Running STT models locally on the client browser or native device—utilizing the local CPU, WebGPU, or mobile NPUs—is widely done.

---

## 1. Browser & Device STT Models

Running models locally in the browser relies on **WebAssembly (WASM)**, **WebGPU**, or native mobile Neural Engines (e.g., Apple Neural Engine via CoreML, Android NNAPI/TNS).

### 🌐 Browser Models (WebGPU / WASM)

* **Whisper.cpp (WASM / WebGPU):** Port of OpenAI's Whisper model in C/C++. Compiled to WebAssembly, it can run directly inside any browser (Chrome, Edge, Safari) utilizing client WebGPU/WASM thread pools.
* **Transformers.js (Hugging Face):** Allows running ONNX-quantized models in the browser via WebGL/WebGPU:
* `distil-whisper/distil-small.en` (Quantized ONNX ~150MB)
* `openai/whisper-tiny` (~39MB)
* `openai/whisper-base` (~73MB)


* **Moonshine (ONNX/WASM):** An ultra-lightweight ASR model (~27M-35M parameters) optimized for edge/browser streaming with significantly lower memory footprint and latency than Whisper-tiny.
* **Sherpa-ONNX (WASM):** Supports offline streaming models like **Zipformer (Next-gen Kaldi)** in WASM, providing sub-50ms streaming transcription inside web apps.

---

### 📱 Native Mobile Devices (iOS & Android)

**Can they run locally on mobile? Yes, very smoothly.** Modern smartphones have dedicated AI accelerators (Apple A16/A17/A18 Neural Engine, Snapdragon 8 Gen 2/3/4 NPU) that easily handle 100M+ parameter STT models.

* **iOS Models:**
* **WhisperKit (by Argmax):** Swift framework optimizing Whisper models for Apple's Neural Engine (ANE). Can achieve **100x+ real-time speed** (transcribes 10 seconds of speech in 0.1s) with minimal battery drain.
* **Apple Native Speech Framework:** Built-in iOS device STT (runs locally without network calls).


* **Android / Cross-Platform Models:**
* **Sherpa-ONNX (Mobile C++/Java/Kotlin):** Runs streaming **Conformer-CTC** or **Zipformer** models entirely on-device via ONNX Runtime / NNAPI.
* **Whisper.cpp Android Native (JNI):** Runs quantized Whisper GGUF weights on mobile ARM CPUs/GPUs using OpenCL or Vulkan.



---

## 2. How Wispr Flow Handles Speech-to-Text

Many assume **Wispr Flow** runs everything locally on the user's machine because of its speed, but its actual architecture operates differently:

### ☁️ Wispr Flow Architecture: Cloud-First Hybrid Pipeline

Contrary to common belief, **Wispr Flow does NOT run its STT models locally on the user's device.**

```
   [User Speaks]
        │ (Hotkey pressed)
        ▼
[Wispr Flow Desktop/Mobile Client]
        │
        ├─► Screen / App Context Snapshot (Captures active window context, e.g., VS Code or Slack)
        │
        ▼ (Streams raw audio via WebAssembly/WebSockets over network)
[Wispr Flow Cloud Servers (Baseten / AWS)]
        │
        ├─ 1. High-speed STT Model (Fast cloud Whisper / NVIDIA Parakeet)
        ├─ 2. Context-Aware LLM Post-Processing (OpenAI / Anthropic / Cerebras)
        │     - Removes filler words ("um", "like")
        │     - Applies context formatting (camelCase for code, casual for Slack, formal for email)
        ▼
[Transcribed & Formatted Text Returned]
        │
        ▼
[Pasted directly into user's active cursor location]

```

#### Why Wispr Flow Chose Cloud over On-Device Local Models:

1. **Context-Aware Formatting:** Wispr Flow doesn't just output raw spoken text; it captures active window context and runs a **Fast LLM** over the transcript to strip filler words and format code/prose instantly. Running both STT + LLM on average consumer hardware would drain mobile battery and introduce latency spikes.
2. **Universal Latency:** By streaming audio directly to GPU clusters (like Baseten/Cerebras LPUs), they guarantee ultra-low latency (~200ms) regardless of whether the user is on a high-end M3 Mac or a low-end budget Android phone.

---

## Summary Comparison: Local vs. Cloud (Wispr Flow)

| Feature | Browser / Mobile Local STT | Wispr Flow |
| --- | --- | --- |
| **Execution** | On-Device (WebGPU / Neural Engine) | Cloud Servers (AWS / Baseten / Cerebras) |
| **Privacy / Offline** | 100% Offline & Private | Requires Active Internet Connection |
| **Models Used** | Whisper.cpp, Sherpa-ONNX, Moonshine | Cloud Whisper, Parakeet v3, Fast LLMs |
| **Latency** | Dependent on user GPU/NPU hardware | Consistent ~200-400ms via Cloud GPUs |
| **LLM Auto-Formatting** | Requires extra local SLM allocation | Built-in via cloud LLM post-processing |
```

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
> - For **STT**: Deepgram, Whisper-Streaming, OpenAI GPT-Realtime-Whisper
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

