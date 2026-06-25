import * as mqtt from 'mqtt';
import { 
    RelationsGraph, 
    RelationGraphID, 
    GACPEvents, 
    ExploredAgent,
    AgentDestination, 
    GACPConnectorStandardSchema
} from './types';

/** 
 * Use to communicate agents via centralized server to what other agents are connect
*/
export class GACPMiddlewareBrokerConnector implements GACPConnectorStandardSchema {
    brokerURL: string;
    relationsGraph?: RelationsGraph[] | RelationGraphID;
    private client: mqtt.MqttClient;
    private listeners: Map<string, Array<any>> = new Map();

    constructor(brokerURL: string, relationsGraph?: RelationsGraph[] | RelationGraphID) {
        this.brokerURL = brokerURL;
        this.relationsGraph = relationsGraph;
        this.client = mqtt.connect(this.brokerURL);

        this.client.on('message', (topic, message) => {
            const eventName = topic.split('/').pop();
            const data = JSON.parse(message.toString());
            const callbacks = this.listeners.get(eventName || '');
            if (callbacks) {
                callbacks.forEach(cb => cb(...data));
            }
        });
    }

    /** Emit events to this broker */
    public emit<EventName extends keyof GACPEvents>(
        eventName: EventName,
        ...eventArgs: Parameters<GACPEvents[EventName]>
    ) {
        const topic = `gacp/events/${eventName}`;
        this.client.publish(topic, JSON.stringify(eventArgs));
    }
    
    /** Listen events emit from this broker - published by other agents and so on */
    onEvent<EventName extends keyof GACPEvents>(
        eventName: EventName,
        eventListener: GACPEvents[EventName]
    ) {
        const topic = `gacp/events/${eventName}`;
        this.client.subscribe(topic);
        
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName)?.push(eventListener);
    }
    
    /**
     * Use to get all agents from broker
    */
    exploreAgents(): ExploredAgent[] {
        // TODO: Implement actual lookup from broker
        return [];
    }

    /** 
     * Use to get tasks assigned to each agent
     * TODO: Get task bound to agent
    */
    exploreTasks() {
        // TODO: Implement actual lookup from broker
    }

    async disconnect() {
        return new Promise<void>((resolve) => {
            this.client.end(false, () => resolve());
        });
    }
}

/** Use to communicate Agents directly */
export class GACPServerlessBrokerConnector implements GACPConnectorStandardSchema {
    agentURLs: string[];
    
    constructor(agentURLs: string[]) {
        this.agentURLs = agentURLs;
    }

    // TODO: Implement WebRTC signaling and data channel logic
}
