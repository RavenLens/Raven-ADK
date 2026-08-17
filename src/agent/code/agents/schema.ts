import { CodeActState } from "./shared";

export interface CodeActSchema<InvokeOptions extends Record<string, any>, InvokeReturnType> {
    config: any;
    state: CodeActState | null;
    rollback(state: CodeActState): Promise<boolean>;
    invoke(options: InvokeOptions): InvokeReturnType;
}
