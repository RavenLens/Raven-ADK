import { 
    GACPAgentConfig, 
    GACPEvents, 
    AgentDestination, 
    SuccessStateObj,
    AgentBoxReturnType
} from './types';
import { GACPMiddlewareBrokerConnector } from './broker-connectors';

export class GACPAgent {
    private agentConfig: GACPAgentConfig;
    private broker: GACPMiddlewareBrokerConnector;
    private actionIdentifier: string | Record<string, any>;
    private box?: AgentBoxReturnType;
    private throughput: number = 5;
    private currentTasks: number = 0;
    private queue: string[] = [];

    /**
     * @param agentConfig - Agent description and configuration
     * @param broker - Broker has to support GACP Protocol
     * @param actionIdentifier - User name/id has to be specified: In order to allow other agents to fetch the knowledge for user
     */
    constructor(
        agentConfig: GACPAgentConfig,
        broker: GACPMiddlewareBrokerConnector,
        actionIdentifier: string | Record<string, any>
    ) {
        this.agentConfig = agentConfig;
        this.broker = broker;
        this.actionIdentifier = actionIdentifier;
        
        this.initializeBox();
    }

    private async initializeBox() {
        this.box = await this.agentConfig.agentBox(this);
    }

    /** Emit events to this agent/network */
    public emit<EventName extends keyof GACPEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<GACPEvents[EventName]>
    ) {
        this.broker.emit(eventName, ...eventArgs);
    }
    
    /** Listen events emit to this agent */
    public onEvent<EventName extends keyof GACPEvents>(
        eventName: EventName,
        eventListener: GACPEvents[EventName]
    ) {
        this.broker.onEvent(eventName, eventListener);
    }
    
    async delegateTaskToAgent(task: string, agent: Partial<Pick<GACPAgentConfig, "id" | "name">>): Promise<SuccessStateObj> {
        const toAgent: AgentDestination = {
            id: agent.id || (agent.name ? agent.name.toLowerCase().replace(/ /g, '_') : 'unknown'),
            name: agent.name || 'Unknown Agent'
        };

        this.emit('delegate_task', toAgent, task);
        
        return { success: true };
    }

    /**
     * Get the current status of this agent's queue
     */
    getQueueStatus() {
        return {
            load: this.currentTasks,
            throughput: this.throughput,
            queueLength: this.queue.length
        };
    }
    
    /**
     * Use to get current agents occupation
     */
    exploreTasks() {
        return this.broker.exploreTasks();
    }

    /**
     * Explore other agents in the network
     */
    exploreAgents() {
        return this.broker.exploreAgents();
    }

    /**
     * Seek a skill from the network
     */
    async seekSkill(skillName: string) {
        this.emit('seek_skill', { id: this.agentConfig.id, name: this.agentConfig.name });
        // Logic to find and potentially "buy" or acquire skill
    }

    /**
     * Seek knowledge from the network
     */
    async seekKnowledge(query: string) {
        this.emit('seek_knowledge', { id: this.agentConfig.id, name: this.agentConfig.name });
        // Logic to query the network for specific files or data
    }
}
