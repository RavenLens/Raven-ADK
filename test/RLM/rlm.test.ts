import "dotenv/config";
import { describe, expect, it } from "vitest";
import { OpenAI } from "../../src/models/text-to-text/openai";
import { RLMAgent } from "../../src/agent/RLM/orchestrator";
import { NodeExecutionSandbox } from "../../src/agent/tools/CodeExecutionSandboxes/nodejs-sandbox";

const openAIApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = openAIApiKey ? describe : describe.skip;

liveDescribe("RLMAgent (Recursive Language Model) Live Test", () => {
    it("can solve a task using sequential processing of code and sub-models", async () => {
        const hugeDataset = `
User Data Log:
ID 1: Alice, Age 25, City New York, Status: active
ID 2: Bob, Age 30, City San Francisco, Status: pending
ID 3: Charlie, Age 22, City Chicago, Status: active
ID 4: David, Age 35, City Miami, Status: active
ID 5: Eve, Age 28, City Seattle, Status: active
... (imagine 50MB of this) ...
ID 100: Zara, Age 29, City Boston, Status: active
        `;

        const orchestratorModel = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
        });

        const subModel = {
            model: new OpenAI({
                model: "gpt-5-mini",
                apiKey: openAIApiKey!,
            }),
            instruction: "Extract user details from the provided snippet."
        };

        const agent = new RLMAgent(hugeDataset, {
            model: orchestratorModel,
            submodels: [subModel],
            codeSandbox: new NodeExecutionSandbox(),
            maxIterations: 5
        });

        const finalAnswer = await agent.invoke("Find the status of Zara from the dataset.");

        expect(finalAnswer?.toLowerCase()).toContain("active");
        expect(finalAnswer?.toLowerCase()).toContain("zara");
        
        const usage = agent.getUsage();
        expect(usage.orchestrator_llm.input).toBeGreaterThan(0);
    }, 120000);

    it("handles code blocks focusing on data extraction before LLM query", async () => {
        const dataset = "Header\n" + "Random text\n".repeat(50) + "ID 999: User Zara is living in London and her status is 'legendary'.\n" + "Footer\n";
        
        const model = new OpenAI({
            model: "gpt-5-mini",
            apiKey: openAIApiKey!,
        });

        const agent = new RLMAgent(dataset, {
            model: model,
            codeSandbox: new NodeExecutionSandbox(),
            maxIterations: 3
        });

        const events: string[] = [];
        agent.onEvent("execute_code_start", (code) => {
            events.push(`code_start`);
        });
        agent.onEvent("submodel_call", () => {
            events.push("submodel_call");
        });

        const answer = await agent.invoke("What is the status of Zara?");
        
        expect(answer?.toLowerCase()).toContain("legendary");
        expect(events.length).toBeGreaterThan(0);
    }, 120000);
});
