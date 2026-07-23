import { HITLTransportSchema } from "../tools/hitl/hitlToolSchema";
import { ExecutionRemoteMode, RealTimeVoiceAgentConfig, RealTimeVoiceAgentSchemaMemoryStore, RealTimeVoiceAgentSkillsSchema } from "./agentConfig";
import { EventEmitter } from "node:events";
import { STTModel, STTResponse } from "./stt";

export class RealTimeVoiceAgent<
    RealTimeVoiceAgentSkills extends RealTimeVoiceAgentSkillsSchema,
    Memory extends RealTimeVoiceAgentSchemaMemoryStore,
    HITL extends HITLTransportSchema
> {
    config: RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills, Memory, HITL>;
    usersTrackID = new Map<string, string>([]);
    speekingUsers = new Map<string, number>();
    clientAudioStreams = new Map<string, MediaStream>();
    
    // Unblocking audio processing queues and STT stream sessions per client
    private activeSpeechSessions = new Map<string, {
        audioBuffers: Buffer[];
        chunkQueue: Buffer[];
        chunkResolvers: Array<() => void>;
        isSpeaking: boolean;
        sessionAbortController: AbortController;
    }>();

    private internalEvents: EventEmitter = new EventEmitter();
    
    constructor(config: RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills, Memory, HITL>) {
        this.config = {
            ...config,
            operationMode: config.operationMode ?? "production"
        };
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
        this.internalEvents.emit("interrupt-internal");

        // Terminate any existing speech session for this client
        const existingSession = this.activeSpeechSessions.get(clientID);
        if (existingSession) {
            existingSession.sessionAbortController.abort();
        }

        // Initialize new speech session
        const session = {
            audioBuffers: [],
            chunkQueue: [],
            chunkResolvers: [],
            isSpeaking: true,
            sessionAbortController: new AbortController()
        };
        this.activeSpeechSessions.set(clientID, session);

        // Execute STT pipeline unblockingly (asynchronously without blocking WebRTC/Event thread)
        this.executeSTTPipelineUnblocking(clientID, session).catch((err) => {
            this.devConsole(`[RealTimeVoiceAgent] STT Pipeline error for ClientID ${clientID}: ${err}`, "error");
        });
    }

    /** Asynchronous unblocking pipeline for interim / volatile STT processing */
    private async executeSTTPipelineUnblocking(
        clientID: string,
        session: {
            audioBuffers: Buffer[];
            chunkQueue: Buffer[];
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
            
            // Create AsyncIterable for incoming subchunks
            const self = this;
            const audioStream: AsyncIterable<Buffer> = {
                async *[Symbol.asyncIterator]() {
                    while (session.isSpeaking || session.chunkQueue.length > 0) {
                        if (session.sessionAbortController.signal.aborted) break;
                        if (session.chunkQueue.length > 0) {
                            yield session.chunkQueue.shift()!;
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

            const fullAudioBuffer = Buffer.concat(session.audioBuffers);
            const sttModel = this.config.agent.models.stt;
            let finalTranscript = "";

            if (sttModel) {
                try {
                    if (typeof (sttModel as STTModel).transcribeInterim === "function") {
                        const res = await (sttModel as STTModel).transcribeInterim(fullAudioBuffer, {
                            sampleRate: 16000,
                            encoding: "pcm"
                        });
                        finalTranscript = res.text;
                    } else if (typeof (sttModel as any).stt === "function") {
                        const file = new File([fullAudioBuffer as any], "speech.wav", { type: "audio/wav" });
                        finalTranscript = await (sttModel as any).stt(file);
                    }
                } catch (err) {
                    this.devConsole(`[RealTimeVoiceAgent] Error transcribing interim audio for ClientID ${clientID}: ${err}`, "error");
                }
            }

            this.internalEvents.emit("stt-transcript-final", {
                clientID,
                transcript: finalTranscript,
                audioBuffer: fullAudioBuffer
            });

            this.devConsole(`[RealTimeVoiceAgent] Finalized speech transcript [${clientID}]: "${finalTranscript}"`, "log");
            this.activeSpeechSessions.delete(clientID);
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
        const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = await import('@roamhq/wrtc');

        const app = express.default();
        const server = http.createServer(app);
        const io = new Server(
            server,
            serverConfig.socketIo.serverOptions ?? { cors: { origin: '*' } }
        );

        app.use(express.static('public'));

        if (serverConnectionVerification) {
            io.use(async (socket, next) => {
                const { auth, query } = socket.handshake;
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

                next();
            });
        }
        
        io.on('connection', (socket) => {
            const clientID = socket.data.clientID;
            
            // Send connection success to frontend lib
            socket.emit("connection_success", clientID);
            
            let pc = new RTCPeerConnection({
                iceServers: serverConfig.webRTC.iceServers
            });

            // 1. Handle data channel TODO: Handle messages here
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
                    }
                    catch(err) {
                        console.error(`RealTimeAgent: Data Channel error detected`, err);
                    }
                };

                receiveChannel.onopen = () => this.devConsole('Data channel is ready', "log");
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
}
