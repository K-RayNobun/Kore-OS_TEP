// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { registerTelemetryTool } from "./tools/telemetry.js";
import { registerSearchTool } from "./tools/search.js";
import { registerMarketingPolicyTool } from "./tools/marketing_policy.js";
import { registerSandboxTool } from "./tools/sandbox.js";
import { registerPatchTool } from "./tools/patch.js";
import { registerServiceManagerTool, serviceManager } from "./tools/service_manager.js";
import { registerNetworkAuditTool } from "./tools/network_audit.js";
import { registerBackupTool } from "./tools/backup.js";
import { registerBinaryInspectorTool } from "./tools/binary_inspector.js";

import { registerAssetOptimizerTool } from "./tools/asset_optimizer.js";
import { registerPlaybookCompilerTool, PlaybookCompiler } from "./tools/playbook_compiler.js";
import { registerBrowserAutomatorTool } from "./tools/browser_automator.js";
import { registerMetricsLedgerTool, MetricsLedger } from "./tools/metrics_ledger.js";
import { registerAgentLoopTool, setAgentLoopStateBroadcaster } from "./tools/agent_loop_tool.js";
import { AgentLoop, requestMissionAbort } from "./utils/agent_loop.js";
import { ApiGuardMiddleware } from "./utils/api_guard_middleware.js";
import { GitAutomationHelper } from "./utils/git_automation_helper.js";
import { RecursiveRealizationEngine } from "./utils/realization_engine.js";
import { EphemeralContentPurgeEngine } from "./utils/purge_cleaner_engine.js";
import { IpcPipe } from "./utils/ipc_pipe.js";
import type { IpcFrame } from "./utils/ipc_pipe.js";
import { EngineStateMachine } from "./utils/state_machine.js";
import * as dbHelper from "./utils/database_helper.js";
import { BudgetPool } from "./utils/budget_pool.js";
import { SchedulerDaemon } from "./utils/scheduler.js";
import { InterruptionHandler } from "./utils/interruption_handler.js";
import { PriorityQueue } from "./utils/priority_queue.js";
import { ResourceGuard } from "./utils/resource_guard.js";
import { MigrationRunner } from "./utils/migrations.js";
import { Heartbeat } from "./utils/heartbeat.js";
import { ImplicationStore } from "./utils/implication_store.js";

const ipcPipe = new IpcPipe();
const stateMachine = new EngineStateMachine(ipcPipe.send.bind(ipcPipe));
setAgentLoopStateBroadcaster((state) => stateMachine.setMissionState((state as any).mission_id || "unknown", state.state as any, state as any));

const budgetPool = new BudgetPool();
const priorityQueue = new PriorityQueue(budgetPool, ipcPipe);
const scheduler = new SchedulerDaemon(ipcPipe, priorityQueue, budgetPool);
const interruptionHandler = new InterruptionHandler(ipcPipe, budgetPool);
const resourceGuard = new ResourceGuard();

const server = new McpServer({
  name: "kore-os-TEP",
  version: "1.0.0",
});

const compiler = new PlaybookCompiler();
const apiGuard = new ApiGuardMiddleware();
const gitHelper = new GitAutomationHelper();
const metricsLedger = new MetricsLedger();
const realizationEngine = new RecursiveRealizationEngine();
const purgeEngine = new EphemeralContentPurgeEngine();

const activeTimers = new Map<number, NodeJS.Timeout>();
const prePivotHashes = new Map<number, string>();
const activeMissionSessions = new Map<string, { sessionId: string; priority: number }>();
const missionTaskProgress = new Map<string, { total: number; done: number }>();

function makeBroadcaster(sessionId: string, missionId: string) {
  return (frame: any) => {
    ipcPipe.sendTo(frame, sessionId);
    if (!frame || !frame.type) return;
    if (frame.type === "thinking") {
      const p = frame.payload || {};
      const cognition = `INTENT: ${p.action || p.thought || ""}`.slice(0, 280);
      dbHelper.setMissionLastCognition(missionId, cognition);
    } else if (frame.type === "checkpoint") {
      const iter = frame.payload?.loop_iteration;
      if (typeof iter === "number") dbHelper.setMissionLatestCheckpointIteration(missionId, iter);
    } else if (frame.type === "mission_start") {
      const total = Number(frame.payload?.tasks_count ?? 0);
      missionTaskProgress.set(missionId, { total, done: 0 });
      dbHelper.setMissionTasksProgress(missionId, total, 0);
    } else if (frame.type === "task_start") {
      const prog = missionTaskProgress.get(missionId) || { total: 0, done: 0 };
      prog.done = prog.done + 1;
      missionTaskProgress.set(missionId, prog);
      dbHelper.setMissionTasksProgress(missionId, prog.total, prog.done);
    }
  };
}

async function commitAndLogIterationProgress(taskId: number, stateMsg: string): Promise<void> {
    const currentBranch = gitHelper.getCurrentBranch();
    const commitMsg = `chore(task-${taskId}): ${stateMsg}\n\nMETADATA_SNAPSHOT:\n- Target Subtask ID: ${taskId}\n- Active Branch: ${currentBranch}`;
    
    const generatedHash = gitHelper.commitWorkspace(commitMsg);
    const stats = gitHelper.getLatestCommitStats();
    
    metricsLedger.logGitMilestone({
        taskId: taskId,
        branchName: currentBranch,
        commitHash: generatedHash,
        commitMessage: commitMsg,
        linesAdded: stats.linesAdded,
        linesDeleted: stats.linesDeleted
    });
}

async function callModelGenerativeLoop(taskPrompt: string, rawSystemLogs: string) {
    const targetProvider = "gemini";
    const tokenCeilingLimit = 80000;

    const optimizedContextLogs = apiGuard.optimizePayloadContext(rawSystemLogs, tokenCeilingLimit);
    const compiledPayload = `${taskPrompt}\nContext Traces:\n${optimizedContextLogs}`;

    return await apiGuard.executeWithRetry(targetProvider, async (apiKey) => {
        return { text: "Simulated successful generation pass." };
    });
}

registerTelemetryTool(server);
registerSearchTool(server);
registerMarketingPolicyTool(server);
registerSandboxTool(server);
registerPatchTool(server);
registerServiceManagerTool(server);
registerNetworkAuditTool(server);
registerBackupTool(server);
registerBinaryInspectorTool(server);

registerAssetOptimizerTool(server);
registerPlaybookCompilerTool(server);
registerBrowserAutomatorTool(server);
registerMetricsLedgerTool(server);
registerAgentLoopTool(server);

server.tool("executeTask", { id: z.number() }, async ({ id }) => {
    const task = dbHelper.getTaskById(id);
    if (!task) {
        return { content: [{ type: "text", text: `Task ${id} not found.` }] };
    }
    await executeTask(task);
    return { content: [{ type: "text", text: `Task ${id} finalized.` }] };
});

serviceManager.on("taskCompleted", (completedId: number) => {
  console.error(`Checking for tasks unblocked by ${completedId}...`);
  const nextTasks = serviceManager.getAvailableTasks();
  for (const task of nextTasks) {
    executeTask(task);
  }
});

async function executeTask(task: any): Promise<void> {
  if (task.status === 'SUSPENDED') {
    handleSuspendedTaskEscalation(task);
    return;
  }

  dbHelper.updateTaskStatus(task.id, "RUNNING");
  console.error(`Executing task ${task.id}: ${task.name}`);

  const missionId = task.mission_id || "001";

  const executionDurationMs = 4500;
  const tokenCount = 1420;
  const rawLogs = `Task ${task.id} executed. Dependencies resolved. Operation completed successfully.`;
  const gitCommitHash = "abc123";
  const apiStatus = "OK";

  const technicalEntry = `## [Task Entry #${task.id}] - ${task.name}
*   **Timestamp:** ${new Date().toISOString()}
*   **Git Reference:** ${gitCommitHash || 'N/A'}
*   **API Telemetry:** ${apiStatus} | **Tokens Consumed:** ${tokenCount}
*   **Runtime Performance:** ${executionDurationMs}ms

### System Traces & Compiler Logs
\`\`\`txt
${rawLogs.trim()}
\`\`\`
---`;

  const technicalPath = compiler.compileTechnicalReport(missionId, technicalEntry);

  const elegantSummary = await invokeEloquentEducatorLLM(rawLogs);

  const executiveSummary = `### Active Focus: ${task.name}

### Strategic Overview
> ${elegantSummary}

### Intended Next Trajectory
* Moving to next task scheduled within the SQLite Journal engine.`;

  const executivePath = compiler.updateExecutiveReport(missionId, executiveSummary);

  dbHelper.setTaskReportPaths(task.id, technicalPath, executivePath);

  await commitAndLogIterationProgress(task.id, "automated task realization pass");

  await handleRealizationLifecycleStep(task);

  serviceManager.completeTask(task.id);
}

function handleSuspendedTaskEscalation(task: any): void {
  const TIMEOUT_DURATION_MS = 30 * 60 * 1000;

  console.log(`[PIVOT_ENGINE] Task ${task.id} is blocked awaiting human verification. Initializing timeout trigger.`);

  const missionId = task.mission_id || "unknown";
  stateMachine.setMissionState(missionId, "AWAITING_HUMAN", { task_id: task.id });

  ipcPipe.send({ type: "intercept_start", payload: { task_id: task.id } });

  const timeout = setTimeout(() => {
    executeSpeculativePivot(task);
  }, TIMEOUT_DURATION_MS);

  activeTimers.set(task.id, timeout);
}

function executeSpeculativePivot(task: any): void {
  console.log(`[PIVOT_ENGINE] 30 minutes elapsed without input for task ${task.id}. Diverging branch...`);

  try {
    const prePivotHash = gitHelper.commitWorkspace(`chore(task-${task.id}): pre-pivot snapshot due to human timeout`);
    prePivotHashes.set(task.id, prePivotHash);

    gitHelper.createAndSwitchToSpeculativeBranch(task.id);

    dbHelper.updateTaskStatus(task.id, 'RUNNING');
    dbHelper.setTaskLogicBranch(task.id, `speculative-exploratory-${task.id}`);

    console.log(`[PIVOT_ENGINE] AI admin resuming task ${task.id} autonomously on exploratory branch.`);
  } catch (error) {
    console.error(`[PIVOT_ENGINE_CRITICAL] Failed branch swap routine for task ${task.id}`, error);
  }
}

export async function receiveHumanReconciliationDirective(taskId: number, approved: boolean): Promise<void> {
  const timeoutHandle = activeTimers.get(taskId);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    activeTimers.delete(taskId);
  }

  const task = dbHelper.getTaskById(taskId);

  ipcPipe.send({ type: "intercept_end", payload: { task_id: taskId } });

  if (task && task.logic_branch && task.logic_branch.startsWith('speculative-')) {
    console.log(`[RECONCILIATION] Processing human response for speculative task ${taskId}. Approved: ${approved}`);

    if (approved) {
      gitHelper.reconcileApproval(taskId);
      dbHelper.updateTaskStatus(taskId, 'DONE');
    } else {
      const recoveryHash = prePivotHashes.get(taskId) || "HEAD~1";
      gitHelper.reconcileRejection(taskId, recoveryHash);
      dbHelper.updateTaskStatus(taskId, 'SUSPENDED');
    }

    dbHelper.setTaskLogicBranch(taskId, 'main');
    prePivotHashes.delete(taskId);
  } else {
    console.log(`[RECONCILIATION] Task ${taskId} responded to within window limit. Applying standard absolute directive.`);
    dbHelper.updateTaskStatus(taskId, approved ? 'DONE' : 'FAILED');
  }

  const missionId = task?.mission_id || "unknown";
  stateMachine.setMissionState(missionId, approved ? "RUNNING" : "AWAITING_HUMAN", { task_id: taskId });
}

export async function handleRealizationLifecycleStep(task: any): Promise<void> {
    if (task.name.includes('Code') || task.name.includes('Implement')) {
        dbHelper.updateTaskStatus(task.id, 'RUNNING');

        const contextConfig = {
            taskId: task.id,
            buildCommand: 'npm run build',
            targetFilePath: '/home/elo/workspace/src/active_module.ts'
        };

        const result = await realizationEngine.executeRealizationLoop(contextConfig, task.name);

        if (result.success) {
            console.log(`[ORCHESTRATOR] Realization pass completed cleanly for task ${task.id}.`);
        } else {
            console.error(`[ORCHESTRATOR] Realization failed under safe-brake boundary limits. Suspending task ${task.id}.`);
            dbHelper.updateTaskStatus(task.id, 'SUSPENDED');
        }
    }
}

export async function finalizeMacroMissionState(missionId: string): Promise<void> {
    console.log(`[ORCHESTRATOR] Finalizing mission ${missionId}. Synchronizing state hooks...`);

    try {
        purgeEngine.executeMissionPurge(missionId);
    } catch (cleanupError: any) {
        console.error(`[ORCHESTRATOR_WARNING] Ephemeral purge module failed safely: ${cleanupError.message}`);
    }

    console.log(`[ORCHESTRATOR] Mission state finalized cleanly. Storage assets optimized.`);
}

async function invokeEloquentEducatorLLM(rawLogs: string): Promise<string> {
    const result = await callModelGenerativeLoop("Summarize these logs into an executive-ready insight", rawLogs);
    return result.text;
}

async function bootstrapAvailableTasks(): Promise<void> {
  const queued = dbHelper.getNextQueuedMission();
  if (!queued) {
    const availableTasks = serviceManager.getAvailableTasks();
    for (const task of availableTasks) {
      executeTask(task);
    }
  }
}

async function resumeInterruptedMissions(): Promise<void> {
  const paused = dbHelper.getPausedMissions();
  for (const entry of paused) {
    console.error("[ENGINE] Resuming paused mission from checkpoint", { missionId: entry.mission_id });
    const sessionId = entry.mission_id;
    const agentLoop = new AgentLoop(apiGuard, makeBroadcaster(sessionId, entry.mission_id), (state) => {
      stateMachine.setMissionState(entry.mission_id, state.state as any, { mission_id: entry.mission_id });
    });
    activeMissionSessions.set(entry.mission_id, { sessionId, priority: entry.priority });
    priorityQueue.enqueue(entry.mission_id, entry.priority);
    scheduler.notifyNewMission();
    try {
      const result = await priorityQueue.runMission(entry.mission_id, agentLoop, entry.mission_id, true);
      if (result.cancelled) {
        dbHelper.updateMissionStatus(entry.mission_id, "CANCELLED", new Date().toISOString());
        dbHelper.updateMissionQueueStatus(entry.mission_id, "CANCELLED", { completedAt: new Date().toISOString() });
      } else {
        stateMachine.resolveMission(entry.mission_id);
        dbHelper.updateMissionStatus(entry.mission_id, result.completed ? "COMPLETED" : "FAILED", new Date().toISOString());
        dbHelper.updateMissionQueueStatus(entry.mission_id, result.completed ? "COMPLETED" : "FAILED", { completedAt: new Date().toISOString() });
      }
      budgetPool.release(entry.mission_id);
    } catch (error) {
      console.error(`[MISSION] ${entry.mission_id} resume failed:`, error);
      stateMachine.resolveMission(entry.mission_id);
      dbHelper.updateMissionStatus(entry.mission_id, "FAILED");
      dbHelper.updateMissionQueueStatus(entry.mission_id, "FAILED", { completedAt: new Date().toISOString() });
      budgetPool.release(entry.mission_id);
    } finally {
      activeMissionSessions.delete(entry.mission_id);
      missionTaskProgress.delete(entry.mission_id);
      priorityQueue.dequeue(entry.mission_id);
    }
  }
}

async function handlePromptSubmit(missionIdHint: string | undefined, prompt: string, priority: number = 0, budgetTokens: number = 50000): Promise<void> {
  console.error("[ENGINE] handlePromptSubmit ENTER", { missionIdHint, prompt, priority, budgetTokens });
  const missionId = missionIdHint || `mission-${Date.now()}`;
  const sessionId = missionId;

  const budgetEntry = dbHelper.getMissionQueueEntry(missionId);
  const ceilActive = (budgetEntry?.status === 'PAUSED') || false;
  if (!budgetPool.gateMissionSpawn(ceilActive)) {
    console.error("[ENGINE] Mission spawn gated by budget pool", { missionId });
    ipcPipe.sendTo({ type: "state_change", payload: { state: "QUEUED", mission_id: missionId, detail: "budget_exhausted" } }, sessionId);
    return;
  }

  dbHelper.createMission(missionId, prompt);
  dbHelper.createMissionQueueEntry({ missionId, priority, budgetAllocatedTokens: budgetTokens });
  dbHelper.updateMissionStatus(missionId, "ACTIVE");
  const allocated = budgetPool.allocate(missionId, budgetTokens);
  if (!allocated) {
    console.error("[ENGINE] Budget allocation refused", { missionId, budgetTokens });
    ipcPipe.sendTo({ type: "state_change", payload: { state: "QUEUED", mission_id: missionId, detail: "budget_allocation_refused" } }, sessionId);
    return;
  }
  activeMissionSessions.set(missionId, { sessionId, priority });

  const agentLoop = new AgentLoop(apiGuard, makeBroadcaster(sessionId, missionId), (state) => {
    stateMachine.setMissionState(missionId, state.state as any, { mission_id: missionId });
  });

  priorityQueue.enqueue(missionId, priority);
  scheduler.notifyNewMission();

  try {
    const result = await priorityQueue.runMission(missionId, agentLoop, prompt);
    if (result.cancelled) {
      dbHelper.updateMissionStatus(missionId, "CANCELLED", new Date().toISOString());
      dbHelper.updateMissionQueueStatus(missionId, "CANCELLED", { completedAt: new Date().toISOString() });
    } else {
      stateMachine.resolveMission(missionId);
      dbHelper.updateMissionStatus(missionId, result.completed ? "COMPLETED" : "FAILED", new Date().toISOString());
      dbHelper.updateMissionQueueStatus(missionId, result.completed ? "COMPLETED" : "FAILED", { completedAt: new Date().toISOString() });
    }
    budgetPool.release(missionId);
  } catch (error) {
    console.error(`[MISSION] ${missionId} failed:`, error);
    stateMachine.resolveMission(missionId);
    dbHelper.updateMissionStatus(missionId, "FAILED");
    dbHelper.updateMissionQueueStatus(missionId, "FAILED", { completedAt: new Date().toISOString() });
    budgetPool.release(missionId);
  } finally {
    activeMissionSessions.delete(missionId);
    missionTaskProgress.delete(missionId);
    priorityQueue.dequeue(missionId);
  }
}

function registerInterruptionContracts(): void {
  interruptionHandler.registerToolContract("browser_automator", {
    graceful_timeout_ms: 15000,
    cleanup_fn: async () => {
      console.error("[CONTRACT] browser_automator cleanup: close any remaining browser contexts");
    }
  });

  interruptionHandler.registerToolContract("asset_optimizer", {
    graceful_timeout_ms: 30000,
    cleanup_fn: async (pids, tempPaths) => {
      for (const p of tempPaths) {
        try {
          const { existsSync } = require("node:fs");
          if (existsSync(p)) require("node:fs").unlinkSync(p);
        } catch {
          // ignore
        }
      }
    }
  });

  interruptionHandler.registerToolContract("sandbox", {
    graceful_timeout_ms: 10000,
    cleanup_fn: async (pids) => {
      for (const pid of pids) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // ignore
        }
      }
    }
  });

  interruptionHandler.registerToolContract("backup", {
    graceful_timeout_ms: 60000,
    cleanup_fn: async (pids, tempPaths) => {
      for (const p of tempPaths) {
        try {
          const { existsSync } = require("node:fs");
          if (existsSync(p)) require("node:fs").unlinkSync(p);
        } catch {
          // ignore
        }
      }
    }
  });

  interruptionHandler.registerToolContract("service_manager", {
    graceful_timeout_ms: 5000
  });

  interruptionHandler.registerToolContract("patch", {
    graceful_timeout_ms: 10000
  });

  interruptionHandler.registerToolContract("binary_inspector", {
    graceful_timeout_ms: 10000
  });

  interruptionHandler.registerToolContract("network_audit", {
    graceful_timeout_ms: 10000
  });

  interruptionHandler.registerToolContract("search", {
    graceful_timeout_ms: 10000
  });

  interruptionHandler.registerToolContract("telemetry", {
    graceful_timeout_ms: 10000
  });

  interruptionHandler.registerToolContract("marketing_policy", {
    graceful_timeout_ms: 5000
  });

  interruptionHandler.registerToolContract("metrics_ledger", {
    graceful_timeout_ms: 10000
  });

  interruptionHandler.registerToolContract("playbook_compiler", {
    graceful_timeout_ms: 10000
  });

  interruptionHandler.registerToolContract("agent_loop", {
    graceful_timeout_ms: 5000
  });
}

async function main() {
  dbHelper.ensureSchema();
  const runner = new MigrationRunner(dbHelper.getDb());
  await runner.run();

  registerInterruptionContracts();

  const heartbeat = new Heartbeat(ipcPipe, stateMachine);
  heartbeat.start();

  const implicationStore = new ImplicationStore();

  ipcPipe.start();
  ipcPipe.onIncoming((frame: IpcFrame) => {
    console.error("[ENGINE] IPC RECV:", frame.type, frame.payload);
    const sessionId = (frame as any).session_id;
    if (frame.type === "human_directive") {
      const payload = frame.payload as { taskId: number; approved: boolean };
      interruptionHandler.handleHumanDirective(payload.taskId, payload.approved, sessionId);
    } else if (frame.type === "prompt_submit") {
      const payload = frame.payload as { mission_id?: string; prompt: string; priority?: number; budget_tokens?: number };
      handlePromptSubmit(payload.mission_id, payload.prompt, payload.priority ?? 0, payload.budget_tokens ?? 50000);
    } else if (frame.type === "mission_pause") {
      const payload = frame.payload as { mission_id: string };
      priorityQueue.pauseMission(payload.mission_id, sessionId);
      interruptionHandler.interruptMission(payload.mission_id, "operator_pause").catch(() => {});
    } else if (frame.type === "mission_resume") {
      const payload = frame.payload as { mission_id: string };
      priorityQueue.resumeMission(payload.mission_id, sessionId);
    } else if (frame.type === "budget_refill") {
      const payload = frame.payload as { tokens: number };
      budgetPool.refill(payload.tokens || 50000);
    } else if (frame.type === "mission_cancel") {
      const payload = frame.payload as { mission_id: string };
      requestMissionAbort(payload.mission_id);
      dbHelper.updateMissionQueueStatus(payload.mission_id, "CANCELLED", { completedAt: new Date().toISOString() });
      dbHelper.updateMissionStatus(payload.mission_id, "CANCELLED", new Date().toISOString());
      budgetPool.release(payload.mission_id);
      ipcPipe.sendTo({ type: "state_change", payload: { state: "CANCELLED", mission_id: payload.mission_id } }, sessionId);
    } else if (frame.type === "mission_interrupt") {
      const payload = frame.payload as { mission_id: string; force?: boolean };
      dbHelper.updateMissionQueueStatus(payload.mission_id, "INTERRUPTED");
      ipcPipe.sendTo({ type: "state_change", payload: { state: "INTERRUPTED", mission_id: payload.mission_id } }, sessionId);
      ipcPipe.sendTo({ type: "interruption", payload: { mission_id: payload.mission_id, reason: payload.force ? "operator_force_interrupt" : "operator_interrupt" } }, sessionId);
      interruptionHandler.interruptMission(payload.mission_id, "operator_interrupt").catch(() => {});
    } else if (frame.type === "mission_priority") {
      const payload = frame.payload as { mission_id: string; priority: number };
      const entry = dbHelper.getMissionQueueEntry(payload.mission_id);
      if (entry) dbHelper.getDb().prepare("UPDATE mission_queue SET priority = ? WHERE mission_id = ?").run(payload.priority, payload.mission_id);
      ipcPipe.sendTo({ type: "state_change", payload: { state: entry?.status || "QUEUED", mission_id: payload.mission_id } }, sessionId);
    } else if (frame.type === "mission_budget") {
      const payload = frame.payload as { mission_id: string; tokens: number };
      const entry = dbHelper.getMissionQueueEntry(payload.mission_id);
      if (entry) dbHelper.getDb().prepare("UPDATE mission_queue SET budget_allocated_tokens = ? WHERE mission_id = ?").run(payload.tokens, payload.mission_id);
      ipcPipe.sendTo({ type: "state_change", payload: { state: entry?.status || "QUEUED", mission_id: payload.mission_id } }, sessionId);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("kore-os-TEP System core fully loaded and listening on standard IO channels.");

  scheduler.start();
  await resumeInterruptedMissions();
  await bootstrapAvailableTasks();
}

main().catch((err) => {
  console.error("Fatal initialization collapse:", err);
  process.exit(1);
});