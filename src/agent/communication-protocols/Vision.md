# Communication Protocols

## Purpose

Communication protocols provide a common agent-to-agent communication model for
local and remote agents. The model must be usable by:

- ReActAgent
- CodeAgents
- AgentsDebate

The common model is then mapped to external protocols and transports such as:

- A2A
- ACP

## Support
Communication protocols have to support these patterns:

### RavenADK Agentic concepts
Agents have to use these patterns to provide seamless communication with other agents

List:
- tools - can be used to dunamically explore other agents. Tools may be
	- `discover_agents`
	- `delegate_task`
	- `ask_agent`
	- `consult_agents`
	- `critique_result`
	- `seek_skill`
	- `seek_knowledge`
	- `get_agent_status`
- plugins - is way to launch some action regardless the agent decision
	- Plugins should be invokable from same places as a original places of invoking for agents
- handoff & queue - it's way to allow agents to don't stop reasoning because e.g: other agent is working on task for this agent
	- maximum waiting time has to be specified once the other agent has failed - to prevent infinite waiting
- events - have to communicate that agent leverages communication protocol, finished its work and waits for. Event should be universally emitted from a protocol and propagated as `onEvent` from agent to conserve the mose important part of logic

	- Special events may be:
		- `authentication` - protocols may request authentication

- Discovery & Exploration - is a way to let agent explore other agents and show-off themself

## Telemetry
Agentic communication has to be integrated with telementry for open and active tracing

## Architecture

```text
ReActAgent / CodeAgent / AgentsDebate
				|
				v
		AgentProtocolParticipant
				|
				v
		  AgentProtocolClient
				|
				v
	   Canonical communication schema
				|
		+-------+--------+--------+
		|                |        |
	   A2A              ACP      GACP
	  binding           binding  binding
		|                |        |
	  HTTP/SSE          HTTP     MQTT/WebRTC/MCP
```

The layers have separate responsibilities:

1. **Canonical schema** defines agents, tasks, messages, results, events,
   artifacts, discovery, budgets, errors, and cancellation.
2. **Protocol client** provides a protocol-neutral runtime API to an agent or
   orchestrator.
3. **Protocol binding** translates the canonical model to and from A2A, ACP,
   GACP, or another wire protocol.
4. **Tools** expose selected protocol operations to the model, allowing the
   model to decide when communication is useful.
5. **Plugins** perform automatic lifecycle, policy, authorization, tracing,
   budget, and event handling.

## RavenHUB support
It's to be support by RavenHUB - each protocol can go throught some kind of central hub
