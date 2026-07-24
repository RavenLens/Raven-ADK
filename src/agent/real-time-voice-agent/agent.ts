import { HITLTransportSchema } from "../tools/hitl/hitlToolSchema";
import { AuthPayload, ConfigLessSchemaSkillsStore, ExecutionRemoteMode, RealTimeVoiceAgentConfig, RealTimeVoiceAgentSchemaMemoryStore, RealTimeVoiceAgentSkillsSchema, VoiceAgentDescriptionConfig } from "./agentConfig";
import { EventEmitter } from "node:events";
import { STTModel } from "./stt";
import { ReActAgent } from "../ReAct.agent";

/**
 * @param result - isn't included in `CommunicationSpeechLevelsDetails` to don't introduce the breaking feature
*/
type SpeechLevel = keyof Exclude<NonNullable<RealTimeVoiceAgentConfig<any, any, any>["communicationSpeechLevels"]>, string> | "result";

/** Store RTC Data Channels */
export class ClientDataChannels {
    private channels = new Map<string, { [channelName: string]: RTCDataChannel; }>();

    /**
     * 
     * @param clientID - client Identifier
     * @param throwError - specify as **true** to throw error when channel isn't specififed
     * @throws {Error} - when client events channel wasn't specified and `throwError` param was speecified as **true**
     * @returns 
     */
    getClientEventsChannel(clientID: string, throwError: true): RTCDataChannel;
    getClientEventsChannel(clientID: string, throwError?: boolean): RTCDataChannel | undefined;
    getClientEventsChannel(clientID: string, throwError?: boolean): RTCDataChannel | undefined {
        const clientEventChannel = this.channels.get(clientID)?.["events"];

        if (throwError && !clientEventChannel) {
            throw(`Client '${clientID}' events channel isn't specified`);
        }
        
        return clientEventChannel;
    }

    /**
     * Sends event via `events` RTCDataChannel
     * @throws {Error} - always when events channel doesn't exist
    */
    emitEvent(clientID: string, event: string, data?: any) {
        const clientEventsChannel = this.getClientEventsChannel(clientID, true);
        clientEventsChannel?.send(JSON.stringify({ event, data }));
    }

    /**
     * Specific to emit the transcription event
     * @param clientID
     * @param mode 
     * @param body 
     */
    emitTranscriptionEvent(clientID: string, mode: "start" | "end", body: { place: Exclude<SpeechLevel, "result">; transcript: string; body?: Record<string, any>; }) {
        const eventName = mode === "start" ? "realtime_agent.transcriber_start" : "realtime_agent.transcriber_finish";
        this.emitEvent(clientID, eventName, body);
    }

    /** Use to modify channels */
    get operand() {
        return this.channels;
    }
}

export class RealTimeVoiceAgent<
    RealTimeVoiceAgentSkills extends RealTimeVoiceAgentSkillsSchema,
    Memory extends RealTimeVoiceAgentSchemaMemoryStore,
    HITL extends HITLTransportSchema
> {
    config: RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills, Memory, HITL>;
    usersTrackID = new Map<string, string>([]);
    /**
     * Store RTCData channels
    */
    clientsDataChannels: ClientDataChannels = new ClientDataChannels();
    speekingUsers = new Map<string, number>();
    clientAudioStreams = new Map<string, MediaStream>();
    // Unblocking audio processing queues and STT stream sessions per client
    private activeSpeechSessions = new Map<string, {
        audioBuffers: Buffer[];
        chunkQueue: Buffer[];
        queueReadHead: number;
        chunkResolvers: Array<() => void>;
        isSpeaking: boolean;
        sessionAbortController: AbortController;
    }>();
    private internalEvents: EventEmitter = new EventEmitter();
    private activeClients = new Map<string, { socket: any; pc: any; logicAbortController: AbortController | null; authParams: AuthPayload; audioSource?: any; videoSource?: any; }>();
    private serverInstance: any = null;
    
    constructor(config: RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills, Memory, HITL>) {
        this.config = {
            ...config,
            operationMode: config.operationMode ?? "production",
            communicationSpeechLevels: config.communicationSpeechLevels ?? "all"
        };

        /* Listen internal logic events */
        this.internalEvents.on("interrupt-internal", (clientID: string) => {
            // TODO: Emit the interruption text event

            // TODO: Emit the interruption voice sound when configured on ReAct agent, when agent was talking
            // TODO: Flush the all generated content
        });
        
        this.internalEvents.on("stt-transcript-interim", ({
            clientID,
            transcript,
            isFinal,
            raw
        }: { clientID: string; transcript: string; isFinal: boolean; raw: any; }) => {
            // Emit event
            this.clientsDataChannels.emitEvent(clientID, "realtime_agent.stt-transcript-interim", { transcript, isFinal });
            
            // TODO: Generate the content right now as speculative decoding mechanism -> model generates thoughts base on the specified text by asking questions - Least-To-Most Technique -> then attach this to the full transcript prompt
            // TODO: generate speculative events before and after
        });
        
        // It's the final trasncript arrived from the message
        // From this place agent begins execution
        this.internalEvents.on("stt-transcript-final", async ({ clientID, transcript, audioBuffer }: { clientID: string; transcript: string; audioBuffer: Buffer }) => {
            // Emit Client Text Event
            this.clientsDataChannels.emitEvent(clientID, "realtime_agent.stt-transcript-final", { transcript });
            
            // Abort previous turn if running
            const client = this.activeClients.get(clientID);
            if (client?.logicAbortController) {
                client.logicAbortController.abort();
            }

            const logicAbortController = new AbortController();
            if (client) {
                client.logicAbortController = logicAbortController;
            }

            // Optionally allow the transcript to go through transcriber
            const _improveTranscriptWithTranscriber = await (async () => {
                const transcriber = this.config.agent.models.transcriber;
                let currentTranscriber = null;
    
                if (transcriber) {
                    // Adds the spec regard the Transcriber Strategy
                    if (transcriber.routingStrategy === "all-through-transcriber") {
                        currentTranscriber = {
                            model: transcriber.model,
                            systemPromptAddition: transcriber.systemPromptAddition
                        };
                    } else if (transcriber.routingStrategy === "fine-grained" && transcriber.transcribeFor["after-full-stt-transcript"]) {
                        currentTranscriber = transcriber.transcribeFor["after-full-stt-transcript"];
                    }
    
                    // Produces the transcript with events
                    if (currentTranscriber) {
                        if (logicAbortController.signal.aborted) return;
                        this.clientsDataChannels.emitTranscriptionEvent(clientID, "start", { place: "afterFullSTTTranscript", transcript: transcript });
                        
                        const transcriberResult = await currentTranscriber.model.invoke({
                            messages: [
                                {
                                    type: "system",
                                    content: `You are a professional transcriber. Your role is to produce the transcription of the specified transcript.${currentTranscriber.systemPromptAddition ? `\n\nAdditional instructions from user:\n${currentTranscriber.systemPromptAddition}` : ""}`
                                },
                                {
                                    type: "user",
                                    content: `Transcript: ${transcript}`
                                }
                            ],
                            abort: logicAbortController.signal
                        });
    
                        if (logicAbortController.signal.aborted) return;

                        const aiMessage = transcriberResult.answer.find(m => m.type === "ai");
                        if (aiMessage && "content" in aiMessage && typeof aiMessage.content === "string") {
                            transcript = aiMessage.content;
                        }
    
                        this.clientsDataChannels.emitTranscriptionEvent(clientID, "end", { place: "afterFullSTTTranscript", transcript: transcript });
                    }
                }
            })()
            
            if (logicAbortController.signal.aborted) return;

            // Emit generation text event -> Retrive on frontend
            this.clientsDataChannels.emitEvent(clientID, "realtime_agent.logic_start", { transcript });

            // Config ReAct Agent
            const { authParams } = this.activeClients.get(clientID)!;
            const agent = new ReActAgent({
                model: config.agent.models.reasoning,
                systemPrompt: `${config.agent.systemPrompt}

    ## Thoughs generation rule
    - You work in the RealTimeVoice Agent pipeline where the thoughs are said aloud by another tts model, therefore you've to generate thoughts are able to be said in understandable way for human and simulatenously showing what you're doing
                `,
                messages: config.agent.messages,
                skills: config.agent.skills?.(clientID, authParams),
                memory: config.agent.memory?.(clientID, authParams),
                tools: config.agent.tools,
                plugins: [
                    ...config.agent.plugins ?? [],
                    {
                        name: "voice_thoughts_plugin",
                        executionWay: ["thought", "thoughts"],
                        execute: async (from) => {
                            if (from.thought) {
                                void this.speak(clientID, from.thought, "thoughts", logicAbortController.signal);
                            }
                            return { status: true };
                        }
                    },
                    {
                        name: "voice_tools_plugin",
                        executionWay: ["before_tool_invoked"],
                        execute: async (from) => {
                            if (from.toolName) {
                                void this.speak(clientID, `I'm using ${from.toolName} tool to help you`, "tools", logicAbortController.signal);
                            }
                            return { status: true };
                        }
                    },
                    {
                        name: "voice_subagents_plugin",
                        executionWay: ["subagent_invoked"],
                        execute: async (from) => {
                            if (from.subagentRole) {
                                void this.speak(clientID, `I'm delegating this task to my specialist ${from.subagentRole}`, "subagents", logicAbortController.signal);
                            }
                            return { status: true };
                        }
                    },
                    {
                        name: "voice_memory_plugin",
                        executionWay: ["memory"],
                        execute: async () => {
                            void this.speak(clientID, "Let me check my memory for a moment", "memory", logicAbortController.signal);
                            return { status: true };
                        }
                    }
                ],
                hitl: config.agent.hitl?.(clientID, authParams).hitl,
                subagents: config.agent.subagents,
                maximumReasoningRecalls: config.agent.maximumReasoningRecalls,
                withConclusion: config.agent.withConclusion,
                parallelizeSubagents: config.agent.parallelizeSubagents,
                parallelTools: config.agent.parallelTools,
                abort: logicAbortController.signal
            });

            // Pipe all agent events to the client and handle voice-feedback for non-plugin events
            agent.onAnyEvent((event: any, ...args: any[]) => {
                if (event === "hitl_triggered") {
                    const [type] = args;
                    void this.speak(clientID, `I need your assistance for ${type}.`, "hitl", logicAbortController.signal);
                }
                
                if (event === "tool_invoked") {
                    const [toolName] = args;

                    const specifiedSkillsToSay = Object.entries(config.agent.skills?.(clientID, authParams)!.config!.actionsVoiceDescriptionInstruction!) as unknown as [
                        keyof ConfigLessSchemaSkillsStore,
                        VoiceAgentDescriptionConfig
                    ][];
                    const isSkillFound = specifiedSkillsToSay.find(([skillToolName, skillSpec]) => skillToolName === toolName && (skillSpec === true || (typeof skillSpec === "object" && skillSpec.sayAloud === true)));
                    
                    if (isSkillFound) {
                        void this.speak(
                            clientID,
                            `I'm performing ${toolName} skill`,
                            "skills",
                            logicAbortController.signal
                        );
                    }
                }
                
                this.clientsDataChannels.emitEvent(clientID, `agent.${event}`, args.length === 1 ? args[0] : args);
            });

            // TODO: Register listening for plugin execution by: config.agent.plugins and tell when it's possible

            // TODO: Optionally before agent run run the speech voice when was configured
            
            // Call agent
            const result = await agent.invoke({
                messages: [
                    {
                        type: "user",
                        content: transcript
                    }
                ],
                abort: logicAbortController.signal
            });


            // Emit generated response text event
            this.clientsDataChannels.emitEvent(clientID, "realtime_agent.logic_finish", {
                result: result
            });
            
            // Speak result
            const lastAiMessage = result.messages.filter(m => m.type === "ai").pop();
            if (lastAiMessage && "content" in lastAiMessage && typeof lastAiMessage.content === "string") {
                this.speak(clientID, lastAiMessage.content, "result", logicAbortController.signal);
            }
            
            // TODO: Add the pipeline avatar model to talk when start generation
        });
    }

    /* 
        TODO: Base on specific entry decide whether to speak: hitl, plugin, voice agent tool, subagent, memory, skills
    */
    private canAgentCommunicate(checkForCaseLevel: Exclude<SpeechLevel, "result">) {
        if (this.config.communicationSpeechLevels === "all") return true;
        if (typeof this.config.communicationSpeechLevels === "object") {
            const levels = this.config.communicationSpeechLevels;
            return levels[checkForCaseLevel] === true;
        }
        return false;
    }
    
    /*
        TODO: Base on the config decide what to say and whether to user transcriber -> take the instruction for the specific unit
        TODO: Emit events via client data channel: transcriber start, transcriber end, tts_start, tts_end - unify with simple function when it's possible
    */
    private async speak(clientID: string, text: string, type: SpeechLevel, abort?: AbortSignal) {
        const client = this.activeClients.get(clientID);
        if (!client || !client.audioSource) return;

        if (type !== "result" && !this.canAgentCommunicate(type)) return;

        try {
            // Optional transcription adjustment
            let textToSpeak = text;
            const transcriber = this.config.agent.models.transcriber;
            if (transcriber) {
                let currentTranscriber = null;
                if (transcriber.routingStrategy === "all-through-transcriber") {
                    currentTranscriber = transcriber;
                } else if (transcriber.routingStrategy === "fine-grained" && (transcriber as any).transcribeFor?.[type]) {
                    currentTranscriber = (transcriber as any).transcribeFor[type];
                }

                if (currentTranscriber) {
                    const res = await currentTranscriber.model.invoke({
                        messages: [
                            { type: "system", content: `You are a professional transcriber. Your role is to produce the transcription of the specified segment. Segment type: ${type}.${currentTranscriber.systemPromptAddition ? `\n\nAdditional instructions from user:\n${currentTranscriber.systemPromptAddition}` : ""}` },
                            { type: "user", content: text }
                        ],
                        abort
                    });
                    const aiMessage = res.answer.find((m: any) => m.type === "ai");
                    if (aiMessage && "content" in aiMessage && typeof aiMessage.content === "string") {
                        textToSpeak = aiMessage.content;
                    }
                }
            }

            // TTS
            const ttsModel = this.config.agent.models.tts;
            const audioBuffer = await ttsModel.tts(textToSpeak, { // TODO: Prepare better model then
                model: (ttsModel as any).config?.model ?? "tts-1",
                voice: "alloy" // Default voice // TODO: Configure voice
            } as any);
            
            if (audioBuffer && audioBuffer.length > 0) {
                // Emitting the audio via wrtc
                client.audioSource.onData({
                    samples: audioBuffer,
                    sampleRate: 16000,
                    bitsPerSample: 16,
                    channelCount: 1
                });

                // Update avatar if available
                if (this.config.agent.models.avatar && client.videoSource) {
                    // Avatar updates would be triggered here
                }
                
                // Notify client via data channel
                this.clientsDataChannels.emitEvent(clientID, "realtime_agent.speech_segment", { type, text: textToSpeak });
            }
        } catch (err) {
            this.devConsole(`[RealTimeVoiceAgent] Speak error for ClientID ${clientID}: ${err}`, "error");
        }
    }

    /**
     * List of orders it does:
     * 1. Take the audio and pass to the specified stt model
     * 2. STT assignes the audio to the user id
     */
    private processIncomingAudio(clientID: string) {
        // Stream pipeline initialization
        this.devConsole(`[RealTimeVoiceAgent] Initialized audio stream pipeline for ClientID: ${clientID}`, "log");
    }

    /** Push raw audio chunk received for client to active session buffer/queue */
    public pushAudioChunk(clientID: string, chunk: Buffer) {
        const session = this.activeSpeechSessions.get(clientID);
        
        if (session && session.isSpeaking) {
            session.audioBuffers.push(chunk);
            session.chunkQueue.push(chunk);
            
            const resolver = session.chunkResolvers.shift();
            if (resolver) {
                resolver();
            }
        }
    }

    /** Called when client VAD signals speech start over RTCDataChannel */
    private onSpeechStart(clientID: string, timestamp: number) {
        this.speekingUsers.set(clientID, timestamp);
        this.devConsole(`[RealTimeVoiceAgent] User started speaking (ClientID: ${clientID}, Timestamp: ${timestamp})`, "log");
        
        // Interrupt ongoing background/synthesis actions when user starts talking
        this.internalEvents.emit("interrupt-internal", clientID);

        // Terminate any existing speech session for this client
        const existingSession = this.activeSpeechSessions.get(clientID);
        if (existingSession) {
            existingSession.isSpeaking = false;
            existingSession.sessionAbortController.abort();

            // Flush and notify any pending resolvers so they wake up and terminate
            existingSession.chunkResolvers.forEach((resolve) => resolve());
            existingSession.chunkResolvers = [];
        }

        const sessionAbortController = new AbortController();

        // Initialize new speech session
        const session = {
            audioBuffers: [],
            chunkQueue: [],
            queueReadHead: 0,
            chunkResolvers: [] as Array<() => void>,
            isSpeaking: true,
            sessionAbortController
        };

        // Attach abort handler to flush resolvers if aborted asynchronously
        sessionAbortController.signal.addEventListener("abort", () => {
            session.isSpeaking = false;
            session.chunkResolvers.forEach((resolve) => resolve());
            session.chunkResolvers = [];
        }, { once: true });

        this.activeSpeechSessions.set(clientID, session);

        // Execute STT pipeline unblockingly (asynchronously without blocking WebRTC/Event thread)
        this.executeSTTPipelineUnblocking(clientID, session).catch((err) => {
            this.devConsole(`[RealTimeVoiceAgent] STT Pipeline error for ClientID ${clientID}: ${err}`, "error");
        });
    }

    /** Helper to create a WAV file Buffer with RIFF header around raw PCM16 audio */
    private createWavBuffer(pcmBuffer: Buffer, sampleRate: number = 16000, numChannels: number = 1, bitDepth: number = 16): Buffer {
        const dataSize = pcmBuffer.length;
        const headerSize = 44;
        const wavBuffer = Buffer.alloc(headerSize + dataSize);

        // RIFF chunk descriptor
        wavBuffer.write("RIFF", 0);
        wavBuffer.writeUInt32LE(36 + dataSize, 4);
        wavBuffer.write("WAVE", 8);

        // fmt sub-chunk
        wavBuffer.write("fmt ", 12);
        wavBuffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        wavBuffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
        wavBuffer.writeUInt16LE(numChannels, 22);
        wavBuffer.writeUInt32LE(sampleRate, 24);
        wavBuffer.writeUInt32LE(sampleRate * numChannels * (bitDepth / 8), 28); // ByteRate
        wavBuffer.writeUInt16LE(numChannels * (bitDepth / 8), 32); // BlockAlign
        wavBuffer.writeUInt16LE(bitDepth, 34);

        // data sub-chunk
        wavBuffer.write("data", 36);
        wavBuffer.writeUInt32LE(dataSize, 40);

        pcmBuffer.copy(wavBuffer, headerSize);
        return wavBuffer;
    }

    /** Asynchronous unblocking pipeline for interim / volatile STT processing */
    private async executeSTTPipelineUnblocking(
        clientID: string,
        session: {
            audioBuffers: Buffer[];
            chunkQueue: Buffer[];
            queueReadHead: number;
            chunkResolvers: Array<() => void>;
            isSpeaking: boolean;
            sessionAbortController: AbortController;
        }
    ) {
        const sttModel = this.config.agent.models.stt;
        const sttMode = this.config.agent.models.sttMode ?? "volatile";

        if (!sttModel) {
            this.devConsole(`[RealTimeVoiceAgent] No STT model specified in configuration`, "warn");
            return;
        }

        // Check whether stt is custom STTModel or standard AgentModel with .stt() method
        const isCustomSTT = typeof (sttModel as STTModel).transcribeInterim === "function";

        if (sttMode === "volatile" && isCustomSTT) {
            this.devConsole(`[RealTimeVoiceAgent] Starting volatile STT stream pipeline for ClientID: ${clientID}`, "log");
            
            // Create AsyncIterable for incoming subchunks with O(1) queue reading
            const audioStream: AsyncIterable<Buffer> = {
                async *[Symbol.asyncIterator]() {
                    while (session.isSpeaking || session.queueReadHead < session.chunkQueue.length) {
                        if (session.sessionAbortController.signal.aborted) break;

                        if (session.queueReadHead < session.chunkQueue.length) {
                            const chunk = session.chunkQueue[session.queueReadHead];
                            
                            session.queueReadHead++;
                            // Reclaim memory periodically when read head gets large
                            if (session.queueReadHead > 100 && session.queueReadHead >= session.chunkQueue.length) {
                                session.chunkQueue = [];
                                session.queueReadHead = 0;
                            }
                            
                            yield chunk;
                        } else {
                            await new Promise<void>((resolve) => {
                                session.chunkResolvers.push(resolve);
                            });
                        }
                    }
                }
            };

            const volatileSTT = (sttModel as STTModel).transcribeVolatile(
                audioStream,
                { sampleRate: 16000, encoding: "pcm" }
            );

            for await (const transcriptResponse of volatileSTT) {
                if (session.sessionAbortController.signal.aborted) break;
                
                this.internalEvents.emit("stt-transcript-interim", {
                    clientID,
                    transcript: transcriptResponse.text,
                    isFinal: transcriptResponse.isFinal,
                    raw: transcriptResponse.raw
                });

                this.devConsole(`[RealTimeVoiceAgent] Volatile STT transcript [${clientID}] (isFinal=${transcriptResponse.isFinal}): "${transcriptResponse.text}"`, "log");
            }
        } else {
            this.devConsole(`[RealTimeVoiceAgent] STT Mode set to 'interim' or model is non-streaming for ClientID: ${clientID}`, "log");
        }
    }

    /** Called when client VAD signals speech end over RTCDataChannel */
    private async onSpeechEnd(clientID: string, timestamp: number) {
        this.speekingUsers.delete(clientID);
        this.devConsole(`[RealTimeVoiceAgent] User stopped speaking (ClientID: ${clientID}, Timestamp: ${timestamp})`, "log");
        
        const session = this.activeSpeechSessions.get(clientID);
        if (session) {
            session.isSpeaking = false;
            // Flush any waiting resolvers
            session.chunkResolvers.forEach((resolve) => resolve());
            session.chunkResolvers = [];

            const sttModel = this.config.agent.models.stt;
            let finalTranscript = "";

            if (session.audioBuffers.length > 0 && sttModel) {
                const fullAudioBuffer = session.audioBuffers.length === 1
                    ? session.audioBuffers[0]
                    : Buffer.concat(session.audioBuffers);

                try {
                    if (typeof (sttModel as STTModel).transcribeInterim === "function") {
                        const res = await (sttModel as STTModel).transcribeInterim(fullAudioBuffer, {
                            sampleRate: 16000,
                            encoding: "pcm"
                        });
                        finalTranscript = res.text;
                    } else if (typeof (sttModel as any).stt === "function") {
                        const wavBuffer = this.createWavBuffer(fullAudioBuffer, 16000, 1, 16);
                        const file = new File([wavBuffer as any], "speech.wav", { type: "audio/wav" });
                        finalTranscript = await (sttModel as any).stt(file);
                    }
                } catch (err) {
                    this.devConsole(`[RealTimeVoiceAgent] Error transcribing interim audio for ClientID ${clientID}: ${err}`, "error");
                }

                if (!session.sessionAbortController.signal.aborted) {
                    this.internalEvents.emit("stt-transcript-final", {
                        clientID,
                        transcript: finalTranscript,
                        audioBuffer: fullAudioBuffer
                    });
                }
            } else if (!session.sessionAbortController.signal.aborted) {
                this.internalEvents.emit("stt-transcript-final", {
                    clientID,
                    transcript: "",
                    audioBuffer: Buffer.alloc(0)
                });
            }

            this.devConsole(`[RealTimeVoiceAgent] Finalized speech transcript [${clientID}]: "${finalTranscript}"`, "log");

            // Abort session signal to notify external background listeners
            session.sessionAbortController.abort();

            // Delete session only if it's still the active session for this client
            if (this.activeSpeechSessions.get(clientID) === session) {
                this.activeSpeechSessions.delete(clientID);
            }
        }
    }

    private devConsole(log: string, mode: keyof Pick<typeof console, "error" | "log" | "warn">) {
        if (this.config?.operationMode === "dev") {
            console[mode](log);
        }
    }

    private async createRemoteAgent() {
        const { config } = this;
        const { server: serverConfig, eventVerification: serverConnectionVerification } = config.executionMode as ExecutionRemoteMode;
        
        // Server Config
        const express = await import('express');
        const http = await import('node:http');
        const { Server } = await import('socket.io');
        const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, nonstandard } = await import('@roamhq/wrtc');
        const { RTCAudioSource, RTCVideoSource } = nonstandard;

        const app = express.default();
        const server = http.createServer(app);
        const io = new Server(
            server,
            serverConfig.socketIo.serverOptions ?? { cors: { origin: '*' } }
        );
        this.serverInstance = server;

        app.use(express.static('public'));

        if (serverConnectionVerification) {
            io.use(async (socket, next) => {
                const { auth, query, headers } = socket.handshake;
                const verificationResult = await serverConnectionVerification(auth, query);

                if (!verificationResult) {
                    return next(new Error("Verification refused socket.io connection"))
                }

                if (typeof verificationResult === "object") {
                    socket.data.clientID = verificationResult.clientID;
                }
                else if (typeof verificationResult === "string") {
                    socket.data.clientID = verificationResult;
                }

                socket.data.query = query;
                socket.data.headers = headers;
                next();
            });
        }
        
        io.on('connection', (socket) => {
            const { clientID, query, headers } = socket.data;
            
            // Send connection success to frontend lib
            socket.emit("connection_success", clientID);
            
            let pc = new RTCPeerConnection({
                iceServers: serverConfig.webRTC.iceServers
            });

            // Setup tracks
            const audioSource = new RTCAudioSource();
            const audioTrack = audioSource.createTrack();
            pc.addTrack(audioTrack);

            let videoSource = null;
            if (config.agent.models.avatar) {
                videoSource = new RTCVideoSource();
                const videoTrack = videoSource.createTrack();
                pc.addTrack(videoTrack);
            }

            // Add client to active clients
            this.activeClients.set(clientID, { 
                socket, 
                pc, 
                logicAbortController: null, 
                authParams: { query, headers },
                audioSource: audioSource,
                videoSource: videoSource
            });

            // 1. Handle data channel
            pc.ondatachannel = (event) => {
                const receiveChannel = event.channel;
                
                receiveChannel.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        const { event: eventType, data: eventData, timestamp: eventTimestamp } = msg;
                        
                        if (eventType === 'speech_start') {
                            this.onSpeechStart(clientID, eventTimestamp);
                        }
                        else if (eventType === 'speech_end') {
                            this.onSpeechEnd(clientID, eventTimestamp);
                        }
                        else if (eventType === 'track_id') {
                            if (eventData && typeof eventData === "string") {
                                const { trackID, clientID } = JSON.parse(eventData);
        
                                // Retrived each time the track id arrives
                                this.usersTrackID.set(clientID, trackID)
                            }
                        }
                        else if (eventType === "track_clear") {
                            const trackID = eventData;
                            const clientTrackID = this.usersTrackID.get(clientID);

                            if (clientTrackID === trackID) {
                                this.usersTrackID.delete(clientID);
                            }
                        }
                        else if (eventType === "abort") {
                            const client = this.activeClients.get(clientID);
                            if (client?.logicAbortController) {
                                client.logicAbortController.abort();
                                this.devConsole(`[RealTimeVoiceAgent] Aborted agent action for ClientID: ${clientID}`, "log");
                            }
                        }
                    }
                    catch(err) {
                        console.error(`RealTimeAgent: Data Channel error detected`, err);
                    }
                };

                receiveChannel.onopen = () => {
                    this.devConsole('Data channel is ready', "log");

                    // Add new channel
                    const channel = this.clientsDataChannels.operand.get(clientID);
                    if (channel) {
                        channel[receiveChannel.label] = receiveChannel;
                        this.clientsDataChannels.operand.set(clientID, channel);
                    }
                    else {
                        this.clientsDataChannels.operand.set(clientID, {
                            events: receiveChannel
                        });
                    }
                };
                receiveChannel.onclose = () => {
                    // Delete Specific channel
                    const channel = this.clientsDataChannels.operand.get(clientID);
                    if (channel) {
                        if (!Object.keys(channel).length) {
                            this.clientsDataChannels.operand.delete(clientID);
                        }
                        else {
                            delete channel[receiveChannel.label];
                            this.clientsDataChannels.operand.set(clientID, channel);
                        }
                    }
                }
            };
            
            // 1. Handle incoming media track from client
            pc.ontrack = (event) => {
                this.devConsole(`Received track from client: ${event.track.kind}, ClientID: ${clientID}`, "log");
                
                if (event.track.kind === 'audio') {
                    const audioStream = event.streams[0];
                    const track = event.track;
                    const cleanupTrack = (reason: string) => {
                        this.devConsole(`[RealTimeVoiceAgent] Audio track ${reason} for ClientID: ${clientID}`, "log");
                        this.clientAudioStreams.delete(clientID);
                        this.speekingUsers.delete(clientID);
                        this.usersTrackID.delete(clientID);
                    };

                    // Setup the audio stream for client to the audio buffer
                    this.clientAudioStreams.set(clientID, audioStream);

                    track.onended = () => cleanupTrack('ended');
                    track.onmute = () => cleanupTrack('muted');
                    track.onunmute = () => {
                        this.devConsole(`[RealTimeVoiceAgent] Audio track unmuted for ClientID: ${clientID}`, "log");
                        this.clientAudioStreams.set(clientID, audioStream);
                    };
                    
                    // Pass audioStream to your AI Pipeline (e.g., Whisper, Deepgram, or Custom STT)
                    this.processIncomingAudio(clientID);
                }
            };

            // 2. Pass server ICE candidates to client
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', event.candidate);
                }
            };

            // 3. Receive offer from browser and create answer
            let isRemoteDescriptionSet = false;
            const iceCandidateQueue: RTCIceCandidateInit[] = [];

            socket.on('offer', async (sdp, cb) => {
                await pc.setRemoteDescription(new RTCSessionDescription(sdp));
                isRemoteDescriptionSet = true;

                // Process buffered candidates
                while (iceCandidateQueue.length > 0) {
                    const candidate = iceCandidateQueue.shift();
                    if (candidate) {
                        await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                
                cb(pc.localDescription);
            });

            socket.on('ice-candidate', async (candidate) => {
                if (!pc) return;

                if (isRemoteDescriptionSet) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                } else {
                    iceCandidateQueue.push(candidate);
                }
            });

            socket.on('disconnect', () => {
                this.clientAudioStreams.delete(clientID);
                this.speekingUsers.delete(clientID);
                this.usersTrackID.delete(clientID);
                
                const client = this.activeClients.get(clientID);
                if (client?.logicAbortController) {
                    client.logicAbortController.abort();
                }
                this.activeClients.delete(clientID);

                pc.close();
            });
        });

        server.listen(serverConfig.socketIo.port, () => this.devConsole(`Agent Server running on port ${serverConfig.socketIo.port}`, "log"));
    }

    /** Start the RealTimeAgent instance - from this point it starts listen for connections */
    async run() {
        const { config } = this;
        
        if (config.executionMode.mode === "remote") {
            await this.createRemoteAgent();
        }
        else if (config.executionMode.mode === "local") {
            // TODO:
        }
        else throw(`"${(config.executionMode as any).mode}" don't exist in register of possible execution modes for RealTimeAgent`);
    }

    /** 
     * Use this method to cancel all listening and to abort the pending agents
    */
    public async abort() {
        this.devConsole("[RealTimeVoiceAgent] Global Abort initiated. Closing all connections.", "warn");
        
        for (const [clientID, client] of this.activeClients.entries()) {
            this.devConsole(`[RealTimeVoiceAgent] Aborting and closing connection for ClientID: ${clientID}`, "log");
            
            // Abort running agent for this client
            if (client.logicAbortController) {
                client.logicAbortController.abort();
            }

            // Emit abort to client
            this.clientsDataChannels.emitEvent(clientID, "abort", { reason: "Global abort triggered" });

            // Close connection
            client.pc.close();
            client.socket.disconnect();
        }

        this.activeClients.clear();

        if (this.serverInstance) {
            return new Promise<void>((resolve) => {
                this.serverInstance.close(() => {
                    this.devConsole("[RealTimeVoiceAgent] Server shut down successfully.", "log");
                    resolve();
                });
            });
        }
    }
}
