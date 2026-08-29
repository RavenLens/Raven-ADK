import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { AutoPilotHITL, HITLAdapter, HITLRequest, HITLResponse } from "../../../src/agent/tools/hitl";
import { tool } from "../../../src/agent/tools/tools";

const deleteAccountTool = tool(async () => "deleted", {
	toolName: "delete_account",
	toolDescription: "Delete an account.",
	toolArguments: z.object({ accountId: z.string() })
});

function createMockAdapter(): {
	adapter: HITLAdapter;
	sent: { id: number; request: HITLRequest }[];
	respond: (id: number, response: HITLResponse) => void;
} {
	let handler: ((correlationId: string | number, response: HITLResponse) => void) | undefined;
	const sent: { id: number; request: HITLRequest }[] = [];

	return {
		adapter: {
			onResponse(responseHandler) {
				handler = responseHandler;
			},
			send(id, request) {
				sent.push({ id: id as number, request });
			}
		},
		sent,
		respond(id, response) {
			handler?.(id, response);
		}
	};
}

function createMockJudge(judgeResult: "omit" | "use-hitl") {
	const judge = {
		agentConfig: { messages: [] },
		invokeStructuredOutput: vi.fn(async (_schema: z.ZodType) => ({
			messages: [{
				type: "ai" as const,
				structuredOutput: { judgeResult }
			}]
		}))
	};
	return judge as any;
}

describe("AutoPilotHITL events", () => {
	it("notifies multiple listeners and onAnyEvent when the judge omits HITL", async () => {
		const { adapter } = createMockAdapter();
		const judge = createMockJudge("omit");
		const hitl = new AutoPilotHITL(judge, { adapter });
		const firstStartedListener = vi.fn();
		const secondStartedListener = vi.fn();
		const finishedListener = vi.fn();
		const anyListener = vi.fn();

		hitl.onEvent("autopilot_judge_started", firstStartedListener);
		hitl.onEvent("autopilot_judge_started", secondStartedListener);
		hitl.onEvent("autopilot_judge_finished", finishedListener);
		hitl.onAnyEvent(anyListener);

		const result = await hitl.emitToolUsageAutoPilot({
			toolInstance: deleteAccountTool,
			params: { accountId: "account-1" }
		});

		expect(result).toEqual({ judgeEffect: "omit" });
		expect(firstStartedListener).toHaveBeenCalledTimes(1);
		expect(secondStartedListener).toHaveBeenCalledTimes(1);
		expect(finishedListener).toHaveBeenCalledTimes(1);
		expect(anyListener).toHaveBeenCalledWith("autopilot_judge_started", expect.anything());
		expect(anyListener).toHaveBeenCalledWith("autopilot_judge_finished", expect.anything(), "omit");
	});

	it("emits judge events before the inherited approval events when HITL is required", async () => {
		const { adapter, sent, respond } = createMockAdapter();
		const hitl = new AutoPilotHITL(createMockJudge("use-hitl"), {
			adapter,
			toolsUsage: { delete_account: true }
		});
		const events: string[] = [];

		hitl.onEvent("autopilot_judge_started", () => events.push("judge_started"));
		hitl.onEvent("autopilot_judge_finished", () => events.push("judge_finished"));
		hitl.onEvent("hitl_start", () => {events.push("hitl_start")});

		const approval = hitl.emitToolUsage({
			toolInstance: deleteAccountTool,
			params: { accountId: "account-1" }
		});

		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(events).toEqual(["judge_started", "judge_finished", "hitl_start"]);

		respond(sent[0].id, { type: "tool-approval", answer: "allow" });
		await expect(approval).resolves.toEqual({ answer: "allow", reason: "user_answer" });
	});

	it("judges an acceptance request and omits it without contacting the adapter", async () => {
		const { adapter, sent } = createMockAdapter();
		const judge = createMockJudge("omit");
		const hitl = new AutoPilotHITL(judge, {
			adapter,
			engageJudgeInEmittingAccetpance: { instruction: "Only ask for approval when strictly necessary." }
		});

		await expect(hitl.emitAcceptance("Run the cleanup?", "Removes temporary files.")).resolves.toBe("deny");
		expect(sent).toHaveLength(0);
		expect(judge.invokeStructuredOutput).toHaveBeenCalledTimes(1);
	});

	it("continues with acceptance when its judge returns use-hitl", async () => {
		const { adapter, sent, respond } = createMockAdapter();
		const hitl = new AutoPilotHITL(createMockJudge("use-hitl"), {
			adapter,
			engageJudgeInEmittingAccetpance: true
		});

		const acceptance = hitl.emitAcceptance("Deploy this change?");
		await vi.waitFor(() => expect(sent).toHaveLength(1));
		expect(sent[0].request).toEqual({
			type: "acceptance",
			question: "Deploy this change?",
			context: undefined
		});

		respond(sent[0].id, { type: "acceptance-answer", answer: "allow" });
		await expect(acceptance).resolves.toBe("allow");
	});
});
