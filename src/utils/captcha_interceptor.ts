import { ipcPipe, type IpcFrame } from "./ipc_pipe.js";

export interface ActiveCaptcha {
  id: string;
  taskId: number;
  url: string;
  startedAt: number;
}

export class CaptchaInterceptor {
  private active: ActiveCaptcha | null = null;
  private readonly ttlMs = 60 * 60 * 1000;

  constructor() {
    ipcPipe.onIncoming((frame: IpcFrame) => {
      this.ingest(frame);
    });
  }

  public ingest(frame: IpcFrame): void {
    if (frame.type === "intercept_start") {
      const payload = frame.payload as { task_id?: number };
      const taskId = Number(payload?.task_id ?? 0);
      if (!Number.isFinite(taskId) || taskId <= 0) return;
      this.active = {
        id: String(taskId),
        taskId,
        url: `/interactive?taskId=${taskId}`,
        startedAt: Date.now()
      };
    } else if (frame.type === "intercept_end") {
      this.active = null;
    }
  }

  public getActive(): ActiveCaptcha | null {
    if (!this.active) return null;
    if (Date.now() - this.active.startedAt > this.ttlMs) {
      this.active = null;
      return null;
    }
    return this.active;
  }
}

export const captchaInterceptor = new CaptchaInterceptor();
