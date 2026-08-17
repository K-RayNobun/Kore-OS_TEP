import * as dbHelper from "./database_helper.js";
import { IpcPipe } from "./ipc_pipe.js";
import type { IpcFrame } from "./ipc_pipe.js";
import type { BudgetPool } from "./budget_pool.js";

export class SchedulerDaemon {
  private readonly ipc: IpcPipe;
  private readonly priorityQueue: any;
  private readonly budgetPool: BudgetPool;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(ipc: IpcPipe, priorityQueue: any, budgetPool: BudgetPool) {
    this.ipc = ipc;
    this.priorityQueue = priorityQueue;
    this.budgetPool = budgetPool;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), 30000);
    console.error("[SCHEDULER] Daemon started, polling every 30s");
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public notifyNewMission(): void {
    if (!this.running) this.tick();
  }

  private tick(): void {
    try {
      const schedules = dbHelper.getEnabledTaskSchedules();
      for (const sched of schedules) {
        this.processSchedule(sched);
      }
    } catch (error) {
      console.error("[SCHEDULER] Tick failed:", error);
    }
  }

  private processSchedule(sched: any): void {
    const now = new Date().toISOString();
    if (sched.next_trigger_at > now) return;

    const budgetTokens = sched.budget_allocated_tokens ?? 10000;

    if (this.budgetPool.exhausted(budgetTokens)) {
      console.error("[SCHEDULER] Skipping schedule (budget exhausted)", { id: sched.id, name: sched.name, needed: budgetTokens });
      const nextTrigger = this.computeNextTrigger(sched);
      dbHelper.updateTaskSchedule(sched.id, {
        nextTriggerAt: nextTrigger,
        lastStatus: "SKIPPED",
        lastRunAt: now
      });
      return;
    }

    console.error("[SCHEDULER] Triggering schedule", { id: sched.id, name: sched.name });

    const missionId = sched.mission_id ? `${sched.mission_id}-sched-${sched.id}-${Date.now()}` : `scheduled-${sched.id}-${Date.now()}`;
    const priority = sched.priority_override ?? 0;

    const frame: IpcFrame = {
      type: "prompt_submit",
      session_id: missionId,
      payload: {
        mission_id: missionId,
        prompt: `[SCHEDULED] ${sched.name}`,
        priority,
        budget_tokens: budgetTokens
      },
      timestamp: now
    };

    this.ipc.sendTo(frame, missionId);

    const nextTrigger = this.computeNextTrigger(sched);
    dbHelper.updateTaskSchedule(sched.id, {
      nextTriggerAt: nextTrigger,
      lastStatus: "QUEUED",
      lastRunAt: now
    });

    console.error("[SCHEDULER] Schedule queued", { id: sched.id, nextTrigger });
  }

  private computeNextTrigger(sched: any): string {
    const now = new Date();
    if (sched.interval_minutes) {
      const next = new Date(now.getTime() + sched.interval_minutes * 60 * 1000);
      return next.toISOString();
    }
    if (sched.cron_expr) {
      try {
        const { CronParser } = require("cron-parser");
        const interval = CronParser.parse(sched.cron_expr, { currentDate: now });
        return interval.next().toISOString();
      } catch {
        const fallback = new Date(now.getTime() + 60 * 60 * 1000);
        return fallback.toISOString();
      }
    }
    const fallback = new Date(now.getTime() + 60 * 60 * 1000);
    return fallback.toISOString();
  }
}
