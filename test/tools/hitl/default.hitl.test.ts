import { describe, it, expect, vi } from "vitest";
import * as z from "zod";
import { HITL, HITLAdapter, HITLRequest, HITLResponse } from "../../../src/agent/tools/hitl";
import { tool } from "../../../src/agent/tools/tools";

const deleteAccountTool = tool(async () => "", {
    toolName: "delete_account",
    toolDescription: "Delete an account.",
    toolArguments: z.object({})
});

const transferMoneyTool = tool(async () => "", {
    toolName: "transfer_money",
    toolDescription: "Transfer money.",
    toolArguments: z.object({ amount: z.number() })
});

function createMockAdapter(): { adapter: HITLAdapter; sent: { id: number; request: HITLRequest }[]; respond: (id: number, response: HITLResponse) => void } {
    let handler: ((correlationId: string | number, response: HITLResponse) => void) | undefined = undefined;
    const sent: { id: number; request: HITLRequest }[] = [];

    const adapter: HITLAdapter = {
        onResponse(h) {
            handler = h;
        },
        send(id, request) {
            sent.push({ id: id as number, request });
        }
    };

    return {
        adapter,
        sent,
        respond(id, response) {
            handler?.(id, response);
        }
    };
}

describe("hitl.ts", () => {
    it("creates no question tools when questions are not configured", () => {
        const { adapter } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            toolsUsage: { delete_account: true }
        });

        expect(hitl.createQuestionTools()).toHaveLength(0);
    });

    it("creates abc and open question tools when configured", () => {
        const { adapter } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            questions: {
                abcQuestion: { instruction: "Pick one." },
                openQuestion: { instruction: "Type an answer." }
            }
        });

        const tools = hitl.createQuestionTools();
        expect(tools).toHaveLength(2);
        expect(tools.map(t => t.toolConfig.toolName)).toContain("hitl_ask_abc_question");
        expect(tools.map(t => t.toolConfig.toolName)).toContain("hitl_ask_open_question");
    });

    it("emits tool-approval request and resolves when response arrives", async () => {
        const { adapter, sent, respond } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            toolsUsage: { delete_account: true }
        });

        const params = { accountId: "account-1" };
        const promise = hitl.emitToolUsage({ toolInstance: deleteAccountTool, params });
        expect(sent).toHaveLength(1);
        expect(sent[0].request).toEqual({
            type: "tool-approval",
            toolName: "delete_account",
            toolInstance: deleteAccountTool,
            params
        });

        respond(sent[0].id, { type: "tool-approval", answer: "allow" });
        const result = await promise;
        expect(result).toEqual({ answer: "allow", reason: "user_answer" });
    });

    it("applies delay fallback when configured and no response arrives in time", async () => {
        const { adapter } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            toolsUsage: {
                transfer_money: { delayMs: 50, defaultAnswer: "deny" }
            }
        });

        const result = await hitl.emitToolUsage({ toolInstance: transferMoneyTool, params: { amount: 100 } });
        expect(result).toEqual({ answer: "deny", reason: "delay_pass" });
    });

    it("rejects abc question when options are outside configured range", async () => {
        const { adapter } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            questions: {
                abcQuestion: { instruction: "Pick one.", maxAnswersRange: ["a", "b", "c"] }
            }
        });

        await expect(
            hitl.emitAbcQuestion("Which?", [["a", "A"], ["d", "D"]])
        ).rejects.toThrow("options_not_in_range");
    });

    it("resolves abc question when response arrives", async () => {
        const { adapter, sent, respond } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            questions: {
                abcQuestion: { instruction: "Pick one." }
            }
        });

        const promise = hitl.emitAbcQuestion("Which?", [["a", "A"], ["b", "B"]]);
        respond(sent[0].id, { type: "abc-answer", option: "a", optionLabel: "A" });

        const result = await promise;
        expect(result).toEqual(["a", "A"]);
    });

    it("resolves open question when response arrives", async () => {
        const { adapter, sent, respond } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            questions: {
                openQuestion: { instruction: "Type an answer." }
            }
        });

        const promise = hitl.emitOpenQuestion("What is your name?");
        respond(sent[0].id, { type: "open-answer", answer: "Alice" });

        const result = await promise;
        expect(result).toBe("Alice");
    });

    it("emits acceptance-specific events with the question and answer", async () => {
        const { adapter, sent, respond } = createMockAdapter();
        const onAcceptanceStarted = vi.fn();
        const onAcceptanceReceived = vi.fn();
        const hitl = new HITL({ adapter });

        hitl.onEvent("hitl_acceptance_started", onAcceptanceStarted);
        hitl.onEvent("hitl_acceptance_received", onAcceptanceReceived);

        const promise = hitl.emitAcceptance("Approve this transfer?", "Transfer context");
        expect(onAcceptanceStarted).toHaveBeenCalledWith("Approve this transfer?");

        respond(sent[0].id, { type: "acceptance-answer", answer: "allow" });

        await expect(promise).resolves.toBe("allow");
        expect(onAcceptanceReceived).toHaveBeenCalledWith("Approve this transfer?", "allow");
    });

    it("public handleResponse resolves pending requests", async () => {
        const { adapter, sent } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            toolsUsage: { delete_account: true }
        });

        const promise = hitl.emitToolUsage({ toolInstance: deleteAccountTool, params: {} });
        hitl.handleResponse(sent[0].id, { type: "tool-approval", answer: "deny" });

        const result = await promise;
        expect(result).toEqual({ answer: "deny", reason: "user_answer" });
    });

    it("calls onBeforeSent and onSent listeners", async () => {
        const { adapter, sent, respond } = createMockAdapter();
        const onBeforeSent = vi.fn(async (id: number, request: HITLRequest) => {
            return { id: id + 1000, request };
        });
        const onSent = vi.fn();

        const hitl = new HITL({
            adapter,
            toolsUsage: { delete_account: true },
            listeners: {
                onBeforeSent,
                onSent
            }
        });

        const promise = hitl.emitToolUsage({ toolInstance: deleteAccountTool, params: {} });
        await Promise.resolve(); // let the async dispatch and listener run

        expect(onBeforeSent).toHaveBeenCalledTimes(1);
        expect(onBeforeSent).toHaveBeenCalledWith(1, {
            type: "tool-approval",
            toolName: "delete_account",
            toolInstance: deleteAccountTool,
            params: {}
        });

        expect(sent[0].id).toBe(1001);
        expect(onSent).toHaveBeenCalledWith(1001, {
            type: "tool-approval",
            toolName: "delete_account",
            toolInstance: deleteAccountTool,
            params: {}
        });

        respond(1001, { type: "tool-approval", answer: "allow" });
        await promise;
    });

    it("calls onResponse listener when a response is handled", async () => {
        const { adapter, sent, respond } = createMockAdapter();
        const onResponse = vi.fn();

        const hitl = new HITL({
            adapter,
            toolsUsage: { delete_account: true },
            listeners: {
                onResponse
            }
        });

        const promise = hitl.emitToolUsage({ toolInstance: deleteAccountTool, params: {} });
        const response: HITLResponse = { type: "tool-approval", answer: "allow" };
        respond(sent[0].id, response);

        await promise;
        expect(onResponse).toHaveBeenCalledWith(sent[0].id, response);
    });

    it("notifies multiple event listeners and onAnyEvent listeners", () => {
        const { adapter } = createMockAdapter();
        const hitl = new HITL({ adapter });
        const firstListener = vi.fn();
        const secondListener = vi.fn();
        const duplicateListener = vi.fn();
        const anyListener = vi.fn();
        const eventBody = () => undefined;

        hitl.onEvent("hitl_start", firstListener);
        hitl.onEvent("hitl_start", secondListener);
        hitl.onEvent("hitl_start", duplicateListener);
        hitl.onEvent("hitl_start", duplicateListener);
        hitl.onAnyEvent(anyListener);
        hitl.emitEvent("hitl_start", eventBody);

        expect(firstListener).toHaveBeenCalledWith(eventBody);
        expect(secondListener).toHaveBeenCalledWith(eventBody);
        expect(duplicateListener).toHaveBeenCalledTimes(2);
        expect(anyListener).toHaveBeenCalledWith("hitl_start", eventBody);
    });

    it("notifies listeners for the default HITL lifecycle events", async () => {
        const { adapter, sent, respond } = createMockAdapter();
        const hitl = new HITL({
            adapter,
            toolsUsage: { delete_account: true }
        });
        const firstStartListener = vi.fn();
        const secondStartListener = vi.fn();
        const requestListener = vi.fn();
        const responseListener = vi.fn();
        const endListener = vi.fn();
        const anyListener = vi.fn();

        hitl.onEvent("hitl_start", firstStartListener);
        hitl.onEvent("hitl_start", secondStartListener);
        hitl.onEvent("hitl_request_sent", requestListener);
        hitl.onEvent("hitl_response_received", responseListener);
        hitl.onEvent("hitl_end", endListener);
        hitl.onAnyEvent(anyListener);

        const approval = hitl.emitToolUsage({ toolInstance: deleteAccountTool, params: {} });
        expect(firstStartListener).toHaveBeenCalledTimes(1);
        expect(secondStartListener).toHaveBeenCalledTimes(1);
        expect(requestListener).toHaveBeenCalledTimes(1);
        expect(anyListener).toHaveBeenCalledWith("hitl_start");
        expect(anyListener).toHaveBeenCalledWith("hitl_request_sent", sent[0].id, sent[0].request);

        const response: HITLResponse = { type: "tool-approval", answer: "allow" };
        respond(sent[0].id, response);
        await approval;

        expect(responseListener).toHaveBeenCalledTimes(1);
        expect(endListener).toHaveBeenCalledTimes(1);
        expect(anyListener).toHaveBeenCalledWith("hitl_response_received", sent[0].id, response);
        expect(anyListener).toHaveBeenCalledWith("hitl_end");
    });
});
