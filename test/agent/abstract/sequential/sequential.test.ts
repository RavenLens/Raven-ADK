import { describe, it, expect, vi } from "vitest";
import { SequentialRunner } from "../../../../src/agent/abstract/sequential";

describe("SequentialRunner", () => {
    it("should run all runners in sequence", async () => {
        const runner1 = vi.fn().mockResolvedValue({ success: true, state: "state1" });
        const runner2 = vi.fn().mockResolvedValue({ success: true, state: "state2" });
        
        const runner = new SequentialRunner([
            ["id1", runner1],
            ["id2", runner2]
        ]);
        
        await runner.invoke();
        
        expect(runner1).toHaveBeenCalled();
        expect(runner2).toHaveBeenCalled();
    });

    it("should retry on failure if rollback is configured", async () => {
        let calls = 0;
        const runnerFailOnce = async () => {
            calls++;
            if (calls === 1) return { success: false, args: {}, state: "failed" };
            return { success: true, state: "success" };
        };

        const runner = new SequentialRunner(
            [["fail", runnerFailOnce]],
            { error: 0, failure: 1 }
        );

        const rollbackSpy = vi.fn();
        runner.onEvent("rollback", rollbackSpy);

        await runner.invoke();

        expect(calls).toBe(2);
        expect(rollbackSpy).toHaveBeenCalledWith("fail", "failure", 1);
    });

    it("should retry on error if rollback is configured", async () => {
        let calls = 0;
        const runnerErrorOnce = async () => {
            calls++;
            if (calls === 1) throw new Error("Oops");
            return { success: true, state: "success" };
        };

        const runner = new SequentialRunner(
            [["error", runnerErrorOnce]],
            { error: 1, failure: 0 }
        );

        const rollbackSpy = vi.fn();
        runner.onEvent("rollback", rollbackSpy);

        await runner.invoke();

        expect(calls).toBe(2);
        expect(rollbackSpy).toHaveBeenCalledWith("error", "error", 1);
    });
});
