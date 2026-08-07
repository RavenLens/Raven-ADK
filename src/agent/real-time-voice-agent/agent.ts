import { HITLTransportSchema } from "../tools/hitl/hitlToolSchema";
import { AuthPayload, CommunicationSpeechLevelsDetails, ConfigLessSchemaMemoryStore, ConfigLessSchemaSkillsStore, ExecutionRemoteMode, RealTimeVoiceAgentConfig, RealTimeVoiceAgentSchemaMemoryStore, RealTimeVoiceAgentSkillsSchema, SpeakBeforeAfter, SpeakPositionRecordKeys, TranscriberModelPromptAddition, VoiceAgentDescriptionConfig } from "./agentConfig";
import { EventEmitter } from "node:events";
import { STTModel } from "./stt";
import { ReActAgent, ReActAgentEvents } from "../ReAct.agent";

/**
 * @param result - isn't included in `CommunicationSpeechLevelsDetails` to don't introduce the breaking feature
*/
export type SpeechLevel = keyof Exclude<NonNullable<RealTimeVoiceAgentConfig<any, any, any>["communicationSpeechLevels"]>, string> | "result";

/** Events for the **RealTimeVoiceAgent** */
export interface RealTimeVoiceAgentEvents {
    "stt_transcript_interim": (data: { clientID: string; transcript: string; isFinal: boolean; raw: any }) => void | Promise<void>;
    "stt_transcript_final": (data: { clientID: string; transcript: string; audioBuffer: Buffer }) => void | Promise<void>;
    "logic_start": (data: { clientID: string; transcript: string }) => void | Promise<void>;
    "logic_finish": (data: { clientID: string; result: any }) => void | Promise<void>;
    "speech_segment": (data: { clientID: string; type: SpeechLevel; text: string }) => void | Promise<void>;
    "interrupt": (data: { clientID: string }) => void | Promise<void>;
    "speech_interrupted": (data: { clientID: string; reason: "flush" | "user" }) => void | Promise<void>;
    "speech_start": (data: { clientID: string; timestamp: number }) => void | Promise<void>;
    "speech_end": (data: { clientID: string; timestamp: number }) => void | Promise<void>;
    "speak_before_start": (data: { clientID: string }) => void | Promise<void>;
    "speak_before_end": (data: { clientID: string }) => void | Promise<void>;
    "speak_before_error": (data: { clientID: string; error: any | null }) => void | Promise<void>;
    "abort": (data: { clientID: string; reason: string }) => void | Promise<void>;
    "transcriber_start": (data: { clientID: string; toSpeakBeforeTranscription: string }) => void | Promise<void>;
    "transcriber_end": (data: { clientID: string; readyTranscription: string }) => void | Promise<void>;
}

/** Store RTC Data Channels */
export class WebRTCClientDataChannels {
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
    emitTranscriptionEvent(clientID: string, mode: "start" | "end", body: { place: Exclude<SpeechLevel, "result"> | "afterFullSTTTranscript"; transcript: string; body?: Record<string, any>; }) {
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
    clientsDataChannels: WebRTCClientDataChannels = new WebRTCClientDataChannels();
    speakingUsers = new Map<string, number>();
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
    private outputSpeechQueues = new Map<string, {
        queue: Array<{ text: string; type: SpeechLevel; abort?: AbortSignal; args?: any[]; describeVoiceInstruction?: string; resolve: () => void }>;
        currentAbortController: AbortController | null;
        isProcessing: boolean;
    }>();
    private internalEvents: EventEmitter = new EventEmitter();
    private activeClients = new Map<string, { socket: any; pc: any; logicAbortController: AbortController | null; authParams: AuthPayload; audioSource?: any; videoSource?: any; }>();
    private serverInstance: any = null;

    // Event Listeners
    /**
     * Listens local Events for the **ReActAgent** serves as internal logic
    */
    private LogicEventsListeners: Record<string, Array<(...args: any[]) => void | Promise<void>>> = {};
    /**
     * Listens locall events for **RealTimeVoiceAgent**
     */
    private RealTimeVoiceAgentEventsListeners: Record<string, Array<(...args: any[]) => void | Promise<void>>> = {};
    
    constructor(config: RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills, Memory, HITL>) {
        this.config = {
            ...config,
            operationMode: config.operationMode ?? "production",
            communicationSpeechLevels: config.communicationSpeechLevels ?? "all"
        };

        /* Listen internal logic events */
        this.internalEvents.on("interrupt-internal", (clientID: string) => {
            this.flushSpeakQueue(clientID, "user");
            this.emitSpeechQueueEvent(clientID, "interrupt", [{ clientID }]);
        });
        
        this.internalEvents.on("stt_transcript_interim", ({
            clientID,
            transcript,
            isFinal,
            raw
        }: { clientID: string; transcript: string; isFinal: boolean; raw: any; }) => {
            // Emit event
            this.clientsDataChannels.emitEvent(clientID, "realtime_agent.stt_transcript_interim", { transcript, isFinal });
        });
        
        // It's the final trasncript arrived from the message
        // From this place agent begins execution
        this.internalEvents.on("stt_transcript_final", async ({ clientID, transcript, audioBuffer }: { clientID: string; transcript: string; audioBuffer: Buffer }) => {
            // Emit Client Text Event
            this.clientsDataChannels.emitEvent(clientID, "realtime_agent.stt_transcript_final", { transcript });
            
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
            this.emitRealTimeVoiceAgentEvent(clientID, "logic_start", [{ clientID, transcript }]);

            // Config ReAct Agent
            const { authParams } = this.activeClients.get(clientID)!;
            const memory = config.agent.memory.memory?.(clientID, authParams);
            const agent = new ReActAgent({
                model: config.agent.models.reasoning,
                systemPrompt: `${config.agent.systemPrompt}

    ## Thoughs generation rule
    - You work in the RealTimeVoice Agent pipeline where the thoughs are said aloud by another tts model, therefore you've to generate thoughts are able to be said in understandable way for human and simulatenously showing what you're doing
                `,
                messages: config.agent.messages,
                skills: config.agent.skills?.(clientID, authParams),
                memory,
                tools: config.agent.tools,
                plugins: this.config.agent.plugins,
                hitl: config.agent.hitl?.(clientID, authParams).hitl,
                subagents: config.agent.subagents,
                maximumReasoningRecalls: config.agent.maximumReasoningRecalls,
                withConclusion: config.agent.withConclusion,
                parallelizeSubagents: config.agent.parallelizeSubagents,
                parallelTools: config.agent.parallelTools,
                abort: logicAbortController.signal
            });

            // Pipe all agent events to the client and handle voice-feedback for non-plugin events
            agent.onAnyEvent(async (event, ...args) => {
                /**
                 * Check is skill called and execute speech for skill
                 * @returns {boolean} - the skill detection state
                */
                const skillToolCallUnified = async (actionType: SpeakPositionRecordKeys) => {
                    const [toolName] = args;

                    const specifiedSkillsToSay = Object.entries(config.agent.skills?.(clientID, authParams)?.config?.actionsVoiceDescriptionInstruction ?? {}) as unknown as [
                        keyof ConfigLessSchemaSkillsStore,
                        SpeakBeforeAfter
                    ][];
                    const isSkillFound = specifiedSkillsToSay.find(([skillToolName, skillSpec]) => skillToolName === toolName && (skillSpec[actionType] === true || (typeof skillSpec[actionType] === "object" && skillSpec[actionType].sayAloud)));
                    
                    if (isSkillFound) {
                        const speakType = isSkillFound[1][actionType];

                        // Adds speak type
                        args.push({ speakType: speakType });
                        
                        const speakPromise = this.speak(
                            clientID,
                            actionType === "speakAfter" ? `I performed ${toolName} skill` : `I'm performing ${toolName} skill`, 
                            "skills",
                            logicAbortController.signal,
                            args,
                            typeof speakType === "object" ? speakType.describeVoiceInstruction : undefined
                        );

                        if (this.config.speechBlocksReasoningEngine) {
                            await speakPromise;
                        }

                        return true;
                    }

                    return false;
                }

                /**
                 * Execute tool when tool isn't `isSkillTool`
                 * @param event - where was called
                 * @param isSkillTool - state whether was detected skill tool
                 * @returns represents whether logic was successfully passed
                 */
                const toolUnified = async <Event extends keyof Pick<ReActAgentEvents, "tool_invoked" | "tool_executed">>(event: Event, isSkillTool: boolean) => {
                    // Skill tool gets other handler
                    if (isSkillTool) return false;
                    
                    const [toolName, toolParams, toolOutput] = args as Parameters<ReActAgentEvents[Event]>;
                    const toolFound = this.config.agent.tools.find(tool => tool.toolConfig.toolName === toolName);

                    const configuredMemories = Array.isArray(memory) ? memory : memory ? [memory] : [];
                    const memoryTool = configuredMemories
                        .map(entry => {
                            const configuredMemory = (entry as any).memory ?? entry;
                            if (configuredMemory?.typeMemory !== "toolBased") return undefined;

                            const toolKind = configuredMemory.memoryTools.fetch?.toolName === toolName
                                ? "fetch"
                                : configuredMemory.memoryTools.update?.toolName === toolName
                                    ? "update"
                                    : undefined;
                            return toolKind ? { memory: configuredMemory, toolKind } : undefined;
                        })
                        .find(Boolean) as { memory: { name: string }; toolKind: "fetch" | "update" } | undefined;

                    if (memoryTool) {
                        const voiceConfig = this.config.agent.memorySpeech?.[memoryTool.memory.name]?.tools?.[memoryTool.toolKind]?.[event === "tool_executed" ? "speakAfter" : "speakBefore"];
                        const canMemoryToolBeTold = voiceConfig !== false
                            && (typeof voiceConfig !== "object" || voiceConfig.sayAloud !== false);
                        if (voiceConfig !== undefined && canMemoryToolBeTold) {
                            const configuredInstruction = typeof voiceConfig === "object" ? voiceConfig.defaultInstruction : undefined;
                            const instruction = typeof configuredInstruction === "function"
                                ? await configuredInstruction(memoryTool.memory.name, memoryTool.toolKind, toolParams, toolOutput)
                                : configuredInstruction;
                            const defaultInstruction = event === "tool_invoked"
                                ? `I'm fetching information from ${memoryTool.memory.name} memory`
                                : `I've updated ${memoryTool.memory.name} memory`;
                            const speakPromise = this.speak(
                                clientID,
                                instruction ?? defaultInstruction,
                                "memory",
                                logicAbortController.signal,
                                args,
                                typeof voiceConfig === "object" ? voiceConfig.describeVoiceInstruction : undefined
                            );
                            if (this.config.speechBlocksReasoningEngine) await speakPromise;
                            return true;
                        }
                    }

                    const afterOrBeforeKey: SpeakPositionRecordKeys = event === "tool_executed" ? "speakAfter" : "speakBefore";
                    const canToolBeTold = (!toolFound?.describeVoiceInstruction || !toolFound.describeVoiceInstruction[afterOrBeforeKey]) || (typeof toolFound.describeVoiceInstruction[afterOrBeforeKey] === "object" && (toolFound.describeVoiceInstruction[afterOrBeforeKey].sayAloud === true || toolFound.describeVoiceInstruction[afterOrBeforeKey].sayAloud === undefined));
                    
                    if (toolFound && canToolBeTold) {
                        const userConfigInstruction = async () => {
                            const voiceConfig = toolFound.describeVoiceInstruction?.[afterOrBeforeKey];
                            const def = typeof voiceConfig === "object" ? voiceConfig.defaultInstruction : undefined;

                            if (typeof def === "function") {
                                return await def(toolName, toolParams, toolOutput);
                            } else if (typeof def === "string" && def.length) {
                                return def;
                            }

                            return;
                        };
                        const defaultInstruction = () => {
                            if (event === "tool_invoked") {
                                return `I'm using ${toolName} tool to help you`;
                            }

                            // TODO: In feature the tool result can be potentially transcribed and used to translate here -> user has to specify this in configuration object and tool call is got as the name
                            return `I've executed ${toolName} and successfully retrived output`;
                        }
                        
                        const speakPromise = this.speak(
                            clientID,
                            (await userConfigInstruction()) ?? defaultInstruction(),
                            "tools",
                            logicAbortController.signal,
                            args,
                            typeof toolFound.describeVoiceInstruction?.[afterOrBeforeKey] === "object" ? toolFound.describeVoiceInstruction[afterOrBeforeKey].describeVoiceInstruction : undefined
                        );

                        if (this.config.speechBlocksReasoningEngine) {
                            await speakPromise;
                        }

                        return true;
                    }

                    return false;
                }
                
                // Before tool call
                if (event === "tool_invoked") {
                    const isSkillTool = await skillToolCallUnified("speakBefore");
                    const toolExecuted = await toolUnified(event, isSkillTool);
                }
                
                // After tool call
                if (event === "tool_executed") {
                    const isSkillTool = await skillToolCallUnified("speakAfter");
                    const toolExecuted = await toolUnified(event, isSkillTool);
                }

                if (event === "reasoning") {
                    const [thought] = args as Parameters<ReActAgentEvents["reasoning"]>;
                    if (thought) {
                        const speakPromise = this.speak(clientID, thought, "thoughts", logicAbortController.signal);
                        if (this.config.speechBlocksReasoningEngine) {
                            await speakPromise;
                        }
                    }
                }

                // HITL
                const hitlUnified = async (event: "hitl_triggered" | "hitl_result") => {
                    const [type, payload] = args as Parameters<ReActAgentEvents["hitl_triggered"]>;
                    const result = event === "hitl_result"
                        ? (args as Parameters<ReActAgentEvents["hitl_result"]>)[2]
                        : undefined;

                    const hitlConfig = this.config.agent.hitl?.(clientID, authParams);
                    if (!hitlConfig) return false;

                    const mapping = {
                        tool_usage: "emitToolUsage",
                        question_abc: "emitAbcQuestion",
                        question_open: "emitOpenQuestion",
                        acceptance: "emitAcceptance"
                    } as const;

                    const hitlKey = mapping[type];
                    const speakPosition: SpeakPositionRecordKeys = event === "hitl_result" ? "speakAfter" : "speakBefore";

                    if (type === "tool_usage") {
                        const toolName = payload.toolName;
                        const toolUsage = hitlConfig.toolsUsage?.[toolName];
                        if (!toolUsage) return false;

                        const voiceConfig = toolUsage.describeVoiceInstruction?.[speakPosition];
                        if (!voiceConfig) return false;

                        const configuredInstruction = typeof voiceConfig === "object"
                            ? voiceConfig.defaultInstruction
                            : undefined;

                        const instruction = typeof configuredInstruction === "function"
                            ? await (configuredInstruction as any)(toolName, payload.toolArguments, result)
                            : configuredInstruction;

                        const defaultInstruction = event === "hitl_triggered"
                            ? `I need your approval to use the ${toolName} tool`
                            : `I've received your decision regarding the ${toolName} tool`;

                        const speakPromise = this.speak(
                            clientID,
                            instruction ?? defaultInstruction,
                            "hitl",
                            logicAbortController.signal,
                            args,
                            (typeof voiceConfig === "object" ? voiceConfig.describeVoiceInstruction : undefined) ??
                            (typeof hitlConfig.actionsDescribeVoiceInstruction?.emitToolUsage?.[speakPosition] === "object"
                                ? hitlConfig.actionsDescribeVoiceInstruction.emitToolUsage[speakPosition].describeVoiceInstruction
                                : undefined)
                        );

                        if (this.config.speechBlocksReasoningEngine) {
                            await speakPromise;
                        }

                        return true;
                    }
                    else if (hitlKey) {
                        const voiceConfig = hitlConfig.actionsDescribeVoiceInstruction?.[hitlKey]?.[speakPosition];
                        if (!voiceConfig) return false;

                        const configuredInstruction = typeof voiceConfig === "object"
                            ? voiceConfig.defaultInstruction
                            : undefined;

                        const instruction = typeof configuredInstruction === "function"
                            ? await (configuredInstruction as any)(payload, result)
                            : configuredInstruction;

                        const defaultInstruction = event === "hitl_triggered"
                            ? `I need your assistance with a ${type.replace('_', ' ')}`
                            : `Received your response for ${type.replace('_', ' ')}`;

                        const speakPromise = this.speak(
                            clientID,
                            instruction ?? defaultInstruction,
                            "hitl",
                            logicAbortController.signal,
                            args,
                            (typeof voiceConfig === "object" ? voiceConfig.describeVoiceInstruction : undefined)
                        );

                        if (this.config.speechBlocksReasoningEngine) {
                            await speakPromise;
                        }

                        return true;
                    }

                    return false;
                };

                if (event === "hitl_triggered" || event === "hitl_result") {
                    await hitlUnified(event);
                }

                const pluginUnified = async (event: "plugin_invoking" | "plugin_result") => {
                    const [pluginName, executionWay] = args as Parameters<ReActAgentEvents["plugin_invoking"]>;
                    const pluginOutput = event === "plugin_result"
                        ? (args as Parameters<ReActAgentEvents["plugin_result"]>)[2]
                        : undefined;
                    const plugin = this.config.agent.plugins?.find(({ name }) => name === pluginName);
                    const speakPosition: SpeakPositionRecordKeys = event === "plugin_result" ? "speakAfter" : "speakBefore";
                    const voiceConfig = plugin?.describeVoiceInstruction?.[speakPosition];
                    const canPluginBeTold = voiceConfig !== false
                        && (typeof voiceConfig !== "object" || voiceConfig.sayAloud !== false);

                    if (!plugin || !canPluginBeTold) return false;

                    const configuredInstruction = typeof voiceConfig === "object"
                        ? voiceConfig.defaultInstruction
                        : undefined;
                    const instruction = typeof configuredInstruction === "function"
                        ? await configuredInstruction(pluginName, executionWay, pluginOutput)
                        : configuredInstruction;
                    const defaultInstruction = event === "plugin_invoking"
                        ? `I'm using ${pluginName} plugin to help you`
                        : `I've executed ${pluginName} plugin and successfully retrieved output`;

                    const speakPromise = this.speak(
                        clientID,
                        instruction ?? defaultInstruction,
                        "plugins",
                        logicAbortController.signal,
                        args,
                        typeof voiceConfig === "object" ? voiceConfig.describeVoiceInstruction : undefined
                    );

                    if (this.config.speechBlocksReasoningEngine) {
                        await speakPromise;
                    }

                    return true;
                };

                if (event === "plugin_invoking" || event === "plugin_result") {
                    await pluginUnified(event);
                }

                // Memory
                // TODO: Adjust once the memory MemRL, Mem0, MemP and Custom classes arrive
                const memoryActionToConfigKeys: Record<Parameters<ReActAgentEvents["memory_action"]>[0], (keyof ConfigLessSchemaMemoryStore | "fetch" | "save" | "update" | "delete" | "select" | "feedback" | "get_conclusion" | "set_conclusion")[]> = {
                    fetch: ["fetch", "fetchMemory"],
                    save: ["save", "saveMemory"],
                    get_conclusion: ["get_conclusion", "fetchMemoryConclusionFile"],
                    set_conclusion: ["set_conclusion", "writeMemoryConclusionFile"]
                };
                const memoryUnified = async () => {
                    const [action, memoryName, details, result] = args as Parameters<ReActAgentEvents["memory_action"]>;
                    const memoryStore = Array.isArray(memory)
                        ? memory.find(({ name }) => name === memoryName)?.memory
                        : memory;
                    const voiceConfig = this.config.agent.memorySpeech?.[memoryName]?.actions?.[action]?.speakAfter
                        ?? memoryActionToConfigKeys[action]
                            .map(key => memoryStore?.config.actionsVoiceDescriptionInstruction?.[key])
                            .find(config => config !== undefined)?.speakAfter;
                    const canMemoryBeTold = voiceConfig !== false
                        && (typeof voiceConfig !== "object" || voiceConfig.sayAloud !== false);

                    if (voiceConfig === undefined || !canMemoryBeTold) return false;

                    const configuredInstruction = typeof voiceConfig === "object"
                        ? voiceConfig.defaultInstruction
                        : undefined;
                    const instruction = typeof configuredInstruction === "function"
                        ? await configuredInstruction(memoryName, action, details, result)
                        : configuredInstruction;
                    const defaultInstruction = {
                        fetch: `I've fetched information from ${memoryName} memory`,
                        save: `I've saved information to ${memoryName} memory`,
                        get_conclusion: `I've checked the ${memoryName} memory summary`,
                        set_conclusion: `I've updated the ${memoryName} memory summary`
                    }[action];

                    const speakPromise = this.speak(
                        clientID,
                        instruction ?? defaultInstruction,
                        "memory",
                        logicAbortController.signal,
                        args,
                        typeof voiceConfig === "object" ? voiceConfig.describeVoiceInstruction : undefined
                    );

                    if (this.config.speechBlocksReasoningEngine) {
                        await speakPromise;
                    }

                    return true;
                };

                if (event === "memory_action") {
                    await memoryUnified();
                }
                
                // Subagents
                const subagentCallUnified = async (event: "subagent_called" | "subagent_result") => {
                    const [subAgentRole, subagentInstruction] = args as Parameters<ReActAgentEvents["subagent_called"]>;
                    const result = event === "subagent_result"
                        ? (args as Parameters<ReActAgentEvents["subagent_result"]>)[2]
                        : undefined;
                    const subagent = this.config.agent.subagents?.find(({ role }) => role === subAgentRole);
                    const speakPosition: SpeakPositionRecordKeys = event === "subagent_result" ? "speakAfter" : "speakBefore";
                    const voiceConfig = subagent?.describeVoiceInstruction?.[speakPosition];
                    const canSubagentBeTold = voiceConfig !== false
                        && (typeof voiceConfig !== "object" || voiceConfig.sayAloud !== false);

                    if (!subagent || !canSubagentBeTold) return false;

                    const configuredInstruction = typeof voiceConfig === "object"
                        ? voiceConfig.defaultInstruction
                        : undefined;
                    const instruction = typeof configuredInstruction === "function"
                        ? await configuredInstruction(subAgentRole, subagentInstruction, result)
                        : configuredInstruction;
                    const defaultInstruction = event === "subagent_called"
                        ? `I'm delegating this task to my specialist ${subAgentRole}`
                        : `I've received the result from my specialist ${subAgentRole}`;

                    const speakPromise = this.speak(
                        clientID,
                        instruction ?? defaultInstruction,
                        "subagents",
                        logicAbortController.signal,
                        args,
                        typeof voiceConfig === "object" ? voiceConfig.describeVoiceInstruction : undefined
                    );

                    if (this.config.speechBlocksReasoningEngine) {
                        await speakPromise;
                    }

                    return true;
                };

                if (event === "subagent_called" || event === "subagent_result") {
                    await subagentCallUnified(event);
                }

                const subagentToolUnified = async (event: "subagent_tool_invoked" | "subagent_tool_executed") => {
                    const [subAgentRole, toolName, toolParams] = args as Parameters<ReActAgentEvents["subagent_tool_invoked"]>;
                    const toolOutput = event === "subagent_tool_executed"
                        ? (args as Parameters<ReActAgentEvents["subagent_tool_executed"]>)[3]
                        : undefined;
                    const subagent = this.config.agent.subagents?.find(({ role }) => role === subAgentRole);
                    const toolCalls = subagent?.describeVoiceInstruction?.toolCalls;
                    const speakPosition: SpeakPositionRecordKeys = event === "subagent_tool_executed" ? "speakAfter" : "speakBefore";
                    const voiceConfig = toolCalls?.[speakPosition];
                    const canSubagentToolBeTold = voiceConfig !== undefined
                        && voiceConfig !== false
                        && (typeof voiceConfig !== "object" || voiceConfig.sayAloud !== false);

                    if (!canSubagentToolBeTold) return false;

                    const configuredInstruction = typeof voiceConfig === "object"
                        ? voiceConfig.defaultInstruction
                        : undefined;
                    const instruction = typeof configuredInstruction === "function"
                        ? await configuredInstruction(toolName, toolParams, toolOutput)
                        : configuredInstruction;
                    const defaultInstruction = event === "subagent_tool_invoked"
                        ? `My specialist ${subAgentRole} is using ${toolName} to help with this`
                        : `My specialist ${subAgentRole} has completed ${toolName}`;

                    const speakPromise = this.speak(
                        clientID,
                        instruction ?? defaultInstruction,
                        "subagents",
                        logicAbortController.signal,
                        args,
                        typeof voiceConfig === "object" ? voiceConfig.describeVoiceInstruction : undefined
                    );

                    if (this.config.speechBlocksReasoningEngine) {
                        await speakPromise;
                    }

                    return true;
                };

                if (event === "subagent_tool_invoked" || event === "subagent_tool_executed") {
                    await subagentToolUnified(event);
                }

                // 
                
                // Emits local and remote events
                this.emitLogicEvent(clientID, event, args.length === 1 ? args[0] : args);
            });
            
            // Emit the tts speech when user configured it at the beginning
            await (async () => {
                const speechConfig = this.config?.beforeLogicProcessing;
                const canCommunicate = this.config.communicationSpeechLevels === "all" || this.config.communicationSpeechLevels?.beforeLogicProcessing === true;

                if (typeof speechConfig === "object" && canCommunicate) {
                    const { nature, toSay } = speechConfig;
                    
                    const runSpeechWorkflow = async () => {
                        try {
                            this.emitRealTimeVoiceAgentEvent(clientID, "speak_before_start", [{ clientID }]);
                            
                            const whatToSay = typeof toSay === "string" ? toSay : await toSay(transcript);
                            
                            await this.speak(
                                clientID,
                                whatToSay, 
                                "beforeLogicProcessing",
                                logicAbortController.signal
                            );
                            
                            this.emitRealTimeVoiceAgentEvent(clientID, "speak_before_end", [{ clientID }]);
                        } catch (err) {
                            this.emitRealTimeVoiceAgentEvent(clientID, "speak_before_error", [{ clientID, error: err }]);
                            this.devConsole(`Cannot say before model execution: ${err}`, "error");
                        }
                    };

                    if (nature === "blocking") {
                        await runSpeechWorkflow();
                    } else {
                        void runSpeechWorkflow();
                    }
                }
            })();
            
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
            this.emitRealTimeVoiceAgentEvent(clientID, "logic_finish", [{ clientID, result: result }]);
            
            // Speak result
            const lastAiMessage = result.messages.filter(m => m.type === "ai").pop();
            if (lastAiMessage && "content" in lastAiMessage && typeof lastAiMessage.content === "string") {
                this.speak(clientID, lastAiMessage.content, "result", logicAbortController.signal);
            }
            
            // TODO: Add the pipeline avatar model to talk when start generation
        });
    }

    private canAgentCommunicate(checkForCaseLevel: Exclude<SpeechLevel, "result">) {
        if (this.config.communicationSpeechLevels === "all") return true;
        if (typeof this.config.communicationSpeechLevels === "object") {
            const levels = this.config.communicationSpeechLevels;
            return levels[checkForCaseLevel] === true;
        }
        return false;
    }
    
    private async speak(clientID: string, text: string, type: SpeechLevel, abort?: AbortSignal, args?: any[], describeVoiceInstruction?: string) {
        const client = this.activeClients.get(clientID);
        if (!client || !client.audioSource) return;

        if (type !== "result" && !this.canAgentCommunicate(type)) return;

        let state = this.outputSpeechQueues.get(clientID);
        if (!state) {
            state = { queue: [], currentAbortController: null, isProcessing: false };
            this.outputSpeechQueues.set(clientID, state);
        }
        const queueState = state;

        const speechApproach = this.config.agent.models.stt.speechApproach ?? "blocking";
        if (speechApproach === "flush") {
            this.flushSpeakQueue(clientID, "flush");
        } else if (speechApproach === "deny-current") {
            if (state.currentAbortController !== null || state.queue.length > 0) {
                return;
            }
        }

        const completion = new Promise<void>((resolve) => {
            queueState.queue.push({ text, type, describeVoiceInstruction, args, abort, resolve });
        });

        // Start processing if not already
        if (!queueState.isProcessing) {
            this.processSpeakQueue(clientID).catch(err => {
                this.devConsole(`[RealTimeVoiceAgent] Error in processSpeakQueue for ${clientID}: ${err}`, "error");
            });
        }

        await completion;
    }

    private flushSpeakQueue(clientID: string, reason: "flush" | "user") {
        const state = this.outputSpeechQueues.get(clientID);
        if (!state) return;

        const hadPendingSpeech = state.currentAbortController !== null || state.queue.length > 0;
        state.currentAbortController?.abort();
        state.queue.splice(0).forEach((item) => item.resolve());

        if (hadPendingSpeech) {
            this.emitSpeechQueueEvent(clientID, "speech_interrupted", [{ clientID, reason }]);
        }
    }

    private disposeSpeakQueue(clientID: string) {
        const state = this.outputSpeechQueues.get(clientID);
        if (!state) return;

        state.currentAbortController?.abort();
        state.queue.splice(0).forEach((item) => item.resolve());
        this.outputSpeechQueues.delete(clientID);
    }

    private emitSpeechQueueEvent<EventName extends "interrupt" | "speech_interrupted" | "speech_start" | "speech_segment" | "speech_end">(
        clientID: string,
        event: EventName,
        data: Parameters<RealTimeVoiceAgentEvents[EventName]>
    ) {
        try {
            this.emitRealTimeVoiceAgentEvent(clientID, event, data);
        } catch (err) {
            this.devConsole(`[RealTimeVoiceAgent] Unable to emit ${event} for ClientID ${clientID}: ${err}`, "warn");
        }
    }

    private async processSpeakQueue(clientID: string) {
        const state = this.outputSpeechQueues.get(clientID);
        if (!state) return;

        state.isProcessing = true;

        try {
            while (state.queue.length > 0) {
                const item = state.queue.shift()!;
                
                // Create controller for this specific task
                const executionAbortController = new AbortController();
                state.currentAbortController = executionAbortController;

                // Sync with parent logic abort signal if provided
                const abortHandler = () => executionAbortController.abort();
                if (item.abort) {
                    if (item.abort.aborted) {
                        state.currentAbortController = null;
                        item.resolve();
                        continue;
                    }
                    item.abort.addEventListener("abort", abortHandler);
                }

                try {
                    await this.executeSpeak(clientID, item.text, item.type, executionAbortController.signal, item.args, item.describeVoiceInstruction);
                } catch (err) {
                    this.devConsole(`[RealTimeVoiceAgent] Queue item failed for ClientID ${clientID}: ${err}`, "error");
                } finally {
                    if (item.abort) {
                        item.abort.removeEventListener("abort", abortHandler);
                    }
                    state.currentAbortController = null;
                    item.resolve();
                }
            }
        } finally {
            state.isProcessing = false;
            if (state.queue.length === 0 && this.outputSpeechQueues.get(clientID) === state) {
                this.outputSpeechQueues.delete(clientID);
            }
        }
    }

    /**
     * 
     * @param clientID 
     * @param text 
     * @param type 
     * @param abort 
     * @param describeVoiceInstruction - instruction from the invoked unit to be passed only when entry was specified
     * @returns 
     */
    private async executeSpeak(clientID: string, text: string, type: SpeechLevel, abort: AbortSignal,args?: any[], describeVoiceInstruction?: string) {
        const client = this.activeClients.get(clientID);
        if (!client || !client.audioSource) return;

        // Emit speech start event
        this.emitSpeechQueueEvent(clientID, "speech_start", [{ clientID, timestamp: Date.now() }]);
        
        try {
            // Optional transcription adjustment
            let textToSpeak = text;
            const transcriber = this.config.agent.models.transcriber;
            if (transcriber) {
                let currentTranscriber: TranscriberModelPromptAddition | null = null;
                if (transcriber.routingStrategy === "all-through-transcriber") {
                    currentTranscriber = transcriber;
                } else if (transcriber.routingStrategy === "fine-grained" && (transcriber as any).transcribeFor?.[type]) {
                    currentTranscriber = (transcriber as any).transcribeFor[type];
                }

                if (currentTranscriber) {
                    this.emitRealTimeVoiceAgentEvent(clientID, "transcriber_start", [{ clientID, toSpeakBeforeTranscription: text }]);
                    
                    /** Get the transcription instruction base on new type */
                    const systemPromptAddition = await (async () => {
                        if (typeof currentTranscriber.systemPromptAddition === "string") return currentTranscriber.systemPromptAddition;
                        if (typeof currentTranscriber.systemPromptAddition === "function") {
                            const prepTranscription = await currentTranscriber.systemPromptAddition(textToSpeak, type, args, describeVoiceInstruction);
                            return prepTranscription;
                        }

                        return;
                    })();
                    
                    const res = await this.waitForSpeechOperation<any>(
                        currentTranscriber.model.invoke({
                            messages: [
                                { type: "system", content: `You are a professional transcriber. Your role is to produce the transcription of the specified segment. Segment type: ${type}.${systemPromptAddition || describeVoiceInstruction ? `\n\n\nAdditional instructions from user:\n${((systemPromptAddition ? (`- ${systemPromptAddition}\n`) : "") + (describeVoiceInstruction ? `- ${describeVoiceInstruction}` : ""))}` : ""}` },
                                { type: "user", content: text }
                            ],
                            abort
                        }),
                        abort
                    );
                    if (!res) return;

                    const aiMessage = res.answer.find((m: any) => m.type === "ai");
                    if (aiMessage && "content" in aiMessage && typeof aiMessage.content === "string") {
                        textToSpeak = aiMessage.content;
                    }

                    this.emitRealTimeVoiceAgentEvent(clientID, "transcriber_end", [{ clientID, readyTranscription: textToSpeak }]);
                }
            }

            if (abort.aborted) return;

            // TTS
            const ttsModel = this.config.agent.models.tts;
            const audioBuffer = await this.waitForSpeechOperation(
                ttsModel.tts(textToSpeak, {
                    model: (ttsModel as any).config?.model ?? "tts-1",
                    voice: "alloy"
                } as any),
                abort
            );
            
            if (abort.aborted) return;

            if (audioBuffer && audioBuffer.length > 0) {
                const sampleRate = 16000;
                const bytesPerSample = 2;
                const frameDurationMs = 20;
                const frameSize = sampleRate * bytesPerSample * frameDurationMs / 1000;

                this.emitSpeechQueueEvent(clientID, "speech_segment", [{ clientID, type, text: textToSpeak }]);

                for (let offset = 0; offset < audioBuffer.length && !abort.aborted; offset += frameSize) {
                    const samples = audioBuffer.subarray(offset, offset + frameSize);
                    client.audioSource.onData({
                        samples,
                        sampleRate,
                        bitsPerSample: 16,
                        channelCount: 1
                    });

                    if (offset + frameSize < audioBuffer.length) {
                        await this.waitForSpeechFrame(frameDurationMs, abort);
                    }
                }

                // Update avatar if available
                if (this.config.agent.models.avatar && client.videoSource) {
                    // TODO: Avatar logic integration
                }
            }
        } catch (err: any) {
            if (err.name !== "AbortError") {
                this.devConsole(`[RealTimeVoiceAgent] executeSpeak error for ClientID ${clientID}: ${err}`, "error");
            }
        } finally {
            // Emit speech end event
            this.emitSpeechQueueEvent(clientID, "speech_end", [{ clientID, timestamp: Date.now() }]);
        }
    }

    private waitForSpeechFrame(durationMs: number, abort: AbortSignal): Promise<void> {
        if (abort.aborted) return Promise.resolve();

        return new Promise((resolve) => {
            const timeout = setTimeout(finish, durationMs);
            const abortHandler = () => {
                clearTimeout(timeout);
                finish();
            };

            function finish() {
                abort.removeEventListener("abort", abortHandler);
                resolve();
            }

            abort.addEventListener("abort", abortHandler, { once: true });
        });
    }

    private waitForSpeechOperation<Result>(operation: Promise<Result>, abort: AbortSignal): Promise<Result | undefined> {
        if (abort.aborted) return Promise.resolve(undefined);

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (result: Result | undefined) => {
                if (settled) return;
                settled = true;
                abort.removeEventListener("abort", abortHandler);
                resolve(result);
            };
            const fail = (error: unknown) => {
                if (settled) return;
                settled = true;
                abort.removeEventListener("abort", abortHandler);
                reject(error);
            };
            const abortHandler = () => finish(undefined);

            abort.addEventListener("abort", abortHandler, { once: true });
            operation.then(finish, fail);
        });
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
        this.speakingUsers.set(clientID, timestamp);
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
        const sttModel = this.config.agent.models.stt.model;
        const sttMode = this.config.agent.models.stt.sttMode ?? "volatile";

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
                
                this.internalEvents.emit("stt_transcript_interim", {
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

    /**
     * Emits the local Events for ReActAgent logic and for RealTimeVoiceAgent
     */
    private emitLogicEvent<EventName extends keyof ReActAgentEvents>(
        clientID: string,
        event: EventName,
        data?: Parameters<ReActAgentEvents[EventName]>
    ) {
        const listeners = this.LogicEventsListeners[event];
        if (listeners) {
            listeners.forEach(listener => listener(...(data || [])));
        }

        // Emit event via the network to the customer
        this.clientsDataChannels.emitEvent(clientID, `logic.${event}`, data);
    }

    private emitRealTimeVoiceAgentEvent<EventName extends keyof RealTimeVoiceAgentEvents>(
        clientID: string,
        event: EventName,
        data?: Parameters<RealTimeVoiceAgentEvents[EventName]>
    ) {
        const listeners = this.RealTimeVoiceAgentEventsListeners[event];
        if (listeners) {
            listeners.forEach(listener => listener(...(data || [])));
        }

        // Emit event via the network to the customer
        this.clientsDataChannels.emitEvent(clientID, `realtime_agent.${event}`, data);
    }

    /**
     * Listens local Events for **RealTimeVoiceAgent**
    */
    public onRealTimeVoiceAgentEvents<EventName extends keyof RealTimeVoiceAgentEvents>(
        eventName: EventName,
        eventListener: RealTimeVoiceAgentEvents[EventName]
    ) {
        if (!this.RealTimeVoiceAgentEventsListeners[eventName]) {
            this.RealTimeVoiceAgentEventsListeners[eventName] = [];
        }

        this.RealTimeVoiceAgentEventsListeners[eventName].push(eventListener as (...args: any[]) => void | Promise<void>);
        return this;
    }
    
    /**
     * Listen local Events for the **ReActAgent** serves as internal logic
    */
    public onLogicEvent<EventName extends keyof ReActAgentEvents>(
        eventName: EventName,
        eventListener: ReActAgentEvents[EventName]
    ) {
        if (!this.LogicEventsListeners[eventName]) {
            this.LogicEventsListeners[eventName] = [];
        }

        this.LogicEventsListeners[eventName].push(eventListener as (...args: any[]) => void | Promise<void>);
        return this;
    }

    /** Called when client VAD signals speech end over RTCDataChannel */
    private async onSpeechEnd(clientID: string, timestamp: number) {
        this.speakingUsers.delete(clientID);
        this.devConsole(`[RealTimeVoiceAgent] User stopped speaking (ClientID: ${clientID}, Timestamp: ${timestamp})`, "log");
        
        const session = this.activeSpeechSessions.get(clientID);
        if (session) {
            session.isSpeaking = false;
            // Flush any waiting resolvers
            session.chunkResolvers.forEach((resolve) => resolve());
            session.chunkResolvers = [];

            const sttModel = this.config.agent.models.stt.model;
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
                    this.internalEvents.emit("stt_transcript_final", {
                        clientID,
                        transcript: finalTranscript,
                        audioBuffer: fullAudioBuffer
                    });
                }
            } else if (!session.sessionAbortController.signal.aborted) {
                this.internalEvents.emit("stt_transcript_final", {
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
                        this.speakingUsers.delete(clientID);
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
                this.speakingUsers.delete(clientID);
                this.usersTrackID.delete(clientID);
                this.disposeSpeakQueue(clientID);
                
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

            this.disposeSpeakQueue(clientID);

            // Emit abort to client
            this.emitRealTimeVoiceAgentEvent(clientID, "abort", [{ clientID, reason: "Global abort triggered" }]);

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
