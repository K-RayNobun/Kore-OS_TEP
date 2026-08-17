import * as dbHelper from "./database_helper.js";
import { BudgetPool } from "./budget_pool.js";

export class PriorityQueue {
  constructor(private readonly budgetPool: BudgetPool, private readonly ipc: any) {}

  public enqueue(missionId: string, priority: number): void {
    dbHelper.createMissionQueueEntry({ missionId, priority, budgetAllocatedTokens: 50000 });
    console.error("[PRIORITY_QUEUE] Enqueued", { missionId, priority });
  }

  public dequeue(missionId: string): void {
    dbHelper.updateMissionQueueStatus(missionId, "COMPLETED", { completedAt: new Date().toISOString() });
    console.error("[PRIORITY_QUEUE] Dequeued", { missionId });
  }

  public pauseMission(missionId: string, sessionId: string | undefined): void {
    dbHelper.updateMissionQueueStatus(missionId, "PAUSED");
    this.ipc?.sendTo?.({ type: "state_change", payload: { state: "PAUSED", mission_id: missionId } }, sessionId || missionId);
    console.error("[PRIORITY_QUEUE] Paused", { missionId });
  }

  public resumeMission(missionId: string, sessionId: string | undefined): void {
    const entry = dbHelper.getMissionQueueEntry(missionId);
    if (!entry) return;
    if (entry.status === "PAUSED") {
      dbHelper.updateMissionQueueStatus(missionId, "QUEUED");
      this.ipc?.sendTo?.({ type: "state_change", payload: { state: "QUEUED", mission_id: missionId } }, sessionId || missionId);
      console.error("[PRIORITY_QUEUE] Resumed", { missionId });
    }
  }

  public async runMission(missionId: string, agentLoop: any, prompt: string, resumeFromCheckpoint = false): Promise<{ completed: boolean }> {
    const startedAt = new Date().toISOString();
    dbHelper.updateMissionQueueStatus(missionId, "RUNNING", { startedAt });

    if (resumeFromCheckpoint) {
      const checkpoint = dbHelper.getLatestCheckpoint(missionId);
      if (checkpoint) {
        console.error("[PRIORITY_QUEUE] Resuming from checkpoint", { missionId, iteration: checkpoint.loop_iteration });
        try {
          const result = await agentLoop.executeMission(prompt, missionId);
          return result;
        } catch (error) {
          console.error("[PRIORITY_QUEUE] Resume failed, starting fresh", { missionId, error });
        }
      }
    }

    return agentLoop.executeMission(prompt, missionId);
  }

  public selectNextMission(): any | undefined {
    const queued = dbHelper.getNextQueuedMission();
    if (!queued) return undefined;

    const remaining = this.budgetPool.remaining();
    if (remaining <= 0) {
      console.error("[PRIORITY_QUEUE] Budget exhausted, cannot start new mission");
      return undefined;
    }

    if (queued.budget_allocated_tokens > remaining) {
      console.error("[PRIORITY_QUEUE] Insufficient budget for highest-priority mission", { missionId: queued.mission_id, needed: queued.budget_allocated_tokens, remaining });
      return undefined;
    }

    return queued;
  }

  public checkPreemption(): { preempted: boolean; missionId?: string } {
    const running = dbHelper.getRunningMissions();
    if (running.length === 0) return { preempted: false };

    const queued = dbHelper.getNextQueuedMission();
    if (!queued) return { preempted: false };

    const lowestPriority = running[running.length - 1];
    if (queued.priority > lowestPriority.priority) {
      console.error("[PRIORITY_QUEUE] Preempting lower-priority mission", { preempted: lowestPriority.mission_id, incoming: queued.mission_id });
      return { preempted: true, missionId: lowestPriority.mission_id };
    }

    return { preempted: false };
  }
}
