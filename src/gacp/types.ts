import { ToolConfig } from "../agent/tools";
import { GACPAgent } from "./agent";

export interface CallerData {
    agent: Pick<GACPAgentConfig, "id" | "name">;
    user?: { 
        id: string;
        meta: Record<string, any>;
    };
}

export type SuccessState = boolean;
export type SuccessStateObj = { 
    success: boolean;
    /** Specified when `success` = false */
    failureReason?: "payment_required" | "agent_error" | { reason: string };
};

export interface KnowledgeType {
    id: string;
    title: string;
    keywords: string[];
    content: string;
}

export interface SkillFile {
    type: "file";
    fileName: string;
    /** Content includes meta */
    fileContent: string;
}

export interface SkillFolder {
    type: "folder";
    folderName: string;
    folderEntries: (SkillFile | SkillFolder)[];
}

/** 
 * Otherwise folder with all skills orchestrated
 * Can be root or specific
*/
export type SkillWard = {
    type: "ward";
    name: string;
    isRoot?: boolean;
    skills: (SkillFile | SkillFolder)[]
};

export interface AgentBoxReturnType {
    invoke(task: string, caller: CallerData): Promise<SuccessState>;
    /**
     * Return list of skills this agent can use
     * Get list with this agent skills
    */
    getSkills(caller: CallerData): SkillWard[];
    /**
     * Get list with this agent tools definition
     * Return list with tools other agents can use
    */
    getTools(caller: CallerData): ToolConfig<any, any>[];
    /** 
     * This is knwoeldge this agent carries
     * Get list with this agent knowledge aka. memory
     * Return list with knowledge other agents can use
    */
    getKnowledge(caller: CallerData): KnowledgeType[];
}

export type AgentIdentifier = Pick<GACPAgentConfig, "id" | "name">;

export interface GACPConnectorStandardSchema {
    /** List with agents belongs to the client broker (connector) */
    agents: GACPAgent[];
    getAgents(): Omit<GACPAgentConfig, "agentBox">[];
    getRelationGraph(): RelationsGraph[];
    getSkills(): {
        /** Agent identity */
        agent: AgentIdentifier;
        /** Root ward has skills */
        skills: SkillWard;
    }[];
    getKnowledge(): {
       agent: AgentIdentifier;
       knowledge: KnowledgeType[];
    }[];
    getTools(): {
       agent: AgentIdentifier;
       tools: Pick<ToolConfig<any, any>, "toolName" | "toolArguments">;
    }[];
    /**
     * Executes tool
     * In async mode doesn't wait for mode
     * As default synchronous hence tool is execute before
    */
    useTool(agent: AgentIdentifier, toolName: string, paramsFeed: Record<string, any>, asyncMode: boolean): { status: boolean, output?: any };
    getAgentQueueLimits(agent: AgentIdentifier): null | number;
    getAgentCurrentQueueOccupation(agent: AgentIdentifier): null | number;
    delegateFullTask(config: { toAgent: Pick<GACPAgentConfig, "id" | "name">, asyncMode: boolean; }, task: string): any;
    delegateTaskPart(config: { toAgent: Pick<GACPAgentConfig, "id" | "name">, asyncMode: boolean; }, taskPart: string): { operationId: string, result: any };
}

export interface GACPAgentConfig {
    /** It's unique agent identifier in network of agents. If not specified id is made of agent `name` property */
    id?: string;
    /** It's agent name */
    name: string;
    description: string;
    /** Use to manually specify what is this agent the best for */
    specialization?: string | string[];
    /** Specify maximal number of tasks can be execute by singular queue */
    queueMaxTasksLenght?: number | false | undefined;
    /** 
     * Agent Definition Box - it's runnable agent will get the specification to be run
    */
    agentBox: (gacpAgentInterface: GACPAgent) => Promise<AgentBoxReturnType>;
}

export type ExploredAgent = AgentBoxReturnType | Omit<GACPAgentConfig, "agentBox">;

export type GraphAgentDestination = { agentName?: string; agentId?: string };

export interface RelationsGraph {
    from: GraphAgentDestination;
    to: GraphAgentDestination;
    relation: string[];
}

/** Relation Graph ID has to be defined on side broker and is fetched from its side - on side of broker its the array with `RelationsGraph` = `RelationsGraph[]` */
export type RelationGraphID = string;

export type AgentDestination = Pick<GACPAgentConfig, "name" | "id">;

/** 
 * It's definition for GACP Possible events
*/
export interface GACPEvents {
    task_execution_start: (agent: AgentDestination, task: string, fromAgent?: AgentDestination) => any;
    task_execution_progress: (agent: AgentDestination, task: string, fromAgent?: AgentDestination) => any;
    task_queued: (agent: AgentDestination, task: string, position: number) => any;
    delegate_task: (toAgent: AgentDestination, task: string) => any;
    retrived_delegation_task: (agentSeeks: AgentDestination, task: string) => any;
    seek_skill: (agentSeeks: AgentDestination) => any;
    seek_knowledge: (agentSeeks: AgentDestination) => any;
    failure: (agent: AgentDestination, reason: NonNullable<SuccessStateObj["failureReason"]>) => any;
}
