# Communication Protocols
Communication Protocols are the set of protocols used to communicate RavenADK internal agents with external agents with usage of them as wrappers for a **Agent Communication Protocols**

## Schema
* Defines universal schema has to be used by a Wrappers for `Agentic Protocols` e.g: A2A protocol has to use such schema to connect with another agent and delegate/retrive from it tasks and get/set its status and other agent status
* Schema defined at [communicationProtocolSchema.ts](./communicationProtocolSchema.ts) is communication protocol agnostic therefore can be used with each protocol
* Use Schema to define Communcation protocol like HTTP/RPC-JSON 2 or Kafka, RabitMQ and so forth - these are used to add task to a queue
