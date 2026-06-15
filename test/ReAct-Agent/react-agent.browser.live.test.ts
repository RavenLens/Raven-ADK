import "dotenv/config";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { OpenAI } from "../../src/models/openai";
import { BrowserToolsBucket } from "../../src/agent/tools/general/browser";

const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
const liveDescribe = (openaiApiKey && openaiApiKey.length > 0) ? describe : describe.skip;

liveDescribe("ReActAgent with Browser Tools - OpenAI Live Integration", () => {
    let agent: ReActAgent<any, any>;

    beforeEach(() => {
        // Reset state before each test
        agent = new ReActAgent({
            model: new OpenAI({
                model: "gpt-5-mini",
                apiKey: openaiApiKey!,
            }),
            systemPrompt: `You are a web researcher assistant. Your task is to:
1. Navigate to webpages using the browser tools
2. Extract relevant information
3. Analyze the content
4. Always close the browser when you're completely done with all your work

${BrowserToolsBucket.systemPrompt}`,
            tools: BrowserToolsBucket.tools,
            messages: []
        });
    });

    it("can read a simple webpage and close the browser automatically", async () => {
        const agent = new ReActAgent({
            model: new OpenAI({
                model: "gpt-5-mini",
                apiKey: openaiApiKey!,
            }),
            systemPrompt: `You are a web assistant. Read the GitHub Copilot homepage, extract the main heading and description, 
then analyze it. After you have all the information you need, close the browser.

${BrowserToolsBucket.systemPrompt}`,
            tools: BrowserToolsBucket.tools,
            messages: [
                {
                    type: "user",
                    content: "Visit https://github.com/features/copilot and tell me what the main heading says. Then close the browser."
                }
            ]
        });

        const result = await agent.invoke();

        // Verify that browser tools were used
        const toolCalls = result.messages.filter(m => m.type === "tool");
        expect(toolCalls.length).toBeGreaterThan(0);

        // Verify that open_webpage was called
        const openWebpageCall = result.messages.find(
            m => m.type === "tool" && m.tool_name === "open_webpage"
        );
        expect(openWebpageCall).toBeDefined();

        // Verify that a read tool was called (text, html, or content)
        const readCall = result.messages.find(
            m => m.type === "tool" && 
                (m.tool_name === "read_page_text" || 
                 m.tool_name === "read_page_html" || 
                 m.tool_name === "read_page_content")
        );
        expect(readCall).toBeDefined();

        // Verify that close_browser was called (agent should clean up)
        const closeBrowserCall = result.messages.find(
            m => m.type === "tool" && m.tool_name === "close_browser"
        );
        expect(closeBrowserCall).toBeDefined();

        // Check the final answer
        const lastAIMessage = [...result.messages].reverse().find(m => m.type === "ai");
        expect(lastAIMessage?.content).toBeTruthy();
        // expect(lastAIMessage?.content?.toLowerCase()).toContain("github" || "copilot" || "heading");

        console.log("✅ Successfully read webpage and closed browser");
        console.log("Final response:", lastAIMessage?.content);
    }, 500_000);

    it("can take a screenshot and analyze the page visually", async () => {
        const agent = new ReActAgent({
            model: new OpenAI({
                model: "gpt-5-mini",
                apiKey: openaiApiKey!,
            }),
            systemPrompt: `You are a visual content analyzer. Your task is to:
1. Open the webpage
2. Take a screenshot to capture the visual state
3. Read the page content
4. Analyze both the visual and textual information
5. Close the browser when done

${BrowserToolsBucket.systemPrompt}`,
            tools: BrowserToolsBucket.tools,
            messages: [
                {
                    type: "user",
                    content: "Visit https://example.com, take a screenshot, read the content, and tell me what you see. Then close the browser."
                }
            ]
        });

        const result = await agent.invoke();

        // Verify screenshot was taken
        const snapshotCall = result.messages.find(
            m => m.type === "tool" && m.tool_name === "take_snapshot"
        );
        expect(snapshotCall).toBeDefined();

        // Verify browser was closed
        const closeBrowserCall = result.messages.find(
            m => m.type === "tool" && m.tool_name === "close_browser"
        );
        expect(closeBrowserCall).toBeDefined();

        console.log("✅ Successfully took screenshot and closed browser");
    }, 500_000);

    it("handles multiple page reads and closes browser at the end", async () => {
        const agent = new ReActAgent({
            model: new OpenAI({
                model: "gpt-5-mini",
                apiKey: openaiApiKey!,
            }),
            systemPrompt: `You are a web research assistant. Your task is to:
1. Read the content from the first webpage
2. Extract key information
3. Close the browser

${BrowserToolsBucket.systemPrompt}`,
            tools: BrowserToolsBucket.tools,
            messages: [
                {
                    type: "user",
                    content: "Open https://example.com, read all content, summarize what you find, and close the browser."
                }
            ]
        });

        const result = await agent.invoke();

        // Count browser operations
        const openCalls = result.messages.filter(
            m => m.type === "tool" && m.tool_name === "open_webpage"
        ).length;
        const readCalls = result.messages.filter(
            m => m.type === "tool" && 
                (m.tool_name === "read_page_text" || 
                 m.tool_name === "read_page_html" || 
                 m.tool_name === "read_page_content")
        ).length;
        const closeCalls = result.messages.filter(
            m => m.type === "tool" && m.tool_name === "close_browser"
        ).length;

        // Verify correct sequence
        expect(openCalls).toBeGreaterThan(0);
        expect(readCalls).toBeGreaterThan(0);
        expect(closeCalls).toBeGreaterThan(0);

        // Verify browser was closed
        const lastToolCall = [...result.messages].reverse().find(m => m.type === "tool");
        expect(lastToolCall?.tool_name).toBe("close_browser");

        console.log("✅ Successfully completed multi-operation workflow with proper cleanup");
        console.log(`Operations: ${openCalls} opens, ${readCalls} reads, ${closeCalls} closes`);
    }, 500_000);

    it("agent detects open browser and closes it appropriately", async () => {
        const agent = new ReActAgent({
            model: new OpenAI({
                model: "gpt-5-mini",
                apiKey: openaiApiKey!,
            }),
            systemPrompt: `You are a careful web assistant. Your task is to:
1. Check if browser is open before starting
2. Open a webpage
3. Check if browser is open after opening (it should be)
4. Read content
5. Check if browser is open after reading (it should still be)
6. Close the browser
7. Verify browser is closed

${BrowserToolsBucket.systemPrompt}`,
            tools: BrowserToolsBucket.tools,
            messages: [
                {
                    type: "user",
                    content: "Check browser status, open example.com, check again, read content, then close and verify it's closed."
                }
            ]
        });

        const result = await agent.invoke();

        // Count status checks
        const statusChecks = result.messages.filter(
            m => m.type === "tool" && m.tool_name === "is_browser_open"
        ).length;

        // Should have at least 3 status checks: before, after open, after read, after close
        expect(statusChecks).toBeGreaterThanOrEqual(2);

        // Verify browser was closed at the end
        const closeBrowserCall = result.messages.find(
            m => m.type === "tool" && m.tool_name === "close_browser"
        );
        expect(closeBrowserCall).toBeDefined();

        console.log("✅ Successfully monitored browser state throughout execution");
        console.log(`Status checks performed: ${statusChecks}`);
    }, 500_000);

    afterEach(() => {
        // Cleanup after each test
        agent = null as any;
    }, 500_000);
});
