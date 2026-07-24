import { Tool, ToolConfig, ToolLogic } from "../tools";
import { ServerOptions } from "socket.io";
import z from "zod/v4";
import { HITLConfigSchema, HITLTransportSchema, ToolUsageConfObject } from "../tools/hitl/hitlToolSchema";
import { AgentModel, ReActAgentPluginSpec, SubAgent } from "../ReAct.agent";
import { MessagesVariations } from "../state";
import { SchemaSkillStore } from "../skills/stores/schema";
import { SchemaMemoryStore } from "../memory/stores/schema";
import { AvatarOneStepPipeline, AvatarTwoStepPipeline } from "./live-avatar.pipelines";
import { ParsedUrlQuery } from "node:querystring";
import { STTModel, STTMode } from "./stt";
import { MutliMemoryObject } from "../memory/memory";

/**
 * Specify to teel whether describe and optionally how the Plugin Execution
 * * Specify `true` to give agent free will in description the plugin execution - under such condition the execution will be communicated only base on rest of configuration
 * * Specify object to give agent additional instructions about plugin execution
 * @default false
*/
export type VoiceAgentDescriptionConfig = boolean | {
  /** Whether to describe the plugin execution */
  describe: boolean;
  /** 
   * Give instruction to tell voice agent how to describe the operation
   * Usable only when was specified `describe: true`
  */
  describeVoiceInstruction?: string;
}

export type ConfigLessSchemaSkillsStore = Omit<SchemaSkillStore, "config">;
export interface RealTimeVoiceAgentSkillsSchema extends ConfigLessSchemaSkillsStore {
    config: SchemaMemoryStore["config"] & {
        /**
         * Give description for specific action that has to be communicated
         * @default - no action is communicated if desired specify object for specific action
         */
        actionsVoiceDescriptionInstruction: Partial<Record<keyof ConfigLessSchemaSkillsStore, VoiceAgentDescriptionConfig>>;
    }
}

export type ConfigLessSchemaMemoryStore = Omit<SchemaMemoryStore, "config">;
export interface RealTimeVoiceAgentSchemaMemoryStore extends ConfigLessSchemaMemoryStore {
    config: SchemaMemoryStore["config"] & {
      /**
       * Give description for specific action that has to be communicated
       * @default - no action is communicated if desired specify object for specific action
       */
      actionsVoiceDescriptionInstruction: Partial<Record<keyof ConfigLessSchemaMemoryStore, VoiceAgentDescriptionConfig>>;
    }
}

export interface RealTimeVoiceSubAgent extends SubAgent {
    /**
     * Whether to describe agent execution and if desired how
     * @default false
    */
    describeVoiceInstruction?: VoiceAgentDescriptionConfig;
}


export class RealTimeVoiceAgentTool<ToolArgs extends z.ZodObject, ToolOutputSchema extends z.ZodObject> extends Tool<ToolArgs, ToolOutputSchema> {
  describeVoiceInstruction?: VoiceAgentDescriptionConfig;
  
  /** 
   * @param describeVoiceInstruction - Optionally describe the execution the agent. When no specified an agent doesn't describe this tool call
  */
  constructor(
    toolLogic: ToolLogic<ToolArgs>,
    toolConfig: ToolConfig<ToolArgs, ToolOutputSchema>,
    describeVoiceInstruction?: VoiceAgentDescriptionConfig
  ) {
    super(toolLogic, toolConfig);
    this.describeVoiceInstruction = describeVoiceInstruction;

    // TODO: Moficiations -> have to take place to allow the agent to tell that tool is executing
    if (this.describeVoiceInstruction) {
        // ... Modified the .invoke method to emit the description of exectuion and stream to the tts specified model
        
    }
  }
}

export interface RealTimeVoiceAgentPluginSpec extends ReActAgentPluginSpec {
  /** Speech is execute once agent use this plugin */
  describeVoiceAgentConfig?: VoiceAgentDescriptionConfig
}

export interface HITLLiveTimeVoiceAgent<HITL extends HITLTransportSchema> extends Omit<HITLConfigSchema, "toolsUsage"> {
  /** HITL Configuration is used to setup the hitl execution */
  hitl: HITL;
  /** (Optional) Add tools and describe how should RealTime-Voice-Agent Communicate its usage */
  toolsUsage?: {
    [toolName: string]: {
      config: ToolUsageConfObject | true;
      /** Give instruction in what fashio should the tts model communicate tool usage */
      describeVoiceInstruction: string;
    };
  };
  /** (Optional) Question Types Voice Description Instruction 
   * Describe what adgen should say when using these objects
  */
  actionsDescribeVoiceInstruction?: Partial<Record<keyof NonNullable<Pick<HITLTransportSchema, "emitAbcQuestion" | "emitOpenQuestion" | "emitToolUsage" | "emitAcceptance">>, string>>;
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
 * Each step will go through transcriber
*/
export interface TranscriberAllThrough {
  routingStrategy: "all-through-transcriber";
  model: AgentModel;
  /** Optional `systemPromptAddition` */
  systemPromptAddition?: string;
}

/**
 * Reasoning and conversation is ommited in description
*/
export interface TranscriberByPassConversation {
  routingStrategy: "bypass-conversation";
  model: AgentModel;
  /** Optional `systemPromptAddition` */
  systemPromptAddition?: string;
}

/**
 * Allow the specific transcriber model with specific system prompt to be used 
 */
export interface TranscriberSpecific {
  routingStrategy: "fine-grained";
  transcribeFor: Partial<Record<"conversation" | "after-full-stt-transcript" | "thoughts" | "tools" | "memory" | "skills", {
    model: AgentModel;
    /**
     * Optional `systemPromptAddition`
     * This system prompt is passed to the above `model`
    */
    systemPromptAddition?: string;
  }>>;
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

export interface RealTimeVoiceAgentConfig<RealTimeVoiceAgentSkills extends RealTimeVoiceAgentSkillsSchema, Memory extends RealTimeVoiceAgentSchemaMemoryStore, HITL extends HITLTransportSchema> {
  /** 
   * The environment where the agent is executing.
   * - 'remote': Hosted on a backend with WebRTC/Socket.io
   * - 'local': Running directly on the user's device. It doesn't spawn server (Edge AI)
   */
  executionMode: ExecutionRemoteMode | ExecutionLocalMode;
  /**
   * Describe what you want to have communicated by 'tts' model and correlated "avatar" model/pipeline
   * @default "all"
  */
  communicationSpeechLevels?: {
    afterTranscript: boolean;
    thoughts: boolean;
    tools: boolean;
    skills: boolean;
    hitl: boolean;
    memory: boolean;
    subagents: boolean;
  } | "all";
  /** RealTime Agent configuration */
  agent: {
    /**
     * Config for the VAD (Voice-Activation-Detection) is used on frontend
     * Provides fine-grained finetunning for the server and required informations for telementry and logs
    */
    vad?: {
      model: "silero" | "deepgram" | "native";
      chunkSizeMs: number; // e.g., 20 or 30
      threshold: number;   // Sensitivity 0-1
      silenceTimeout: number; // For turn detection
      /** Determine whether to rely on silence timeout or semantic reasoning for turn detection */
      endpointingMode?: "threshold" | "semantic";
    };
    /** List with models fanned in RealTime communication */
    models: {
      /** Model that converts speech-to-text (either standard AgentModel or specialized STTModel instance) */
      stt: AgentModel | STTModel;
      /**
       * Speech-to-text execution mode.
       * - 'volatile': processes audio subchunks in real time on the fly as speech flows.
       * - 'interim': processes the full audio buffer after user speech concludes.
       * @default "volatile"
       */
      sttMode?: STTMode;
      /** Main Reasoning model */
      reasoning: AgentModel;
      /** 
       * Fast model to perform transcription for some tasks
       * If not specified the transcriber is bypassed totally and only segements are ready to be transcribed are used
       * WARNING: Lack of transcriber will cause the Skills, Tools, Memory and some reasoning to be not flowing or be not adjusted decently to the RealTimeAgent Conditions
      */
      transcriber?: TranscriberByPassConversation | TranscriberAllThrough | TranscriberSpecific;
      /** Model that converts text-to-speech */
      tts: AgentModel;
      avatar?: AvatarOneStepPipeline | AvatarTwoStepPipeline;
    };
    /** Rules for your agent e.g: role playing definitions, speech tone and more */
    systemPrompt: string;
    messages: MessagesVariations[];
    skills?: RealTimeVoiceAgentSkills;
    /** Memory version with transcription definition */
    memory?: Memory | ({
      memory: Memory;
    } & MutliMemoryObject)[];
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
    hitl?: HITLLiveTimeVoiceAgent<HITL>;
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
}