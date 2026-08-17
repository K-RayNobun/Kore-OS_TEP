import * as net from "node:net";
import * as fs from "node:fs";

export type IpcFrame = Record<string, unknown>;
export type Broadcaster = (frame: IpcFrame) => void;
export const IPC_SOCKET_PATH = "/tmp/kore-os.sock";

function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

export class IpcPipe {
  private server: net.Server | null = null;
  private readonly clients = new Set<net.Socket>();
  private frameHandler: Broadcaster | null = null;

  public start(): void {
    try {
      fs.unlinkSync(IPC_SOCKET_PATH);
    } catch {}

    this.server = net.createServer((socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("error", () => this.clients.delete(socket));

      socket.on("data", (data) => {
        const lines = data.toString().split("\n").filter((l) => l.trim());
        for (const line of lines) {
          let frame: IpcFrame;
          try {
            frame = JSON.parse(line) as IpcFrame;
          } catch {
            this.sendTo({ type: "nak", correlation_id: generateCorrelationId(), payload: { reason: "invalid_json" } }, null);
            continue;
          }
          if ((frame as any).type !== "ack" && (frame as any).type !== "nak") {
            this.sendTo({ type: "ack", correlation_id: (frame as any).correlation_id ?? generateCorrelationId() }, (frame as any).session_id);
          }
          this.frameHandler?.(frame);
        }
      });
    });

    this.server.listen(IPC_SOCKET_PATH, () => {
      console.error(`[IPC_PIPE] Server listening on ${IPC_SOCKET_PATH}`);
    });
  }

  public onIncoming(handler: Broadcaster): void {
    this.frameHandler = handler;
  }

  public send(frame: IpcFrame): void {
    this.sendTo(frame, null);
  }

  public sendTo(frame: IpcFrame, sessionId: string | null): void {
    const correlationId = (frame as any).correlation_id || generateCorrelationId();
    const payload = JSON.stringify({ ...frame, session_id: sessionId, correlation_id: correlationId }) + "\n";
    const deadClients: net.Socket[] = [];
    for (const client of Array.from(this.clients)) {
      try {
        client.write(payload);
      } catch {
        deadClients.push(client);
      }
    }
    for (const client of deadClients) {
      this.clients.delete(client);
      client.destroy();
    }
  }

  public ack(correlationId: string, sessionId: string | null): void {
    this.sendTo({ type: "ack", correlation_id: correlationId }, sessionId);
  }

  public nak(correlationId: string, reason: string, sessionId: string | null): void {
    this.sendTo({ type: "nak", correlation_id: correlationId, payload: { reason } }, sessionId);
  }

  public stop(): void {
    for (const client of Array.from(this.clients)) {
      client.destroy();
    }
    this.clients.clear();
    this.server?.close();
    this.server = null;
  }
}

export const ipcPipe = new IpcPipe();
