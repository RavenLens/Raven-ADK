import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReActAgent } from "../../src/agent/ReAct.agent";
import { tool } from "../../src/agent/tools/tools";
import { AIMessage, ToolMessage } from "../../src/agent/state";
import { DummyModel, DummyModelConfig } from "../../src/models/text-to-text/dummy";

const aiAnswer = (content: string) => {
	const message: AIMessage = { type: "ai", content };
	return {
		messages: [message],
		answer: [message],
		tokens: { input: 2, output: 3, reasoning: 0 }
	};
};

const toolCallAnswer = (toolName: string, argumentsValue: Record<string, unknown>) => {
	const message: ToolMessage = {
		type: "tool",
		tool_id: `${toolName}-call`,
		tool_name: toolName,
		content: JSON.stringify(argumentsValue),
		arguments: argumentsValue
	};
	return {
		messages: [message],
		answer: [message],
		tokens: { input: 2, output: 3, reasoning: 0 }
	};
};

const createAgent = (model: DummyModel, options: Partial<ConstructorParameters<typeof ReActAgent>[0]> = {}) =>
	new ReActAgent({
		model,
		systemPrompt: "You are a deterministic test agent.",
		messages: [{ type: "user", content: "Complete the task." }],
		tools: [],
		withConclusion: false,
		...options
	});

describe("DummyModel", () => {
	it("returns a configured singular invoke outcome and emits it", async () => {
		const answer = aiAnswer("fixed response");
		const model = new DummyModel({ invokeOutcome: answer });
		const outputListener = vi.fn();
		model.onEvent("output", outputListener);

		await expect(model.invoke({ stream: true })).resolves.toEqual(answer);
		expect(outputListener).toHaveBeenCalledOnce();
		expect(outputListener).toHaveBeenCalledWith(answer);
	});

	it("consumes messagesFlow in order and calls handleOverflow after it is depleted", async () => {
		const first = aiAnswer("first");
		const second = aiAnswer("second");
		const overflow = vi.fn((options) => aiAnswer(`overflow-${options.type}`));
		const model = new DummyModel({ messagesFlow: [first, second], handleOverflow: overflow });

		await expect(model.invoke()).resolves.toEqual(first);
		await expect(model.invoke()).resolves.toEqual(second);
		await expect(model.invoke()).resolves.toEqual(aiAnswer("overflow-invoke"));
		expect(overflow).toHaveBeenCalledOnce();
		expect(model.messageFlowLastIndex).toBe(1);
	});

	it("passes invocation options to function-based outcomes", async () => {
		const outcome = vi.fn((options) => aiAnswer(options.type === "invokeStructuredOutput" ? "structured" : "normal"));
		const schema = z.object({ value: z.string() });
		const model = new DummyModel({ invokeOutcome: outcome, invokeStructuredOutcome: outcome });

		await expect(model.invoke({ reasoning: { effort: "low" } })).resolves.toEqual(aiAnswer("normal"));
		await expect(model.invokeStructuredOutput(schema, 4, { stream: false })).resolves.toEqual(aiAnswer("structured"));
		expect(outcome).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: "invoke", reasoning: { effort: "low" } }));
		expect(outcome).toHaveBeenNthCalledWith(2, expect.objectContaining({
			type: "invokeStructuredOutput",
			schema,
			maxRecallTries: 4,
			options: { stream: false }
		}));
	});

	it("preserves configured conversation context and can reset a scripted flow", async () => {
		const configuredMessages = [{ type: "user" as const, content: "Keep this context." }];
		const model = new DummyModel({ messagesFlow: [aiAnswer("next")] });

		const result = await model.invoke({ messages: configuredMessages });
		expect(result.messages).toEqual([...configuredMessages, ...aiAnswer("next").messages]);

		model.reset();
		await expect(model.invoke({ messages: configuredMessages })).resolves.toEqual({
			...aiAnswer("next"),
			messages: [...configuredMessages, ...aiAnswer("next").messages]
		});
	});

	it("supports a callback passed directly to invoke", async () => {
		const callback = vi.fn(() => aiAnswer("direct callback"));
		const model = new DummyModel({});

		await expect(model.invoke(callback)).resolves.toEqual(aiAnswer("direct callback"));
		expect(callback).toHaveBeenCalledWith({ type: "invoke" });
	});

	it("can reject invalid structured output when validation is enabled", async () => {
		const model = new DummyModel({
			validateStructuredOutput: true,
			invokeStructuredOutcome: aiAnswer(JSON.stringify({ count: "not-a-number" }))
		});
		const schema = z.object({ count: z.number() });

		await expect(model.invokeStructuredOutput(schema)).rejects.toThrow("structured output does not match schema");
	});
});

describe("DummyModel with ReActAgent", () => {
	it("drives a tool call and a following final response without an LLM", async () => {
		const lookup = vi.fn(async ({ value }: { value: string }) => `looked up: ${value}`);
		const observedInvocations: unknown[] = [];
		const lookupTool = tool(lookup, {
			toolName: "lookup",
			toolDescription: "Looks up a value",
			toolArguments: z.object({ value: z.string() })
		});
		const model = new DummyModel({
			messagesFlow: [
				(options) => {
					observedInvocations.push(options);
					return toolCallAnswer("lookup", { value: "Raven" });
				},
				(options) => {
					observedInvocations.push(options);
					return aiAnswer("The lookup is complete.");
				}
			]
		});
		const agent = createAgent(model, { tools: [lookupTool] });

		const result = await agent.invoke();

		expect(lookup).toHaveBeenCalledWith({ value: "Raven" });
		expect((observedInvocations[1] as { messages: { type: string; toolOutput?: string }[] }).messages)
			.toContainEqual(expect.objectContaining({ type: "tool", toolOutput: "looked up: Raven" }));
		expect(result.messages.at(-1)?.content).toBe("The lookup is complete.");
		expect(model.messageFlowLastIndex).toBe(1);
	});

	it("uses invokeStructuredOutput for a deterministic structured conclusion", async () => {
		const structuredOutput = { status: "complete", count: 2 };
		const modelConfig: DummyModelConfig = {
			invokeOutcome: aiAnswer("I gathered the required facts."),
			invokeStructuredOutcome: {
				messages: [{ type: "ai", content: JSON.stringify(structuredOutput), structuredOutput }],
				answer: [{ type: "ai", content: JSON.stringify(structuredOutput), structuredOutput }],
				tokens: { input: 4, output: 2, reasoning: 0 }
			}
		};
		const model = new DummyModel(modelConfig);
		const agent = createAgent(model);
		const schema = z.object({ status: z.string(), count: z.number() });

		const result = await agent.invokeStructuredOutput(schema, 2);

		expect(result.messages.at(-1)).toMatchObject({
			type: "ai",
			content: JSON.stringify(structuredOutput),
			structuredOutput
		});
		expect(agent.usedTokens).toEqual({ input: 6, output: 5, reasoning: 0 });
	});
});
