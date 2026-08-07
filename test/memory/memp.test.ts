import { describe, expect, it } from "vitest";
import { DeterministicMemorySchema } from "../../src/agent/memory/schema/deterministicMemorySchema";
import { MemP } from "../../src/agent/memory/systems/memp";

describe("MemP", () => {
    it("retrieves a procedure with both its trajectory and script", async () => {
        const memory = new MemP({
            name: "Deployment procedures",
            purpose: "Reuse verified deployment workflows.",
            scope: "production",
            topK: 2,
            idFactory: () => "rollback-canary"
        });
        const schema: DeterministicMemorySchema = memory;

        await memory.addProcedure({
            key: "Roll back a failed canary deployment",
            steps: [
                "Pause traffic shifting.",
                "Route traffic to the stable deployment.",
                "Verify error rates before closing the incident."
            ],
            script: "Stop exposure first, restore the known-good version, then verify health.",
            tags: ["deployment", "rollback"]
        });
        await memory.addProcedure({
            id: "rotate-secret",
            key: "Rotate an application secret",
            steps: ["Create the replacement secret.", "Deploy consumers with the replacement."],
            script: "Create a replacement before retiring the old credential."
        });

        const result = await memory.retrieve("Roll back the failed canary", { scope: "production" });

        expect(schema.typeMemory).toBe("deterministic");
        expect(result.procedures.map(procedure => procedure.procedure.id)).toEqual(["rollback-canary"]);
        expect(result.procedures[0].procedure.steps).toHaveLength(3);
        expect(result.procedures[0].procedure.script).toContain("known-good version");
    });

    it("updates and deprecates a procedure without returning it in later retrieval", async () => {
        const memory = new MemP({
            name: "Operations procedures",
            purpose: "Maintain current operational playbooks.",
            idFactory: () => "procedure-1"
        });

        await memory.applyUpdate({
            type: "add",
            procedure: {
                key: "Restart a worker",
                steps: ["Drain the worker.", "Restart it.", "Check its health endpoint."],
                script: "Drain before restart and verify recovery."
            }
        });
        const updated = await memory.applyUpdate({
            type: "update",
            procedureId: "procedure-1",
            patch: {
                steps: ["Drain the worker.", "Restart it with the current configuration.", "Check its health endpoint."]
            }
        });
        const deprecated = await memory.applyUpdate({
            type: "deprecate",
            procedureId: "procedure-1",
            reason: "Workers are now restarted by the orchestrator."
        });

        expect(updated.procedure?.revision).toBe(2);
        expect(deprecated.procedure).toMatchObject({
            status: "deprecated",
            revision: 3,
            deprecationReason: "Workers are now restarted by the orchestrator."
        });
        expect((await memory.retrieve("restart worker")).procedures).toEqual([]);
    });

    it("uses validation and deterministic hooks to build then retrieve a procedure", async () => {
        const memory = new MemP({
            name: "Validated procedures",
            purpose: "Consolidate successful operational work.",
            updatePolicy: "validation",
            outcomeEvaluator: async () => true,
            idFactory: () => "validated-procedure",
            updateBuilder: async () => ({
                type: "add",
                procedure: {
                    key: "Recover a failing queue consumer",
                    steps: ["Pause new messages.", "Resolve the consumer failure.", "Resume and observe lag."],
                    script: "Stabilize intake, repair the consumer, then verify backlog recovery."
                }
            })
        });
        const instruction = {
            contextAgentState: {
                messages: [{ type: "user" as const, content: "Recover the failing queue consumer" }]
            }
        };

        const updateOutcome = await memory.afterConversationEnd(instruction);
        const fetchOutcome = await memory.beforeOrchestratorAgentRun(instruction);

        expect(updateOutcome).toEqual([{
            updatedInformations: ["MemP added procedure \"validated-procedure\"."],
            attchToAgentAwareness: false
        }]);
        expect(fetchOutcome).toEqual([{
            memoryInformations: [expect.stringContaining("Stabilize intake")],
            attchToAgentAwareness: true
        }]);
    });
});