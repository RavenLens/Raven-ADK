interface CallerData {
    agent: Pick<GACPAgentConfig, "id" | "name">;
    user?: { 
        id: string;
        meta: Record<string, any>;
    };
}

type SuccessState = boolean;
type SuccessStateObj = { 
    success: boolean;
    /** Specified when `success` = false */
    failureReason?: "payment_required" | "agent_error" | { reason: string };
};

interface AgentBoxReturnType {
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

type ExploredAgent = AgentBoxReturnType | Omit<GACPAgentConfig, "agentBox">;

interface GACPAgentConfig {
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
    agentBox: (gacpAgentInterface: GACPAgent) => Promise<AgentBoxReturnType>;
}

type GraphAgentDestination = { agentName?: string; agentId?: string };

interface RelationsGraph {
    from: GraphAgentDestination;
    to: GraphAgentDestination;
    relation: string[];
}

/** Relation Graph ID has to be defined on side broker and is fetched from its side - on side of broker its the array with `RelationsGraph` = `RelationsGraph[]` */
type RelationGraphID = string;

/** 
 * Use to communicate agents via centralized server to what other agents are connect
*/
export class GACPMiddlewareBrokerConnector {
    brokerURL: string;
    relationsGraph?: RelationsGraph[] | RelationGraphID;

    constructor(brokerURL: string, relationsGraph?: RelationsGraph[] | RelationGraphID) {
        this.brokerURL = brokerURL;
        this.relationsGraph = relationsGraph;
    }

    // TODO: Create dedicated events for Broker
    /** Emit events to this broker */
    private emit<EventName extends keyof GACPEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<GACPEvents[EventName]>
    ) {

    }
    
    /** Listen events emit from this broker - published by other agents and so on */
    onEvent<EventName extends keyof GACPEvents>(
        eventName: EventName,
        eventListener: GACPEvents[EventName]
    ) {

    }
    
    /**
     * Use to get all agents from broker
    */
    exploreAgents(): ExploredAgent[] {
        return []
    }

    /** 
     * Use to get tasks assigned to each agent
     * TODO: Get task bound to agent
    */
    exploreTasks() {

    }
}

/** Use to communicate Agents directly */
export class GACPServerlessBrokerConnector {
    agentURLs: string[];
    
    constructor(agentURLs: string[]) {
        this.agentURLs = agentURLs;
    }
}

type AgentDestination = Pick<GACPAgentConfig, "name" | "id">;

/** 
 * It's definition for GACP Possible events
*/
export interface GACPEvents {
    task_execution_start: (agent: AgentDestination, task: string, fromAgent?: AgentDestination) => any;
    task_execution_progress: (agent: AgentDestination, task: string, fromAgent?: AgentDestination) => any;
    delegate_task: (toAgent: AgentDestination, task: string) => any;
    retrived_delegation_task: (agentSeeks: AgentDestination, task: string) => any;
    seek_skill: (agentSeeks: AgentDestination) => any;
    seek_knowledge: (agentSeeks: AgentDestination) => any;
    failure: (agent: AgentDestination, reason: NonNullable<SuccessStateObj["failureReason"]>) => any;
}

export class GACPAgent {
    /**
     * 
     * @param agentConfig - Agent description and configuration
     * @param broker - Broker has to support GACP Protocol
     * @param actionIdentifier - User name/id has to be specified: In order to allow other agents to fetch the knowledge for user
     */
    constructor(
        agentConfig: GACPAgentConfig,
        broker: GACPMiddlewareBrokerConnector,
        actionIdentifier: string | Record<string, any>
    ) {

    }

    // TODO: Create dedicated events for Agent
    /** Emit events to this agent */
    private emit<EventName extends keyof GACPEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<GACPEvents[EventName]>
    ) {

    }
    
    /** Listen events emit to this agent */
    onEvent<EventName extends keyof GACPEvents>(
        eventName: EventName,
        eventListener: GACPEvents[EventName]
    ) {

    }
    
    async delegateTaskToAgent(task: string, agent: Partial<Pick<GACPAgentConfig, "id" | "name">>): Promise<SuccessStateObj> {
        return { success: true };
    }
    
    /**
     * Use to get current agents occupation
     * TODO: Return proper type
     */
    exploreTasks() {

    }
}

// TODO: Use below document as snippet is going to be shown in documentation
const connector = new GACPMiddlewareBrokerConnector("https://borker_url.io");
const g = new GACPAgent(
    {
        name: "music_player",
        description: "Agent ideal to play music",
        specialization: "Use this agent to play music in realtime for user",
        agentBox: async (agentInterface) => {
            // Listen here events calls to this agent
            agentInterface.onEvent("delegate_task", () => {
                // Play your agent with task delegated from another agent
            })

            return {
                invoke(task, caller) {
                    
                },
                getSkills(caller) {
                    // Return skills for caller - here can be verified
                },
                getKnowledge(caller) {
                    // Return skills for caller - here can be verified
                },
                getTools(caller) {

                }
            }
        }
    },
    connector,
    {
        userId: 11
    }
);


