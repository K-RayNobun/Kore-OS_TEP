import * as os from "node:os";

export interface HeartbeatPayload {
  ts: number;
  cpu: number;
  ram: number;
  tokens: number;
  burnRate?: number;
  ceilActive?: boolean;
  budgetRemaining?: number;
}

export class Heartbeat {
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private cumulativeTokens = 0;

  constructor(
    private readonly ipc: any,
    private readonly stateMachine: any,
    private readonly intervalMs = 5000
  ) {}

  public start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public addTokens(count: number): void {
    this.cumulativeTokens += count;
  }

  private tick(): void {
    const cpus = os.cpus();
    const cpuTotal = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a: number, b: number) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total);
    }, 0);
    const cpu = cpus.length ? (cpuTotal / cpus.length) * 100 : 0;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const ramUsed = totalMem - freeMem;

    const elapsedSec = Math.max(1, (Date.now() - this.startedAt) / 1000);
    const burnRate = this.cumulativeTokens / elapsedSec;

    const payload: HeartbeatPayload = {
      ts: Date.now(),
      cpu: Math.round(cpu * 100) / 100,
      ram: ramUsed,
      tokens: this.cumulativeTokens,
      burnRate: Math.round(burnRate * 100) / 100
    };

    try {
      this.ipc.sendTo({ type: "telemetry_heartbeat", payload }, (this.stateMachine as any)?.missionId);
    } catch {
      // best-effort
    }
  }
}
