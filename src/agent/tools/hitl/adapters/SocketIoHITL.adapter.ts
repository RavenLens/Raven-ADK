import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { HITLAdapter, HITLRequest, HITLResponse, HITLResponseHandler } from "../hitl";

const DEFAULT_SOCKETIO_PORT = 3000;

export interface HITLSocketIoAdapterConfig {
    /**
     * Port the socket.io server listens on. Defaults to 3000.
     */
    port?: number;
    /**
     * Server-level socket.io middleware functions, e.g. for authentication.
     */
    socketServerMiddleware?: Parameters<Server["use"]>[0][];
    /**
     * Per-socket middleware functions applied after a client connects.
     */
    socketConnectionMiddleware?: Parameters<Socket["use"]>[0][];
}

/**
 * Socket.io adapter for the singular `HITL` class.
 *
 * It owns only the communication layer: it starts a socket.io server, forwards
 * HITL requests to the connected client, and routes responses back to `HITL`.
 */
export class HITLSocketIoAdapter implements HITLAdapter {
    private socket: Socket | undefined = undefined;
    private responseHandler: HITLResponseHandler | undefined = undefined;
    private config: HITLSocketIoAdapterConfig;

    constructor(config: HITLSocketIoAdapterConfig = {}) {
        this.config = config;
        this.runServer();
    }

    private runServer() {
        const httpServer = createServer();
        const io = new Server(httpServer);

        if (this.config.socketServerMiddleware) {
            this.config.socketServerMiddleware.forEach(middleware => {
                io.use(middleware);
            });
        }

        io.on("connection", (socket: Socket) => {
            if (this.config.socketConnectionMiddleware) {
                this.config.socketConnectionMiddleware.forEach(middleware => {
                    socket.use(middleware);
                });
            }

            this.socket = socket;

            socket.on("hitl:response", ({ id, response }: { id: string | number; response: HITLResponse }) => {
                this.responseHandler?.(id, response);
            });
        });

        httpServer.listen(this.config.port || DEFAULT_SOCKETIO_PORT);
    }

    onResponse(handler: HITLResponseHandler) {
        this.responseHandler = handler;
    }

    send(correlationId: string | number, request: HITLRequest) {
        if (!this.socket) {
            throw new Error("Cannot send HITL request because socket.io connection isn't defined");
        }

        this.socket.emit("hitl:request", { id: correlationId, request });
    }
}
