# Memory for coding agents

## Requirements
- Can use S3 to store the informations or the custom adapter - implement the adapter as the `class` or the `function`
- Mixed memory - Leverages `DeterministicMemorySchema` and `ToolBasedMemorySchema` from `RavenADK`
    - Place of call - can be specified separatelly and specially for **Agent**
- Markdown Documents Format - keep memory as markdonw document format
- Persistence - Each document can have given time to live - user can specify the time to live for each document manually or can give agent instruction when and what specify with time to live
    - Config based - user can specify persistance and maximum/minimum time to live
    - Persistance handler in adapter - implement special unit the role is to handle the persistance - user can define own e.g: different has to base on redis ttl and different for db doesn't use a Persistance Layer

