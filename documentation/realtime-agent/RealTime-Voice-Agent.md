<!-- TODO: Denote that lack of `agentCondif.models.transcriber` will make realtime experience to suffer in some piece -->
<!-- TODO: Mention the transcriber model strategies and it's behaviour  -->
<!-- TODO: Mention the RealTime Agent hosts the socket.io server for ice handshake and is peer with RealTimeAgent communication -->
<!-- TODO: Mention the elements from agent config and specification elements in user affordable form -->
<!-- TODO: Mention that `describeVoiceInstruction` and `systemPromptAddition` is pasted next to each another to transcriber - and that both are independent perhaps should be conflictless to don't confuse transcriber model - both are available in transcription only -->
<!-- TODO: User has to specify `speakBefore.sayAloud = false` to explicitly don't tell - as default each tool is told - add to documentation - as default both before and after tool call is told -->
<!-- TODO: Add that priority is full communication that's why everything is commpunicated -->
<!-- TODO: Describe when the configuration for model is used -->

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

### Plugins

Plugins are configured in `agent.plugins`. The real-time voice agent forwards them to its internal `ReActAgent`, so a plugin runs as part of the reasoning lifecycle. The compaction plugin runs at `before_model_call`, before each reasoning-model call, and estimates the current conversation size before deciding whether older messages need to be compacted or truncated.

Use `generateCompactReActAgentPlugin` with the context window of the `reasoning` model, not the STT or TTS model:

```typescript
import { generateCompactReActAgentPlugin } from "@ravenlens/raven-adk/agents";
import { RealTimeVoiceAgent as RealTimeVoiceAgentModule } from "@ravenlens/raven-adk/agents";

const RealTimeVoiceAgent = RealTimeVoiceAgentModule.RealTimeAgent.RealTimeVoiceAgent;

const compactionPlugin = generateCompactReActAgentPlugin(
    {
        name: "gpt-5-mini",
        contextWindowTokens: 128_000
    },
    (text) => text.split(/\s+/).filter(Boolean).length,
    80, // Run the compaction decision above 80% estimated usage.
    (context) => {
        console.log("Realtime context usage:", context);
    },
    {
        // Optional: bypass provider compaction and truncate older messages.
        forceTruncate: true,
        truncateSize: 500
    }
);

const voiceAgent = new RealTimeVoiceAgent({
    executionMode: {
        mode: "remote",
        server: {
            socketIo: { port: 3000 },
            webRTC: { iceServers: [] }
        }
    },
    communicationSpeechLevels: "all",
    agent: {
        models: {
            stt: {
                model: sttModel,
                speechApproach: "flush"
            },
            reasoning: reasoningModel,
            tts: ttsModel
        },
        systemPrompt: "You are a helpful voice assistant.",
        messages: [],
        tools: [],
        plugins: [compactionPlugin]
    }
});

await voiceAgent.run();
```

#### Voice description

The compaction plugin is a normal real-time plugin, so it is announced through TTS by default when `communicationSpeechLevels` allows the `plugins` level. If `describeVoiceInstruction` is omitted, the agent uses these default announcements:

- Before execution: `I'm using CompressConversation plugin to help you`
- After execution: `I've executed CompressConversation plugin and successfully retrieved output`

The announcement is optional and does not affect compaction or model execution. To provide clearer voice feedback, configure custom instructions:

```typescript
const compactionPlugin = {
    ...generateCompactReActAgentPlugin(
        { name: "gpt-5-mini", contextWindowTokens: 128_000 },
        tokenizer
    ),
    describeVoiceInstruction: {
        speakBefore: {
            defaultInstruction: "I am checking the conversation size before continuing."
        },
        speakAfter: {
            defaultInstruction: (_pluginName, _executionWay, pluginOutput) => {
                const status = pluginOutput?.status ?? "unknown";
                return `Conversation maintenance completed: ${status}.`;
            }
        },
    }
};
```

To keep compaction completely silent, disable both lifecycle announcements:

```typescript
const silentCompactionPlugin = {
    ...generateCompactReActAgentPlugin(
        { name: "gpt-5-mini", contextWindowTokens: 128_000 },
        tokenizer
    ),
    describeVoiceInstruction: {
        speakBefore: false,
        speakAfter: false
    }
};
```

If the user does not configure `describeVoiceInstruction`, the compaction plugin still executes. The only difference is that the default before/after announcements are used. Setting `speakBefore` or `speakAfter` to `false` suppresses that announcement only; it does not disable the plugin, prevent the model call, or prevent compaction.

#### Listening for execution

Use logic events to observe the plugin lifecycle for each reasoning-model call:

```typescript
voiceAgent.onLogicEvent("plugin_invoking", (pluginName, executionWay) => {
    if (pluginName === "CompressConversation") {
        console.log("Compaction plugin started:", executionWay);
    }
});

voiceAgent.onLogicEvent("plugin_result", (pluginName, executionWay, event) => {
    if (pluginName !== "CompressConversation") return;

    console.log("Compaction plugin finished:", executionWay, event);
    // event.status === "success" confirms plugin execution.
    // event.result?.status === true means it returned a changed agent config.
});
```

`onCompressionUpdate` reports the estimated category totals on every plugin run. A `plugin_result` event confirms execution, while `event.result?.status === true` indicates that the plugin produced a compaction or truncation update. A successful run with `event.result?.status === false` means the plugin ran but the configured threshold did not require a change. The lifecycle events are also emitted to the client as `logic.plugin_invoking` and `logic.plugin_result`.

---
## Frontend

