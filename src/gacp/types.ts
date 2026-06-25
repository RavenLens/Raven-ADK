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

export interface AgentBoxReturnType {
    invoke(task: string, caller: CallerData): Promise<SuccessState>;
    /** 
     * TODO: Add type in square with agenticskills.io
    */
    getSkills(caller: CallerData): any;
    /**
     * 
     * TODO: Add type with 
    */
    getTools(caller: CallerData): any;
    /**
     * 
     * TODO: Add type with 
    */
    getKnowledge(caller: CallerData): any;
}

export interface GACPAgentConfig {
    /** It's unique agent identifier in network of agents. If not specified id is made of agent `name` property */
    id?: string;
    /** It's agent name */
    name: string;
    description: string;
    /** Use to manually specify what is this agent the best for */
    specialization?: string | string[];
    /** 
     * Agent Definition Box - it's runnable agent will get the specification to be run
    */
    agentBox: (gacpAgentInterface: any) => Promise<AgentBoxReturnType>;
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
