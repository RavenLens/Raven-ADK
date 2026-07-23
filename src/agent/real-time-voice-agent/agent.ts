import { HITLTransportSchema } from "../tools/hitl/hitlToolSchema";
import { ExecutionRemoteMode, RealTimeVoiceAgentConfig, RealTimeVoiceAgentSchemaMemoryStore, RealTimeVoiceAgentSkillsSchema } from "./agentConfig";

const realTimeAgent = new RealTimeVoiceAgent({
    executionMode: {
        mode: "remote",
        server: {
            webRTC: {
                iceServers: []
            },
            socketIo: {
                port: 3000
            }
        },
    },
    agent: {
        models: {
            tts: ""
        }
    }
})

export class RealTimeVoiceAgent<
    RealTimeVoiceAgentSkills extends RealTimeVoiceAgentSkillsSchema,
    Memory extends RealTimeVoiceAgentSchemaMemoryStore,
    HITL extends HITLTransportSchema
> {
    config: RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills, Memory, HITL>;
    
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
    private processIncomingAudio() {

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

        // Verification
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
            // Send connection success to frontend lib
            socket.emit("connection_success", socket.data.clientID);
            
            let pc = new RTCPeerConnection({
                iceServers: serverConfig.webRTC.iceServers
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

            socket.on("track-id", (clientID, trackID) => {
                // TODO: Register track id for clientID - write to some buffer
            });

            /**
             * Emitted once VAD detected the speech start
             * It's to act as the Interruption for agent generation of responses
            */
            socket.on("speech-start", () => {
                
            })
            
            /** Emitted once user VAD detected the speech stop */
            socket.on("speech-stop", () => {

            });

            socket.on('disconnect', () => {
                pc.close();
            });
        });

        function processIncomingAudio(stream) {
            // Use non-blocking audio sink / PCM frame extractors to stream raw audio bytes to your LLM/Speech engine
            console.log('Processing stream for AI Agent...');
        }

        server.listen(serverConfig.socketIo.port, () => console.log(`Agent Server running on port ${serverConfig.socketIo.port}`));
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
