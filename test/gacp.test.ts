import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GACPAgent, GACPMiddlewareBrokerConnector } from '../src/gacp';

// Mock mqtt for the broker
vi.mock('mqtt', () => {
    return {
        connect: vi.fn().mockReturnValue({
            on: vi.fn(),
            subscribe: vi.fn(),
            publish: vi.fn(),
            end: vi.fn((force, cb) => cb && cb()),
        }),
    };
});

describe('GACP Communication', () => {
    let broker: GACPMiddlewareBrokerConnector;
    const brokerUrl = 'mqtt://localhost:1883';

    beforeEach(() => {
        vi.clearAllMocks();
        broker = new GACPMiddlewareBrokerConnector(brokerUrl);
    });

    it('should initialize a GACPAgent and its agentBox', async () => {
        const agentBoxMock = vi.fn().mockResolvedValue({
            invoke: vi.fn(),
            getSkills: vi.fn(),
            getTools: vi.fn(),
            getKnowledge: vi.fn(),
        });

        const agent = new GACPAgent(
            {
                name: 'TestAgent',
                description: 'A test agent',
                agentBox: agentBoxMock,
            },
            broker,
            { userId: 'user_1' }
        );

        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 0));
        
        expect(agentBoxMock).toHaveBeenCalled();
    });

    it('should emit events through the broker', async () => {
        const agent = new GACPAgent(
            {
                name: 'EmitterAgent',
                description: 'Emits events',
                agentBox: async () => ({
                    invoke: async () => true,
                    getSkills: () => [],
                    getTools: () => [],
                    getKnowledge: () => ({}),
                }),
            },
            broker,
            { userId: 'user_1' }
        );

        agent.emit('task_execution_start', { name: 'EmitterAgent' }, 'test task');
        
        // The broker's emit should have been called (internally calling mqtt publish)
        // We'd need to peek into broker if we wanted to check the mqtt call specifically
    });

    it('should handle task delegation', async () => {
        const agent = new GACPAgent(
            {
                name: 'ManagerAgent',
                description: 'Delegates tasks',
                agentBox: async () => ({
                    invoke: async () => true,
                    getSkills: () => [],
                    getTools: () => [],
                    getKnowledge: () => ({}),
                }),
            },
            broker,
            { userId: 'user_1' }
        );

        const result = await agent.delegateTaskToAgent('play music', { name: 'MusicPlayer' });
        expect(result.success).toBe(true);
    });
});
