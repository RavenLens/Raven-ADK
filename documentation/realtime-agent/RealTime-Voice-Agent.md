<!-- TODO: Denote that lack of `agentCondif.models.transcriber` will make realtime experience to suffer in some piece -->
<!-- TODO: Mention the transcriber model strategies and it's behaviour  -->
<!-- TODO: Mention the RealTime Agent hosts the socket.io server for ice handshake and is peer with RealTimeAgent communication -->
<!-- TODO: Mention the elements from agent config and specification elements in user affordable form -->

# RealTimeVoice Agent
It's agent to communicate via voice and optionally live avatar the speech with you

---

## Backend

### Questions:
#### How to configure speech for specific executable element?
1. General Setup - Setup with agent config what have to be told
> `"all"` is default config
```typescript
{
    communicationSpeechLevels: "all" // specify all for all
}

// OR:
{
    afterTranscript: true; // specify true for things have to be told
    thoughts: false; // specify false for things cannot be told
    tools: true;
    skills: true;
    hitl: true;
    memory: true;
    subagents: true;
}
```

2. Specify instruction for tools - Use to setup specific tool to not be told or have to be told and specify instructions for each subsequent tool
> You can implement fine-grained tunning actions base on the agent config object specification

---
## Frontend

