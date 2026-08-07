import { Tool, ToolConfig, ToolLogic } from "../tools";
import { ServerOptions } from "socket.io";
import z from "zod/v4";
import { HITLConfigSchema, HITLTransportSchema, ToolUsageConfObject } from "../tools/hitl/hitlToolSchema";
import { AgentModel, ReActAgentEvents, ReActAgentInvokeResult, ReActAgentPluginSpec, SubAgent } from "../ReAct.agent";
import { MessagesVariations } from "../state";
import { SchemaSkillStore } from "../skills/stores/schema";
import { SkillSharedConfig } from "../skills/skills";
import { DeterministicMemorySchema } from "../memory/schema/deterministicMemorySchema";
import { AvatarOneStepPipeline, AvatarTwoStepPipeline } from "./live-avatar.pipelines";
import { ParsedUrlQuery } from "node:querystring";
import { STTModel, STTMode } from "./stt";
import { IncomingHttpHeaders } from "node:http";
import { SpeechLevel } from "./agent";

/**
 * Specify to teel whether describe and optionally how the Plugin Execution
 * * Specify `true` to give agent free will in description the plugin execution - under such condition the execution will be communicated only base on rest of configuration
 * * Specify object to give agent additional instructions about plugin execution
 * @default false
*/
export type VoiceAgentDescriptionConfig = any;

export type ConfigLessSchemaSkillsStore = Omit<SchemaSkillStore, "config">;
type SchemaMemoryConfig = {
  hasToRemember?: string;
  conclusion?: { maxCharacters: number };
};
type SchemaMemoryStore = DeterministicMemorySchema & {
  config: SchemaMemoryConfig;
};
export interface RealTimeVoiceAgentSkillsSchema extends ConfigLessSchemaSkillsStore {
  config: SkillSharedConfig & {
      /**
       * Give description for specific action that has to be communicated
       * @default - no action is communicated has to be specified each action that has to be communicated
       */
      actionsVoiceDescriptionInstruction: Partial<Record<keyof ConfigLessSchemaSkillsStore, VoiceAgentDescriptionConfig>>;
    }
}

export type SpeakPositionRecordKeys = "speakBefore" | "speakAfter";
export type SpeakBeforeAfter<ConfigExtenstion extends Record<string, any> = {}> = Partial<Record<SpeakPositionRecordKeys, VoiceAgentDescriptionConfig & ConfigExtenstion>>;

export type ConfigLessSchemaMemoryStore = Omit<SchemaMemoryStore, "config"> & Record<string, unknown>;
export interface MutliMemoryObject {
  name: string;
  purpose: string;
}
/** Canonical memory operations exposed to the RealTimeVoiceAgent speech layer. */
export type RealTimeVoiceMemoryOperation =
  | "fetch"
  | "save"
  | "update"
  | "delete"
  | "select"
  | "feedback"
  | "get_conclusion"
  | "set_conclusion";
type SpeakBeforeAfterWithMemoryDescription = SpeakBeforeAfter<{
  /** The result is available only for `speakAfter`. */
  defaultInstruction?: string | ((memoryName: string, action: RealTimeVoiceMemoryOperation | Parameters<ReActAgentEvents["memory_action"]>[0], details: Record<string, any>, result?: any) => Promise<string> | string);
}>;
export interface RealTimeVoiceMemorySpeechConfig {
  actions?: Partial<Record<RealTimeVoiceMemoryOperation, SpeakBeforeAfterWithMemoryDescription>>;
  tools?: Partial<Record<"fetch" | "update", SpeakBeforeAfterWithMemoryDescription>>;
}
export interface RealTimeVoiceAgentSchemaMemoryStore extends ConfigLessSchemaMemoryStore {
    config: SchemaMemoryStore["config"] & {
      /**
       * Give description for specific action that has to be communicated
       * @default - no action is communicated if desired specify object for specific action
       */
      actionsVoiceDescriptionInstruction: Partial<Record<RealTimeVoiceMemoryOperation | keyof ConfigLessSchemaMemoryStore, SpeakBeforeAfterWithMemoryDescription>>;
    }
}

type SpeakBeforeAfterWithToolDescription = SpeakBeforeAfter<{ 
  /**
   * Specify how agent has to Verbally with Voice (Aloud) describe the tool call or its result
   * 
   * Behaviour:
   * * Result of function execution or string is passed to transcriber when is enabled that processes it with `describeVoiceInstruction`
   * * When transcriber for this operation is disabled then the this raw result is spoken by `tts` model
   * * Determine toolt result by fact `toolOutput` property is specified
   * 
   * When not specified the RavenADK default tool speech instruction is going to be leveraged
   * * Use function to specify the dynamic description e.g: base on tool agent given args
   * * Use string to specify static description e.g: for specified tool
   * @params toolOutput - it's available only for `speakAfter` option - where tool result is available
  */
  defaultInstruction?: string | ((toolName: string, toolArgs: Record<string, any>, toolOutput?: string) => Promise<string> | string);
}>;

type SpeakBeforeAfterWithSubagentDescription = SpeakBeforeAfter<{
  /** Specify how the agent should verbally describe the subagent call or result. */
  defaultInstruction?: string | ((subAgentRole: string, subagentInstruction: string, result?: ReActAgentInvokeResult) => Promise<string> | string);
}> & {
  /**
   * Configures speech for tools used by this subagent.
   *
   * `speakBefore` is invoked for `subagent_tool_invoked`, and `speakAfter` is
   * invoked for `subagent_tool_executed`. Omit this property to leave the
   * subagent's tool calls unannounced.
   */
  toolCalls?: SpeakBeforeAfterWithToolDescription;
};

export type RealTimeVoiceSubAgent = SubAgent & {
    /**
     * Whether to describe agent execution and if desired how.
     * @default false
    */
    describeVoiceInstruction?: SpeakBeforeAfterWithSubagentDescription;
}

export class RealTimeVoiceAgentTool<ToolArgs extends z.ZodObject, ToolOutputSchema extends z.ZodObject> extends Tool<ToolArgs, ToolOutputSchema> {
  describeVoiceInstruction?: SpeakBeforeAfterWithToolDescription;
  
  /** 
   * @param describeVoiceInstruction - Optionally describe the execution the agent. When no specified an agent doesn't describe this tool call
  */
  constructor(
    toolLogic: ToolLogic<ToolArgs>,
    toolConfig: ToolConfig<ToolArgs, ToolOutputSchema> & SpeakBeforeAfterWithToolDescription,
    describeVoiceInstruction?: SpeakBeforeAfterWithToolDescription
  ) {
    super(toolLogic, toolConfig);

    const { speakAfter, speakBefore } = toolConfig;
    this.describeVoiceInstruction = speakAfter || speakBefore ? { speakAfter, speakBefore } : describeVoiceInstruction;
  }
}

type SpeakBeforeAfterWithPluginDescription = SpeakBeforeAfter<{
  /**
   * Specify what the agent should say before or after the plugin execution.
   *
   * The result is available only for `speakAfter`.
  */
  defaultInstruction?: string | ((pluginName: string, executionWay: ReActAgentPluginSpec["executionWay"], pluginOutput?: Awaited<ReturnType<ReActAgentPluginSpec["execute"]>>) => Promise<string> | string);
}>;

export interface RealTimeVoiceAgentPluginSpec extends ReActAgentPluginSpec {
  /** Optionally describe the plugin execution before or after it runs. */
  describeVoiceInstruction?: SpeakBeforeAfterWithPluginDescription;
}

export interface HITLLiveTimeVoiceAgent<HITL extends HITLTransportSchema> extends Omit<HITLConfigSchema, "toolsUsage"> {
  /** HITL Configuration is used to setup the hitl execution */
  hitl: HITL;
  /** (Optional) Add tools and describe how should RealTime-Voice-Agent Communicate its usage 
   * 
   * NOTE: In terms of `describeVoiceInstruction`, do not specify the `sayAloud` property; once a tool is defined in here, it is intended to be communicated. 
   * By default, tools not specified in this property are not communicated.
  */
  toolsUsage?: {
    [toolName: string]: {
      config: ToolUsageConfObject | true;
      /** Give instruction in what fashion should the tts model communicate tool usage */
      describeVoiceInstruction: SpeakBeforeAfter<{
        /**
         * Specify how the agent should verbally describe the tool call or result.
        */
        defaultInstruction?: string | ((toolName: string, toolParams: Record<string, any>, result?: any) => Promise<string> | string);
      }>;
    };
  };
  /** (Optional) Question Types Voice Description Instruction 
   * Describe what agent should say when has used a user questioning via HITL tools
  */
  actionsDescribeVoiceInstruction?: Partial<Record<keyof NonNullable<Pick<HITLTransportSchema, "emitAbcQuestion" | "emitOpenQuestion" | "emitToolUsage" | "emitAcceptance">>, SpeakBeforeAfter<{
    defaultInstruction?: string | ((payload: any, result?: any) => Promise<string> | string);
  }>>>;
}



export interface RealTimeVoiceAgentServerConfig {
  socketIo: {
    port: number;
    /** Cross-Origin-Resource-Sharing policy */
    serverOptions?: ServerOptions;
    // ... TODO: Rest Socket.io config
  };
  /**
   * Configuration for WebRTC.
   * If 'mediaProxy' is specified, the agent connects via an SFU/Media Server instead of P2P to decouple Media Plane.
   */
  webRTC: {
    /** List with servers to accomplish connection. E.g: [{ urls: 'stun:stun.l.google.com:19302' }]; */
    iceServers: {
      urls: string;
    }[];
    /**
     * Configuration for Decoupled Media Plane (SFU/Media Server)
     * e.g., a Rust-based high-performance server.
     */
    mediaProxy?: {
      type: "sfu" | "mcu" | "rust-media-server";
      endpoint: string;
      /** Protocol used to communicate with the Media Plane */
      protocol: "whep" | "whip" | "custom-rpc";
    };
  };
  audioEncoding?: {
    sampleRate: 48000 | { custom: number; };
    codec: "opus" | "pcm";
  };
}

/**
 * @param args - are the arguments from the tool was called e.g: toolName or other argument types for non-tool call
 * @param describeVoiceInstruction - the instruction specified in config given along the `type` param
 */
type TranscriberFunction = ((toSayText: string, type: SpeechLevel, args?: any[], describeVoiceInstruction?: string) => string | Promise<string>);
/** Transcriber can get static instrucion or the function generates instruction base on `toSayText` param */
type TranscriberSystemPromptAddition = string | TranscriberFunction;

export interface TranscriberModelPromptAddition {
  model: AgentModel;
  /**
   * Optional `systemPromptAddition`
   * Instruction for transcriber how to define for tts model what to say
   * Transcribe instruction are prepared base on this option and the `describeVoiceInstruction` passed from the invoke place
  */
  systemPromptAddition?: TranscriberSystemPromptAddition;
}

/**
 * Each step will go through transcriber
*/
export interface TranscriberAllThrough extends TranscriberModelPromptAddition {
  routingStrategy: "all-through-transcriber";
}

/**
 * Reasoning and conversation is ommited in description
*/
export interface TranscriberByPassConversation extends TranscriberModelPromptAddition {
  routingStrategy: "bypass-conversation";
}

/**
 * Allow the specific transcriber model with specific system prompt to be used 
 */
export interface TranscriberFineGrained {
  routingStrategy: "fine-grained";
  transcribeFor: Partial<Record<"conversation" | "after-full-stt-transcript" | "thoughts" | "tools" | "memory" | "skills" | "hitl", TranscriberModelPromptAddition>>;
}

export interface EventsCommunicationCarrier {
  type: "events";
}

export interface IPCCommunicationCarrier {
  type: "ipc";
  /** 
   * The transport mechanism used for Inter-Process Communication.
   * - 'node-ipc': Native Node.js child_process.send() / process.on('message')
  */ 
  transport: "node-ipc" /* | "electron" | "named-pipe" | "unix-socket" | "shared-buffer" */;
}

export interface LocalServerCommunicationCarrier {
  type: "local-server";
  server: RealTimeVoiceAgentServerConfig;
}

export interface ExecutionLocalMode {
  mode: "local";
  textEventsCommunicationCarrier: EventsCommunicationCarrier | IPCCommunicationCarrier | LocalServerCommunicationCarrier;
}

type ExecutionRemoteModeVerificator = { clientID: string; } | string | boolean;
export interface ExecutionRemoteMode {
  mode: "remote";
  /** 
   * Configuration for server where RealTime Agent is spawned.
   */
  server: RealTimeVoiceAgentServerConfig;
  /**
   * Verifies user particiapation for allowement to connect with socket.io server
   * Triggered before each event sent to socket.io server
   * Setup as undefined/false or ignore to disable verification
   * 
  */
  eventVerification?: false | ((auth: { [key: string]: any }, query: ParsedUrlQuery) => Promise<ExecutionRemoteModeVerificator> | ExecutionRemoteModeVerificator);
}

export type AuthPayload = { query: ParsedUrlQuery, headers: IncomingHttpHeaders; };
type UnitDependencyWrapper<ReturnType> = (clientID: string, authPayload: AuthPayload) => ReturnType;

/**
 * @param result - isn't specified to don't disable the RealtimeLiveAgentFunction 
 */
export interface CommunicationSpeechLevelsDetails {
  beforeLogicProcessing: boolean;
  plugins: boolean;
  thoughts: boolean;
  tools: boolean;
  skills: boolean;
  hitl: boolean;
  memory: boolean;
  subagents: boolean;
}

export type SpeechApporaches = "blocking" | "flush" | "deny-current";
export interface RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills extends RealTimeVoiceAgentSkillsSchema, Memory extends RealTimeVoiceAgentSchemaMemoryStore, HITL extends HITLTransportSchema> {
  /** 
   * The environment where the agent is executing.
   * - 'remote': Hosted on a backend with WebRTC/Socket.io
   * - 'local': Running directly on the user's device. It doesn't spawn server (Edge AI)
   */
  executionMode: ExecutionRemoteMode | ExecutionLocalMode;
  /** Decide what to say before the logic processing - ignored for "all" */
  beforeLogicProcessing?: {
    /**
     * Describes what to say
    */
    toSay: string | ((transcript: string) => string | Promise<string>);
    /**
     * Add option to specify whether has it to be blocking or asynchronous - non-blocking logic
    */
    nature: "blocking" | "non-blocking";
  };
  /**
   * Describe what you want to have communicated by 'tts' model and correlated "avatar" model/pipeline
   * @default "all"
  */
  communicationSpeechLevels?: CommunicationSpeechLevelsDetails | "all";
  /**
   * When true, speech requests from within the reasoning engine (e.g. tool descriptions,
   * thoughts, subagent delegation) are awaited and block the ReAct event loop until they finish.
   * When false (default), speech is queued and emitted asynchronously while the engine continues.
   *
   * @default false
   */
  speechBlocksReasoningEngine?: boolean;
  /** RealTime Agent configuration */
  agent: {
    /**
     * Config for the VAD (Voice-Activation-Detection) is used on frontend
     * Provides fine-grained finetunning for the server and required informations for telementry and logs
    */
    // vad?: {
    //   model: "silero" | "deepgram" | "native";
    //   chunkSizeMs: number; // e.g., 20 or 30
    //   threshold: number;   // Sensitivity 0-1
    //   silenceTimeout: number; // For turn detection
    //   /** Determine whether to rely on silence timeout or semantic reasoning for turn detection */
    //   endpointingMode?: "threshold" | "semantic";
    // };
    /** List with models fanned in RealTime communication */
    models: {
      /** Model that converts speech-to-text (either standard AgentModel or specialized STTModel instance) */
      stt: {
        model: AgentModel | STTModel;
        /**
         * Describes how incoming speech requests interact with speech that is already playing or queued.
         * Possible approaches:
         * - blocking - speech is queued and starts after the current speech finishes
         * - flush - cancels the current and queued speech, then starts the newest speech.
         *   The client receives `realtime_agent.speech_interrupted` so it can clear locally buffered audio.
         * - deny-current - if another speech is already playing or queued, the new request is dropped
         *   and only the prior speech continues.
         * 
         * @default {"blocking"} - speech of one is blocked till next will start
         */
        speechApproach: SpeechApporaches;
        /**
         * Speech-to-text execution mode.
         * - 'volatile': processes audio subchunks in real time on the fly as speech flows.
         * - 'interim': processes the full audio buffer after user speech concludes.
         * @default "volatile"
         */
        sttMode?: STTMode;
      };
      /** Main Reasoning model */
      reasoning: AgentModel;
      /** 
       * Fast model to perform transcription for some tasks
       * If not specified the transcriber is bypassed totally and only segements are ready to be transcribed are used
       * WARNING: Lack of transcriber will cause the Skills, Tools, Memory and some reasoning to be not flowing or be not adjusted decently to the RealTimeAgent Conditions
      */
      transcriber?: TranscriberByPassConversation | TranscriberAllThrough | TranscriberFineGrained;
      /** Model that converts text-to-speech */
      tts: AgentModel;
      avatar?: AvatarOneStepPipeline | AvatarTwoStepPipeline;
    };
    /** Rules for your agent e.g: role playing definitions, speech tone and more */
    systemPrompt: string;
    messages: MessagesVariations[];
    skills?: UnitDependencyWrapper<RealTimeVoiceAgentSkills>;
    /** Memory version with transcription definition */
    memory?: {
      /** Specify the memory object */
      interface: UnitDependencyWrapper<Memory | ({
        memory: Memory;
      } & MutliMemoryObject)[]>;
      /** Voice descriptions for deterministic actions and tool-based memory tools, keyed by memory name. */
      memorySpeech?: Partial<Record<string, RealTimeVoiceMemorySpeechConfig>>;
    };
    /** Tools have defined description instruction */
    tools: RealTimeVoiceAgentTool<any, any>[];
    /** 
     * Subagents definition for Real-Time-Voice Agent
     * Each agent gets its own reasoning model
    */
    subagents?: RealTimeVoiceSubAgent[];
    /** List with Plugins for voice agent with supperpowers */
    plugins?: RealTimeVoiceAgentPluginSpec[];
    // HITL With usage
    hitl?: UnitDependencyWrapper<HITLLiveTimeVoiceAgent<HITL>>;
    /** Maximum amount of internal self-recalls without tool usage. Defaults to 3 when omitted. */
    maximumReasoningRecalls?: number;
    /** As default is `true` boolean */
    withConclusion?: boolean;
    /** As default is `false` boolean */
    parallelizeSubagents?: boolean;
    /** As default is `false` boolean */
    parallelTools?: boolean;
    /** Configure how the agent handles user barge-in (interruption) */
    interruption?: {
      /** 'hard-stop' halts immediately, 'flush-buffers' allows clean audio queue clearing */
      mode: "hard-stop" | "flush-buffers";
      /** Delay in ms after VAD trigger before flushing further processing */
      sensitivityMs: number;
    };
    /** Configuration for observing-insights-improvement driven cycle */
    telemetry?: {
      traceLevel: "reasoning" | "full" | "none";
      /** Integration with RavenHub for performance monitoring */
      /* ravenHub?: {
        apiKey: string;
        projectId: string;
        /** Whether to upload full reasoning traces for edge-case detection
        captureReasoningTraces: boolean;
      } */
    };
  };
  /**
   * Use `dev` to see the logs from the agent
   * @default "production"
  */
  operationMode?: "dev" | "production";
};
