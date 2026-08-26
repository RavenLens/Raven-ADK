import { HITLAdapter, HITLRequest, HITLResponse, HITLResponseHandler } from "../hitl-strategies/DefaultHITL";

/**
 * Convenience adapter for local/desktop integrations.
 *
 * You provide a `send` function that forwards the HITL request into your own
 * IPC channel (Electron `ipcRenderer`, Tauri events, stdio, etc.). When the
 * UI answers, call `adapter.respond(correlationId, response)` and the adapter
 * routes the answer back to the `HITL` class.
 *
 * This is just a helper; you can also implement `HITLAdapter` directly.
 */
export class HITLLocalAdapter implements HITLAdapter {
    private handler?: HITLResponseHandler;
    private sendFn: (correlationId: string | number, request: HITLRequest) => void;

    constructor(sendFn: (correlationId: string | number, request: HITLRequest) => void) {
        this.sendFn = sendFn;
    }

    /**
     * Use this function to override the default handler from `HITL` that is `handleResponse`
     * 
     * **Denote**: Universally it's not recomended especially if you don't know how the RavenADK HITL logic works
     * 
     * Instead:
     * - To handle the listening and/or modify the ongoing client request use the `HITL.config.listeners`
     * - 
     * 
     * @param handler - custom handler
     */
    onResponse(handler: HITLResponseHandler) {
        this.handler = handler;
    }

    send(correlationId: string | number, request: HITLRequest) {
        this.sendFn(correlationId, request);
    }

    /**
     * Call this when the local UI/client sends back a response.
     */
    respond(correlationId: string | number, response: HITLResponse) {
        this.handler?.(correlationId, response);
    }
}
