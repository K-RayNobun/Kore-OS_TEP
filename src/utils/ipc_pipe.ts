import * as net from "node:net";
import * as fs from "node:fs";

export type IpcFrame = Record<string, unknown>;
export type Broadcaster = (frame: IpcFrame) => void;
export const IPC_SOCKET_PATH = "/tmp/kore-os.sock";

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
          try {
            const frame = JSON.parse(line) as IpcFrame;
            this.frameHandler?.(frame);
          } catch {}
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
    if (!this.server) return;
    const payload = JSON.stringify(frame) + "\n";
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
