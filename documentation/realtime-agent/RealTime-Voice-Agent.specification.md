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

### Agent Remote & Load balancers with SFU Adapters
[Excalidraw overview - Holistic]()

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
  - **Strategy:** Load-Based delegation strategy
    - looks on the resources available by RealTimeAgent and designates the load to server has the best capacity to handle user request
  - **Role:**
    - **Primary:** Middleware among the Load Balancer and Client Library connections
    - Establish WebRTC Handshake among the servers
    - Delegate the user request to the server when current request still happens
    - Session awareness - delegates to the server stores the current session information via the **Session Adapter**
- RealtimeAgentAdapter - it's Socket.io and WebRTC server
  - **Role:**
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
> Use ***RavenADK*** Frontend Utility lib for **Semaless Real-Time-Voice-Agent Experiences**
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
