import { AgentModel, ReActAgent } from "../../ReAct.agent";
import { randomUUID } from "node:crypto";
import { AgenticEvaluator } from "../aeval";

type RunID = `run-id:${string}`;

export class MultipleAnswers {
    parallelRun: [RunID, (ReActAgent<any, any, any, any> | AgentModel | AgenticEvaluator)][];

    constructor(parallelRun: (ReActAgent<any, any, any, any> | AgentModel)[]) {
        this.parallelRun = parallelRun.map(rune => {
            return [
                `run-id:${randomUUID()}`,
                rune
            ];
        });
    }

    invoke() {

    }
}