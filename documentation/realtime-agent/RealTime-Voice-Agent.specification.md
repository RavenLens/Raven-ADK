# Real-Time Voice & Avatar ReAct Agent Architecture Specification

## Assumptions
* User has full management over whether and how the execution of tools is told by specifying settings such as: `communicationInstruction` for tools, memory, skills and more
<!-- * **Real-Time-Voice-Agent** serves as a **WebRTC Peer** is in communication with client, that retrives user VAD PCM stream - hence you don't have to carry its logic -->
* **Real-Time-Voice-Agent** can run on locall device or incloud with out **custom server adapter** (SFU - Selective Forwarding Unit)
  - **Remote Execution** - ***SFU*** and ***Load Balancer*** are shipped as different packages for the architecture
    - These role is to distribute `socket.io` sessions and `WebRTC` traffic across different architecture real-time agent adapters (servers)
    - Role of **SFU** and **Load Balancer** is to scale architecture providing customer the best UX along the lowest headaque for developers to maintaint the architecture
    - **Load Balancer** - must rely on advanced balancing techniques that consider current server CPU/Memory usage and the number of requests currently being handled.
    > Both will be implement in Rust/C to provide the best performance for load and shipped to node.js as ***native components***
  - **Local Execution** (**EdgeAI**) - RealTime Agent can run fully on user device without requirement of any **server adapater**
    - On local side the communication among `@ravenlens/ravenadk-client` is done via `Browser Events` or `IPC` or `local connection` according to the specification
* **Real-Time-Voice-Agent** responds with response audio and/or video+audio live avatar WebRTC stream
* **Real-Time-Voice-Agent** ships streaming among the models to reduce the latency for your UX
* RavenADK Frontend Utility library can be leveraged for
    - Using `Silero-VAD` and streaming
        - User begins stream whenever needs
    - Communication with WebRTC RavenADK RealTimeVoiceAgent by establishing `handshake` and connection with peers
    - Saving the record of user
        - Export to the file is possible then

---

## Production Solutions
1. Install requited packages for hosting agent on backend on server:
```bash
npm install express socket.io @roamhq/wrtc
```
- socket.io is for handshaking
- Native Node WebRTC (`@roamhq/wrtc`) - Using `@roamhq/wrtc` (a actively maintained fork of node-webrtc), Node.js creates standard RTCPeerConnection objects on the server.
- Use this script:
```typescript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = require('@roamhq/wrtc');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

io.on('connection', (socket) => {
  let pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // 1. Handle incoming media track from client
  pc.ontrack = (event) => {
    console.log('Received track from client:', event.track.kind);
    
    if (event.track.kind === 'audio') {
      const audioStream = event.streams[0];
      
      // Pass audioStream to your AI Pipeline (e.g., Whisper, Deepgram, or Custom STT)
      processIncomingAudio(audioStream);
    }
  };

  // 2. Pass server ICE candidates to client
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', event.candidate);
    }
  };

  // 3. Receive offer from browser and create answer
  socket.on('offer', async (sdp) => {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    
    // (Optional) Add server audio track to send back to client
    // const agentAudioTrack = createAgentAudioTrack();
    // pc.addTrack(agentAudioTrack);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('answer', pc.localDescription);
  });

  socket.on('ice-candidate', async (candidate) => {
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  socket.on('disconnect', () => {
    pc.close();
  });
});

function processIncomingAudio(stream) {
  // Use non-blocking audio sink / PCM frame extractors to stream raw audio bytes to your LLM/Speech engine
  console.log('Processing stream for AI Agent...');
}

server.listen(3000, () => console.log('Agent Server running on port 3000'));
```

---

### Pointer Pinups
Utilize OpenAI API to communicate with The HuggingFace opensource models or other API Providers

---

## Possibilities
- Use [**RAG**](../augmented%20generation/RAG.md) for similarity/distance grounded answers
- Use [**E-MemRL**](../memrl/Extanded-MemRL.md) with **Real-Time-Voice-Agent** for quality-grounded answers without similarity-noise. Take advantage of E-MemRL as with-time-improving DB
- Use [**Telemetry**] for observing your user-to-agent interaction with fully covered agent reasoning traces, time and performance. Connect with RavenHub for observing-insights-improvement driven cycle for `AI-Architecture continous alignement`, `edge-cases detection` and **customer-truedemand-driven-improvement** for your agents and AI architecture

---

## I. End-to-End Execution Workflow

## Infrastructure
Showcases the differences in local and remote agent execution
<!-- TODO: -->

### Agent Local
[Excalidraw overview]()

### Agent Remote
[Excalidraw overview]()

#### Roles:
- `Client` - uses the **RavenADK** client library
- `Load Balancer` (`LB`) - wroten in **Rust**, `Reverse-Proxy` directing with `Resource-Load-Based` designation to replicas. Has subroles-communication protocols
  - `Signaling Server` (subrole) - uses `Socket.io` instance
    - Client connects
    - `RealTimeVoiceAgent Replica` connection
  - Among `RealTimeVoiceAgent Replica` communication - uses `Socket.io` for the simplicity
- `RealTimeVoiceAgent Replica` - **RavenADK** Library **Node.js** agent can have rust *NeonBindings* extensions to optimize the load
  - For *WebRTC* it's `client` **one-from-sides**

#### Protocols Usecase
- `Socket.io`:
  - `Signaling Server` - to establish WebRTC connection among the `RealTimeVoiceAgent` and `Client`
  - `LB` to `Replica` communication. It's responsibilities:
    - **bi-directional** communication: about **load**, **configuration** and **spikes**
    - **Goal:** Guide user to the replica has the least of load
- `WebRTC` technology - Used to share `Textual` events and `Media` among client and `RealTimeVoiceAgent`
  - `RTCDataChannel` (`Textual Events`) - used to stream **bi-directionally** informations:
    - From `RealTimeVoiceAgent` - streamlines events like: **processing info**, **tool usage**, **final answer**, **lipsync configuration (possibly)**, **interruption event**  (when user spoke while agent was answering),  **information agent is answering** (this allow to detect that vad and client that client was answering), **result of interruption** (success or failure), **payload omission** (when payload was unaccepted), **credentials omission** (when credentials were unaccepted)
      - Travels alongside the `audio` and/or `video`
    - From `Client` - streamlines the events like: `abort`, `Payload and Credentials`
  - `MediaStream` - used to stream bi-directionally the informations
    - From `RealTimeVoiceAgent` - streamlines data as: `Audio (Answer Speech)`, `Video + Audio stream (Answer Speech + Live Avatar)`
    - From `Client` - streamlines the data as: `Voice`, `Voice Interruption Signal` (when user speak meanwhile agent was answering)
  - **Communication Apporaches (`WebRTCConnectionPatternConfig`)** below apporaches are stored in `LB` config
    - `DIRECT` - `Client` and `RealTimeVoiceAgent` communicates directly without `TURN` middleware
      - **Traits:**
        - Doesn't require the **TURN Server** is mostly *PAID*
        - Require each `RealTimeVoiceAgent Replica` to be publicly available 
        - Is not going to work when `Client` is hidden behind **FireWall**, **NAT** or `RealTimeVoiceAgent` has same or is publicly unavailable
    - `TURN (Traverlas Using Relays Around NAT)` based - `Client` and `RealTimeVoiceAgent` are communicated via the external `TURN server` acts as the proxy in streamlining the information. 
      - **Traits:**
        - IP of both sides are undisplayable only known is **TURN Server**
        - Works perfectly if Client or Server is hidden behind **NAT** or **FireWall**
        - `RealTimeVoiceAgent Replica` can be hidden from public
        - FAIL if the specified TURN Server didn't get the credntials or need the additional charge and client balance is empty
      ```txt
        [ Client ] <--- WSS (Socket.io) ---> [ Rust LB ] <--- WS ---> [ Replica ] (Signaling)
        [ Client ] <================ Media (SRTP/WebRTC) ============> [ Replica ] (Direct)
      ```
    - `Direct-FIRST` - When client isn't available publicly it uses the configured TURN server
    > **Communication Apporach** base on the `RealTimeVoiceAgent` configuration and whether is the Client / 

#### Types of communication Replica-Client
- Text
  - stream the textual events of what is agent doing what the client can listen with `.onEvent` method
  - stream the **final-textual-output** along the media answer
  - Can listen and informa about omission
- Media via **WebRTC** (Audio (Speech Answer) / Audio+Video (LiveAvatar)) - stream the RealTimeVoice Agent progress answers and the final answer of RealTimeAgent

#### Client (`@ravenlens/ravenadk-client`)
> Utilities are shipped with `@ravenlens/ravenadk-client` package to make the `RealTimeVoiceAgent` and `Client` connection seamless and fast going for programmers and progressing businesses.
>In this package has to occur:
> - RealTimeVoiceAgent **namespace** (typescript **namespace** - formerly known as the **internal modules**)
>   - submodule can be called from main `@ravenlens/ravenadk-client` or ``@ravenlens/ravenadk-client/realtime-voice-agent`


##### Features:
- **Configuration:** Setup `RealTimeVoiceAgent`
```typescript
/** Each VAD listener has to implement the interface like this */
interface VADHandler {
  /** Specification for the VAD method */
}

/** This object is insert to the client config */
interface RealTimeVoiceAgentConfig {
  /** URL of server is signaling server / loadbalancer and familiar with protocol documentation */
  signalingServerURL: string;
  vad: {
    handler: VADHandler;
    /**
     * Use to setup time from what the time streaming has begun
    */
    startEmitAfterSpeechMs?: number;
    /**
      After specified time of silence the VAD will interupt further listening and will send to server the information to start generating the answer
    */
    stopAfterSillenceMs?: number;
  };
  /**
   * Function used to listen the microphone
   * * as defult the funnction uses the 
   *  ```typescript
   * const constraints = { 
      audio: true, // Request microphone access
      video: false // Change to true if you also need the camera
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
   *  ```
  */
  microphoneListener: () => Promise<MediaStream>;
  /** List payload with credentials is send via the signaling server to the RealTimeVoiceAgent */
  payload?: {
    [field: string]: any;
    /** Credentials list is required to establish the connection */
    credentials: Record<string, any>;
  };
}
```
- **Connect to `RealTimeVoiceAgent`**: Has to support `Remote` and `Local` agent
  - Setup Client:
  ```typescript
  import { RealTimeVoiceAgentClient, type RealTimeVoiceAgentConfig } from "@ravenlens/ravenadk-client/realtime-voice-agent/vad";

  const realTimeVoiceAgentClient = new RealTimeVoiceAgentClient({
    // ... configuration RealTimeVoiceAgentConfig
  })

  realTimeVoiceAgentClient.config();
  ```
  - Strategy - `Remote` and `Local` with agent configuration
    - `Remote` - used to connect to load balancer
    - `Local` - used to connect to local agent
  - `.connect()` method - use this method to connect the `Client` to the `Agent` with specified strategy configuration
- **Textual Communications as Events Listening:** Client can call `.onEvent` to listen the `Text based stream`
  - The events list has to be specified
  - use `.eventsLog` method to get all events as log with assigned timestamp for each event where event is specified as object has the eventname and payload.
  ```typescript
  type TimeStamp = number;
  type EventRecord = [TimeStamp, { eventName: string; eventPayload: Record<string, any>; }];
  ```
- **Talking management**: 
  - use `.start` and `.end` to start and stop the listening period programatically
    - When user first click `.start` it'll show the permission information
    ```typescript
    const constraints = { 
      audio: true, // Request microphone access
      video: false // Change to true if you also need the camera
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    ```
    - In this period the `vad` is scanning for the user voce
  - **auto interuption** - use the **configuration** to (optionally) _specify_ the time treshold after what the listening is ***aborted*** when exists the 
  - **`vad`** - specify in the **configuration** the `vad` local method to listen for the execution
    - ships as default the `Silero-VAD` user can import from `@ravenlens/ravenadk-client/realtime-voice-agent/vad` - assign this to the **vad** property
    ```typescript
      import { SileroVAD } from "@ravenlens/ravenadk-client/realtime-voice-agent/vad";
    ```
    - After specified `stopAfterSillenceMs` time of silence the VAD will interupt further microphone listening and will send to server the information to start generating the answer - information is send as the `WebRTCDataChannel`
    - From the moment the `VAD` detected the first world or `startEmitAfterSpeechMs` propety of speech sends to `RealTimeVoiceAgent` the chunks of media as stream to allow it to transcript it on fly. Speech is send via the `WebRTCDataChannel`
- **Manual aborting:**
  - Use manual `.abort()` method to send to server via the `WebRTCDataChannel` the abort manual signal - this will cause to flush all state
- **Representation of Media:** Represent the voice and media connection
  - **Visual Elementns:** Collection of standalone - Compiled from **Svelte** Visual Elements can be used to represent the `Voice` or wrap the `Voice + Video (of liveavatar)` with additional effects like *border effects*
  - **Embedding Methods:** 


#### Load Balancer
- Acts as the `Signaling Server` and the `Load Balancer` base on the **Reverse-Proxy and Resource-based-Load-balancer**
  - Guides `Client` to the `RealTimeVoiceAgent Replica` has the least load - there client establoshed the **Media** and **Text** connection
- Holds the `WebRTCConnectionPatternConfig` determines the connectivity of `Client` and `RealTimeVoiceAgent Replica` over the `WebRTC`
- **Bi-Directionaly** Communicates with `RealTimeVoiceAgent Replica` via **Socket.io** connection to get time to time the load update
  - When it starts running propagates with **safety hash** to the all replicas the load after what reaching these have to call it to info
    - Replicas override their internall loaded config when retrives this
  - Gets the current **load** by voluntarly calling with TTL
  - Gets the **load** from replica when **spikes** above the propagated norm
- Configuration object of `Load Balancer` is:

```rust
struct ReplicaLoad {
  cpu_percentage: Option<f32>;
  ram_percentage: Option<f32>;
  parallel_connections_count: Option<u64>;
}

struct ReplicaConfig {
  address: String;
  /// Replica Max Load
  load: ReplicaLoad;
}

enum WebRTCConnectionMethod {
  Direct,
  Turn,
  DirectFirst
}

struct TurnServerConfig {
  urls: Vec<String>;
  username: String;
  api_key: String;
}

struct SocketIOConfig {
  /// Port for the Signaling Server and Internal communication
  port: u16;
  /// Path for the socket.io endpoint
  path: String;
  /// CORS allowed origins
  cors_allowed_origins: Vec<String>;
  /// Connection timeout in milliseconds
  connect_timeout_ms: u32;
  /// Ping interval for heartbeat
  ping_interval_ms: u32;
  /// Ping timeout for heartbeat
  ping_timeout_ms: u32;
}

struct LoadBalancerConfig {
  replica_config: Vec<ReplicaConfig>;
  webrtc_connection_pattern_config: WebRTCConnectionConfig;
  /// Hash with what the replica gets the call
  safety_hash: String;
  #[doc="Time with what repical will be called"]
  ttl_replica_call_ms: u32;
  socket_io_config: SocketIOConfig;
}
```
- **Payload and Credentials** from a `Client` are forwarded to the `Replica` where each replica can define its own verification criteria

##### Ideas:
- Semantic routing
- Session id routing - when the RealTimeVoiceAgent stores some fields to avoid restoring or starting from the begining the user according to session id is routed to the specific same server all way to this id
  - stored information has persistance
  - this can be useafull for messages
  > I assume user can implement this manually for each agent in each early version

#### RealTimeVoiceAgent Replica
- **Payload and Credentials:** `LB` passed the credentials and payload to each `RealTimeVoiceAgent` and `RealTimeVoiceAgent` can have specified the logic and can send the omission event


### Load balancing (Client - Balancer - RealTimeAgent)
[Excalidraw overview](https://excalidraw.com/#json=oO1gsgtA7r338bdXSH0X8,is-EmuGwwH9N8zj68aJaXg)

#### Specification
- Client library
  - **Role:**
    - Connection
      - **Remote:** Connect to the **Load Balancer** that sends the response to the server where happens the communication
      - **Local:** Connects to locally working `RealtimeAgent`
    - Live Progress displaying:
      - Show the Textual events communication - display what agent is doing as events
      - Show answer - show the answer as the `<video>` with audio for liveavatar and `audio` for only mode
        - use special elements where the response is going to be shown
    - VAD - serves the basic Silero-VAD over **ONNX** Format
    - **Interruption Signals:** Handles and ships the interruption signals
    - **Abort Signals:** Send Abort signal via method e.g: `.abort()` to use in such scenarios:
      - user clicked **Cancel** button
      - user switched the interface
      - 
- Load Balancer
  - **Strategy:** **Load-Based** delegation strategy with **Reverse-Proxy**
    - looks on the resources available by **RealTimeAgent** and designates the load to server has the best capacity to handle user request
  - **Implementation:** 
    - Communication
      - with **load balancer** and **liveagent servers** - gRPC HTTP/3(QUIC) - RealTimeAgent and LoadBalancer use this to communicate the load
        - RealTimeAgent informs about spikes and excessive load
        - Both maintain active connection in pool of connections
      - with Client and Load balancer
        - wss / WebRTC - udp
        - WebRTC connects client and server directly - this explicitly demands to have configured the IP Public Address for each node/pear
          - **TURN (Relay)** server can be configured to avoid explicitly showing the ip of both sides to each other
  - **Role:**
    - **Primary:** Middleware among the Load Balancer and Client Library connections
    - Establish WebRTC Handshake among the servers
    - Delegate the user request to the server when current request still happens
    - Session awareness - delegates to the server stores the current session information via the **Session Adapter**
- RealtimeAgentAdapter - it's Socket.io and WebRTC server
  - **Role:**
    - **Loadbalancer** has defined configuration shares among the replicas - where each replica has its own individual resource load config or shares the custom one among themself distributed by loadbalancer
    - Serve the Socket.io server and WebRTC connections
    - Handles the RealTime Agent communication logic
    - Retrives and handles the `interruption signal` and flushing the all requests
    - Handling the streaming among the pieces to avoid `Waterfall` model
    - Combining the Video and Audio frames from LiveAgent and TTS Model
    - Handling the **packages** loss
    - Streams the response to user as socket.io events and WebRTC video/audio where:
      - video - is for generated liveavatar and ships video and audio
      - audio - is generated for tts only interaction without specified model
      - text - communicates as text what is agent doing now - client listens these as events
  - **Implementation:**
    - **TypeScript** - Core system
    - **Rust** - _Package loss_ and combining **WebRTC** and **Audio** signals
  - **Challenges:**
    - Handle **TTS PCM/OPUS** audio buffers combining with Video stream
    - Handle WebRTC Streaming to the end-client
    - Work in *client* as `Browser Events`, `IPC` and `Local Server`
    - Work in unified and similiar fashion as ReActAgent where is the RealTimeAgent Loigic and ship with real-time agent phases as `TTS`, `STT` and `LiveAgent`
    - Handling the 2 types of different **LiveAgent** pipelines

### Agent Local
[Excalidraw overview]()

## Agent
### Drawning Agent Behaviour
[Excalidraw overview](https://excalidraw.com/#json=ws7vMGjHKGEC_kRO3yN8r,B9lyLFoei40dWP3FJPKhBA)

### Step-by-Step Description
1. **User Ingest:** The user initiates an audio stream (via continuous stream or push-to-talk - you decide when)
> Use `@ravenlens/ravenadk-client/realtime-voice-agent` Frontend Utility lib for **Semaless Real-Time-Voice-Agent Experiences**
2. **VAD Classification:** `Silero-VAD` or other `VAD` classifies chunks as speech or non-speech. Non-speech is discarded; speech chunks stream to the STT model.
3. **WebRTC Server Request**: Transmits Speech to the LiveAgent provider WebRTC Server
3. **Streaming STT:** The `ASR` engine converts PCM chunks into partial transcript strings on the fly.
    Synchronous Streaming
    [Possibility] **Asynchronous Pre-filling & Endpointing (Bottleneck Mitigation):** Partial transcripts stream asynchronously into the ReAct Agent's context to pre-fill the KV cache. When semantic turn-detection determines intent completion, execution triggers immediately.
5. **ReAct Agent Routing:** ReAct Agent collects full request and when retrived starts processing
    - **Fast Translation Model (SLM)** - when agent begins or reasons, Models streams tokens to **TTS model** generates speech and **`streams` on fly** base on the **reasoning stream chunk headers**
        - This can be turned on/off via settings e.g: turn off at the begining or at the end
    - Conversation tokens bypass the **SLM** and stream directly to the **TTS Model**
    - Reasoning - Agent reasoning is in form prepared to be streamed directly to the **TTS model** - System prompt instructs agent to do it **(To reduce bottleneck)**
    - Tools, Knowledge, Memory and Skils - execution is send to the **Fast Translation Model** translates them and stream to TTS Model -> `(This is bottleneck)` - bottleneck done delibaratelly to transcribe action
        - Each Tool ... and other can have given description what should be done
6. **TTS Audio Generation:** The TTS engine synthesizes text into a raw PCM audio stream (48kHz Opus compatible).
7. **Live Avatar Generation (Optional):**
   * **2-Step Flow:** `TTS PCM Audio` $\rightarrow$ `Step 1 (Feature Extractor)` $\rightarrow$ `High Dimension Acoustic Vectors` $\rightarrow$ `Step 2 (DiT Model)` $\rightarrow$ `Raw Video Frames`.
    > Generates highter fidelity output but time for generation is larger
    > Communication between TTS Step 1 and Step 2 is going by stream
   * **1-Step Flow:** `TTS PCM Audio` $\rightarrow$ `1-Step Distilled DiT` $\rightarrow$ `Raw Video Frames`.
8. **WebRTC Combining Server:**
   * Receives independent raw audio frames (from Step 6) and video frames (from Step 7).
   * Applies shared system wall-clock timestamps ($T_0$) and RTCP Sender Reports to synchronize lip movement with voice.
   * Transmits a combined `MediaStream` (Audio Track + Video Track) over WebRTC to the client.
9. **Interruption Handling (Barge-In):** If client VAD detects user speech while the agent is speaking, an instant `CANCEL` signal is dispatched to STT, LLM, TTS, DiT, and WebRTC queues to **flush pending frames** and halt playback immediately.

---

## II. Comprehensive Model Stack Specification

### 1. VAD (Voice Activity Detection) Streaming Models
> **Role:** Binary classification (speech vs. non-speech) operating on micro-chunks of audio (e.g., 20–30ms buffers).

* **Open Source (Self-Hosted):**
  * **Silero VAD (v4/v5):** Gold-standard lightweight DNN-based VAD (~1MB) executing in ~1ms per 30ms audio chunk.
  * **Ten VAD:** C++ / WebAssembly implementation optimized for sub-millisecond client-side browser execution.
* **Closed Source (Managed APIs):**
  * **Deepgram Flux End-of-Turn:** Integrated semantic VAD and endpointing mechanism built directly into the STT pipeline.

---

### 2. STT (Speech-to-Text) Streaming Models
> **Role:** Converts incoming audio streams into partial and final text transcripts on the fly.

* **Open Source (Self-Hosted):**
  * **NVIDIA Parakeet-TDT (v3):** High-throughput RNN-Transducer model providing sub-100ms streaming frame recognition on GPU.
  * **Distil-Whisper / Whisper-Streaming (v3 Turbo):** Chunked autoregressive transcription wrapped in local WebSocket streaming handlers.
* **Closed Source (Managed APIs):**
  * **Deepgram Nova-3 / Flux:** Ultra-fast streaming STT API yielding sub-150ms transcript chunks with speaker diarization.
  * **OpenAI GPT-Realtime-Whisper:** Dedicated streaming-optimized ASR pipeline.

---

### 3. ReAct Agent / Driver Agent (Reasoning Engine)

#### A. Reasoning Models (Action Selection & Tool Orchestration)
* **Open Source (Self-Hosted):**
  * **Qwen-2.5-Coder-7B / Qwen-2.5-7B-Instruct:** Low Time-To-First-Token (TTFT) when deployed with vLLM/SGLang; natively handles function calling.
  * **DeepSeek-R1-Distill-Llama-8B / Qwen-8B:** Fast reasoning distillation models for quick chain-of-thought routing.
* **Closed Source (Managed APIs):**
  * **OpenAI gpt-4o-mini / gpt-4.5-turbo:** Sub-200ms TTFT responses with native tool invocation.
  * **Claude 3.5 Haiku / Gemini 1.5 Flash:** Built for real-time tool orchestration with minimal latency.

#### B. Fast Translator / Action Formatting Models (SLMs)
> **Role:** Converts raw tool calls, tool execution results, reasoning, or background actions into conversational spoken text.

* **Open Source (Self-Hosted):**
  * **Llama-3.2-3B-Instruct / Qwen-2.5-3B:** Sub-50ms TTFT small language models (SLMs) that strip out code/JSON and emit natural spoken text.
  * **Phi-3.5-mini (3.8B):** High-throughput reasoning-to-text formatting.
* **Closed Source (Managed APIs):**
  * **GPT-4o-mini:** Ideal for rapid roleplay action formatting.
  * **Groq Llama-3.3-70B (LPUs):** Blazing generation speeds (~300+ tokens/sec) on Groq hardware.

---

### 4. Streaming TTS (Text-to-Speech) Models
> **Role:** Generates synthesized PCM audio streams from incoming text tokens.

* **Standard Text-to-Voice:**
  * **Open Source:** CosyVoice2-0.5B (~150ms streaming latency) | Kokoro v1.0 (82M ONNX model, sub-50ms execution).
  * **Closed Source:** Cartesia Sonic / Ink-Whisper (sub-100ms WebSocket generation) | ElevenLabs Turbo v2.5.
* **Zero-Shot Voice Cloning:**
  * **Open Source:** Fish Speech 1.5 / Fish Audio S2 Pro | F5-TTS / XTTS v2.
  * **Closed Source:** ElevenLabs Custom Voice Engine | PlayHT 2.0 Realtime.

---

### 5. Live Avatar Generation Pipelines
> **Prerequisite:** Requires the synthesized PCM audio stream generated by Step 4.

#### Option A: Two-Step Pipeline (Maximum Visual & Sync Quality)
* **Latency Overhead:** Adds ~300–600ms latency (Quality Tradeoff, Higher Latency).
* **Step 1 (Audio Feature Extractor):** *Wav2Vec2.0 / HuBERT / Whisper Encoder* converts incoming TTS PCM audio chunks into dense, frame-aligned **high-dimensional acoustic feature embeddings (phoneme/viseme vectors)** capturing speech dynamics.
* **Step 2 (DiT Generation):** *EchoMimic V2 / Hallo3 / EMO 2 (Diffusion Transformer)* receives Step 1's *high-density acoustic **features embeddings*** *and* the base avatar reference image/pose latent. It ignores raw audio **TTS PCM** bytes and focuses purely on generating 2D/3D facial deformations, head turns, and eye blinks. Output: **Raw video frames / image latents**.

#### Option B: One-Step Pipeline (Ultra-Low Latency Engine)
* **Latency Overhead:** Adds ~50–150ms latency (Speed Tradeoff, Lower Fidelity Output).
* **Mechanism:** Employs **Direct Audio Conditioning** (mel-spectrogram adapter layers) and **Few-Step Distillation** (Distribution Matching Distillation / Self-Forcing) to denoise video frames in 1–4 steps at 20–45+ FPS.
* **Models:** LiveAvatar / AvatarForcing (Open Source) | Tavus Phoenix / Simli API (Closed Source).

---

## III. Real-Time-Agent Configuration
### Configured agent
```typescript
import { RealTimeVoiceAgent } from "@ravenlens/ravenadk/agents";

const voiceAgent = new RealTimeVoiceAgent({
  // ... Config Interfacinterface
})
```
