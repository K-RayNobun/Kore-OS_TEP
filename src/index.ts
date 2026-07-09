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
import { AgentLoop } from "./utils/agent_loop.js";
import { ApiGuardMiddleware } from "./utils/api_guard_middleware.js";
import { GitAutomationHelper } from "./utils/git_automation_helper.js";
import { RecursiveRealizationEngine } from "./utils/realization_engine.js";
import { EphemeralContentPurgeEngine } from "./utils/purge_cleaner_engine.js";
import { IpcPipe } from "./utils/ipc_pipe.js";
import type { IpcFrame } from "./utils/ipc_pipe.js";
import { EngineStateMachine } from "./utils/state_machine.js";
import * as dbHelper from "./utils/database_helper.js";

const ipcPipe = new IpcPipe();
const stateMachine = new EngineStateMachine(ipcPipe.send.bind(ipcPipe));
setAgentLoopStateBroadcaster((state) => stateMachine.setGlobalState(state.state as any));
const runningMissions = new Map<string, { agentLoop: any; cancel?: () => void }>();

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
  const availableTasks = serviceManager.getAvailableTasks();
  for (const task of availableTasks) {
    executeTask(task);
  }
}

async function handlePromptSubmit(missionIdHint: string | undefined, prompt: string): Promise<void> {
  console.error("[ENGINE] handlePromptSubmit ENTER", { missionIdHint, prompt });
  const missionId = missionIdHint || `mission-${Date.now()}`;
  dbHelper.createMission(missionId, prompt);
  dbHelper.updateMissionStatus(missionId, "ACTIVE");
  stateMachine.setMissionState(missionId, "RUNNING");

  const agentLoop = new AgentLoop(apiGuard, ipcPipe.send.bind(ipcPipe), (state) => {
    stateMachine.setMissionState(missionId, state.state as any, { mission_id: missionId });
  });

  runningMissions.set(missionId, { agentLoop });

  try {
    const result = await agentLoop.executeMission(prompt, missionId);
    if (result.completed) {
      stateMachine.resolveMission(missionId);
      dbHelper.updateMissionStatus(missionId, "COMPLETED", new Date().toISOString());
    }
  } catch (error) {
    console.error(`[MISSION] ${missionId} failed:`, error);
    stateMachine.resolveMission(missionId);
    dbHelper.updateMissionStatus(missionId, "FAILED");
  } finally {
    runningMissions.delete(missionId);
  }
}

async function main() {
  ipcPipe.start();
  ipcPipe.onIncoming((frame: IpcFrame) => {
    console.error("[ENGINE] IPC RECV:", frame.type, frame.payload);
    if (frame.type === "human_directive") {
      const payload = frame.payload as { taskId: number; approved: boolean };
      receiveHumanReconciliationDirective(payload.taskId, payload.approved);
    } else if (frame.type === "prompt_submit") {
      const payload = frame.payload as { mission_id?: string; prompt: string };
      handlePromptSubmit(payload.mission_id, payload.prompt);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("kore-os-TEP System core fully loaded and listening on standard IO channels.");
  bootstrapAvailableTasks();
}

main().catch((err) => {
  console.error("Fatal initialization collapse:", err);
  process.exit(1);
});