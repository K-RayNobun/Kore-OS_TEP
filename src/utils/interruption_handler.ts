import * as dbHelper from "./database_helper.js";
import { IpcPipe } from "./ipc_pipe.js";

export interface ToolInterruptionContract {
  graceful_timeout_ms: number;
  cleanup_fn?: (pids: number[], tempPaths: string[]) => Promise<void>;
  validate_after_resume?: (state: Record<string, unknown>) => boolean;
}

export class InterruptionHandler {
  private readonly ipc: IpcPipe;
  private readonly budgetPool: any;
  private readonly toolContracts = new Map<string, ToolInterruptionContract>();
  private activeProcesses = new Map<string, { pid: number; toolName: string; tempPaths: string[] }>();

  constructor(ipc: IpcPipe, budgetPool: any) {
    this.ipc = ipc;
    this.budgetPool = budgetPool;
  }

  public registerToolContract(toolName: string, contract: ToolInterruptionContract): void {
    this.toolContracts.set(toolName, contract);
    console.error("[INTERRUPTION_HANDLER] Registered contract", { toolName, timeout: contract.graceful_timeout_ms });
  }

  public trackProcess(missionId: string, pid: number, toolName: string, tempPaths: string[] = []): void {
    this.activeProcesses.set(missionId, { pid, toolName, tempPaths });
  }

  public untrackProcess(missionId: string): void {
    this.activeProcesses.delete(missionId);
  }

  public async interruptMission(missionId: string, reason: string): Promise<void> {
    const proc = this.activeProcesses.get(missionId);
    const taskId = this.getCurrentTaskId(missionId);

    const logParams: {
      missionId: string;
      reason: string;
      taskId?: number;
      toolPid?: number;
      toolOutputThusFar?: string;
    } = {
      missionId,
      reason,
    };
    if (taskId !== undefined) logParams.taskId = taskId;
    if (proc?.pid !== undefined) logParams.toolPid = proc.pid;
    dbHelper.insertInterruptionLog(logParams);

    if (proc) {
      const contract = this.toolContracts.get(proc.toolName);
      await this.executeInterruption(missionId, proc, contract, reason);
      this.activeProcesses.delete(missionId);
    }

    dbHelper.createMissionCheckpoint({
      missionId,
      taskId: taskId ?? 0,
      loopIteration: 0,
      agentStateJson: JSON.stringify({ interrupted: true, reason }),
      taskStateJson: JSON.stringify({ interrupted: true, reason }),
      interruptionReason: reason
    });

    dbHelper.updateMissionQueueStatus(missionId, "PAUSED", { preemptedBy: reason });

    this.ipc?.sendTo?.({ type: "state_change", payload: { state: "INTERRUPTED", mission_id: missionId, detail: reason } }, missionId);
    console.error("[INTERRUPTION_HANDLER] Mission interrupted", { missionId, reason });
  }

  private async executeInterruption(missionId: string, proc: { pid: number; toolName: string; tempPaths: string[] }, contract: ToolInterruptionContract | undefined, reason: string): Promise<void> {
    try {
      process.kill(proc.pid, "SIGTERM");
      const timeoutMs = contract?.graceful_timeout_ms ?? 5000;
      await this.waitForExit(proc.pid, timeoutMs);
      console.error("[INTERRUPTION_HANDLER] Process exited gracefully", { missionId, pid: proc.pid });
    } catch {
      try {
        process.kill(-proc.pid, "SIGKILL");
        console.error("[INTERRUPTION_HANDLER] Process killed forcefully", { missionId, pid: proc.pid });
      } catch {
        console.error("[INTERRUPTION_HANDLER] Process already gone", { missionId, pid: proc.pid });
      }
    }

    if (contract?.cleanup_fn) {
      try {
        await contract.cleanup_fn([proc.pid], proc.tempPaths);
        console.error("[INTERRUPTION_HANDLER] Cleanup completed", { missionId, toolName: proc.toolName });
      } catch (cleanupError) {
        console.error("[INTERRUPTION_HANDLER] Cleanup failed", { missionId, error: cleanupError });
      }
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        process.kill(pid, 0);
        await new Promise(r => setTimeout(r, 200));
      } catch {
        return;
      }
    }
  }

  public handleHumanDirective(taskId: number, approved: boolean, sessionId: string | undefined): void {
    const missionId = sessionId || "unknown";
    if (approved) {
      dbHelper.updateMissionQueueStatus(missionId, "RUNNING");
      this.ipc?.sendTo?.({ type: "state_change", payload: { state: "RUNNING", mission_id: missionId, task_id: taskId } }, missionId);
    } else {
      this.interruptMission(missionId, "human_rejected").catch(() => {});
    }
  }

  private getCurrentTaskId(missionId: string): number | undefined {
    const entry = dbHelper.getMissionQueueEntry(missionId);
    return entry?.task_id;
  }
}
