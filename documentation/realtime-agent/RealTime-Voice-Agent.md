<!-- TODO: Denote that lack of `agentCondif.models.transcriber` will make realtime experience to suffer in some piece -->
<!-- TODO: Mention the transcriber model strategies and it's behaviour  -->
<!-- TODO: Mention the RealTime Agent hosts the socket.io server for ice handshake and is peer with RealTimeAgent communication -->
<!-- TODO: Mention the elements from agent config and specification elements in user affordable form -->
<!-- TODO: Mention that `describeVoiceInstruction` and `systemPromptAddition` is pasted next to each another to transcriber - and that both are independent perhaps should be conflictless to don't confuse transcriber model - both are available in transcription only -->
<!-- TODO: User has to specify `speakBefore.sayAloud = false` to explicitly don't tell - as default each tool is told - add to documentation - as default both before and after tool call is told -->

# RealTimeVoice Agent
It's agent to communicate via voice and optionally live avatar the speech with you

---

## Backend

## Configuration
- Configure

### Speak Before Reasoning

Use `beforeLogicProcessing` to have the voice agent acknowledge a completed user utterance before its reasoning agent starts. This works well for a Siri-style response such as "Hi, how can I help you today?" or "Let me look into that for you."

```typescript
const voiceAgent = new RealTimeVoiceAgent({
    // Other configuration omitted
    beforeLogicProcessing: {
        toSay: "Hi, how can I help you today?",
        nature: "blocking"
    },
    agent: {
        // Models and agent configuration omitted
    }
});
```

The configured phrase is spoken for every final transcript. It is a per-turn acknowledgement, not a one-time greeting when the client connects.

For a request-aware acknowledgement, provide a function. It receives the final speech-to-text transcript and can return a string or a promise for one:

```typescript
{
    beforeLogicProcessing: {
        toSay: async (transcript) => {
            const request = transcript.trim();
    
            if (/^(hi|hello)\b/i.test(request)) {
                return "Hi, how can I help you today?";
            }
    
            return `I heard: ${request}. Let me work on that.`;
        },
        nature: "non-blocking"
    },
    // ... Rest of params
}
```

Set `nature` to `"blocking"` when the agent must wait until the acknowledgement finishes before it starts reasoning. Set it to `"non-blocking"` to speak while reasoning begins in parallel.

`toSay` only controls the spoken acknowledgement. It does not replace the transcript sent to the reasoning model. Configure `agent.models.transcriber` for `after-full-stt-transcript` when the final transcript itself must be normalized or rewritten before the request reaches the reasoning agent.

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

