import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import { createHash } from "node:crypto";

const dbPath = process.env.KORE_DB_PATH || "/home/elo/data/tasks.db";
const dbDir = path.dirname(dbPath);
try {
    fs.mkdirSync(dbDir, { recursive: true });
} catch {}
const db = new Database(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA foreign_keys = ON;");

export function ensureSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      status TEXT DEFAULT 'PENDING',
      dependency_id INTEGER,
      priority INTEGER,
      logic_branch TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const columns = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const hasMissionId = columns.some((col) => col.name === "mission_id");
  if (!hasMissionId) {
    db.prepare("ALTER TABLE tasks ADD COLUMN mission_id TEXT;").run();
    db.prepare("ALTER TABLE tasks ADD COLUMN technical_report_path TEXT;").run();
    db.prepare("ALTER TABLE tasks ADD COLUMN executive_report_path TEXT;").run();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `);

  const missionsCols = db.prepare("PRAGMA table_info(missions)").all() as { name: string }[];
  if (!missionsCols.some((col) => col.name === "attributes")) {
    db.prepare("ALTER TABLE missions ADD COLUMN attributes TEXT;").run();
  }
  if (!missionsCols.some((col) => col.name === "latest_checkpoint_iteration")) {
    db.prepare("ALTER TABLE missions ADD COLUMN latest_checkpoint_iteration INTEGER;").run();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      task_id INTEGER,
      thought TEXT NOT NULL,
      action TEXT,
      parameters_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decision_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      output_json TEXT,
      execution_time_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      task_id INTEGER,
      phase TEXT,
      status TEXT,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      execution_time_ms INTEGER,
      token_delta INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const execLogsCols = db.prepare("PRAGMA table_info(execution_logs)").all() as { name: string }[];
  const hasTokenDelta = execLogsCols.some((col) => col.name === "token_delta");
  if (!hasTokenDelta) {
    db.prepare("ALTER TABLE execution_logs ADD COLUMN token_delta INTEGER;").run();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS human_interventions (
      id TEXT PRIMARY KEY,
      task_id INTEGER,
      type TEXT,
      status TEXT DEFAULT 'PENDING',
      payload TEXT,
      resolution TEXT,
      resolved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const hiCols = db.prepare("PRAGMA table_info(human_interventions)").all() as { name: string }[];
  const hasResolvedAt = hiCols.some((col) => col.name === "resolved_at");
  if (!hasResolvedAt) {
    db.prepare("ALTER TABLE human_interventions ADD COLUMN resolved_at DATETIME;").run();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_artifacts (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      task_id INTEGER,
      file_name TEXT,
      file_path TEXT,
      file_size INTEGER,
      mime_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      task_id INTEGER,
      loop_iteration INTEGER,
      agent_state_json TEXT NOT NULL,
      task_state_json TEXT NOT NULL,
      sandbox_state_json TEXT,
      token_snapshot_json TEXT,
      budget_snapshot_json TEXT,
      interruption_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL UNIQUE,
      priority INTEGER NOT NULL DEFAULT 0,
      budget_allocated_tokens INTEGER NOT NULL DEFAULT 50000,
      budget_consumed_tokens INTEGER DEFAULT 0,
      status TEXT DEFAULT 'QUEUED',
      preempted_by TEXT,
      queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME
    )
  `);

  const mqCols = db.prepare("PRAGMA table_info(mission_queue)").all() as { name: string }[];
  if (!mqCols.some((col) => col.name === "attributes")) {
    db.prepare("ALTER TABLE mission_queue ADD COLUMN attributes TEXT;").run();
  }
  if (!mqCols.some((col) => col.name === "latest_checkpoint_iteration")) {
    db.prepare("ALTER TABLE mission_queue ADD COLUMN latest_checkpoint_iteration INTEGER;").run();
  }
  if (!mqCols.some((col) => col.name === "tasks_total")) {
    db.prepare("ALTER TABLE mission_queue ADD COLUMN tasks_total INTEGER DEFAULT 0;").run();
  }
  if (!mqCols.some((col) => col.name === "tasks_done")) {
    db.prepare("ALTER TABLE mission_queue ADD COLUMN tasks_done INTEGER DEFAULT 0;").run();
  }
  if (!mqCols.some((col) => col.name === "last_cognition")) {
    db.prepare("ALTER TABLE mission_queue ADD COLUMN last_cognition TEXT;").run();
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT,
      name TEXT NOT NULL,
      cron_expr TEXT,
      interval_minutes INTEGER,
      next_trigger_at DATETIME NOT NULL,
      enabled INTEGER DEFAULT 1,
      priority_override INTEGER,
      budget_allocated_tokens INTEGER DEFAULT 10000,
      last_status TEXT,
      last_run_at DATETIME,
      max_concurrent_runs INTEGER DEFAULT 1,
      attributes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS interruption_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      task_id INTEGER,
      reason TEXT NOT NULL,
      tool_pid INTEGER,
      tool_output_thus_far TEXT,
      sandbox_cleanup_status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS execution_logs_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      task_id INTEGER,
      phase TEXT,
      status TEXT,
      input_json TEXT,
      output_json TEXT,
      error_message TEXT,
      execution_time_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS implication_hashes (
      hash TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      params_json TEXT NOT NULL,
      environment_json TEXT,
      result_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    )
  `);
}

export function createTask(name: string, dependencyId: number | null = null, priority: number = 0, logicBranch?: string): number {
  const stmt = db.prepare(
    "INSERT INTO tasks (name, dependency_id, priority, logic_branch) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(name, dependencyId, priority, logicBranch ?? null);
  return Number(result.lastInsertRowid);
}

export function updateTaskStatus(taskId: number, status: string): void {
  db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, taskId);
}

export function getAvailableTasks(): any[] {
  return db.prepare(
    `SELECT * FROM tasks WHERE status = 'PENDING' AND (dependency_id IS NULL OR dependency_id IN (SELECT id FROM tasks WHERE status = 'DONE'))`
  ).all();
}

export function getTaskById(taskId: number): any | undefined {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

export function setTaskReportPaths(taskId: number, technicalPath: string, executivePath: string): void {
  db.prepare("UPDATE tasks SET technical_report_path = ?, executive_report_path = ? WHERE id = ?")
    .run(technicalPath, executivePath, taskId);
}

export function setTaskLogicBranch(taskId: number, logicBranch: string): void {
  db.prepare("UPDATE tasks SET logic_branch = ? WHERE id = ?").run(logicBranch, taskId);
}

export function createMission(id: string, prompt: string, attributes?: string): void {
  db.prepare("INSERT OR IGNORE INTO missions (id, prompt, attributes) VALUES (?, ?, ?)").run(id, prompt, attributes ?? null);
}

export function updateMissionAttributes(missionId: string, attributes: string): void {
  db.prepare("UPDATE missions SET attributes = ? WHERE id = ?").run(attributes, missionId);
}

export function setMissionLatestCheckpointIteration(missionId: string, iteration: number): void {
  db.prepare("UPDATE missions SET latest_checkpoint_iteration = ? WHERE id = ?").run(iteration, missionId);
  const entry = getMissionQueueEntry(missionId);
  if (entry) {
    db.prepare("UPDATE mission_queue SET latest_checkpoint_iteration = ? WHERE mission_id = ?").run(iteration, missionId);
  }
}

export function setMissionTasksProgress(missionId: string, tasksTotal: number, tasksDone: number): void {
  const entry = getMissionQueueEntry(missionId);
  if (!entry) return;
  db.prepare("UPDATE mission_queue SET tasks_total = ?, tasks_done = ? WHERE mission_id = ?").run(tasksTotal, tasksDone, missionId);
}

export function setMissionLastCognition(missionId: string, lastCognition: string): void {
  const entry = getMissionQueueEntry(missionId);
  if (!entry) return;
  db.prepare("UPDATE mission_queue SET last_cognition = ? WHERE mission_id = ?").run(lastCognition, missionId);
}

export function getMission(id: string): any | undefined {
  return db.prepare("SELECT * FROM missions WHERE id = ?").get(id);
}

export function updateMissionStatus(id: string, status: string, completedAt?: string): void {
  if (completedAt) {
    db.prepare("UPDATE missions SET status = ?, completed_at = ? WHERE id = ?").run(status, completedAt, id);
  } else {
    db.prepare("UPDATE missions SET status = ? WHERE id = ?").run(status, id);
  }
}

export function insertDecision(missionId: string, taskId: number | undefined, thought: string, action: string | undefined, parametersJson: string | undefined): number {
  const stmt = db.prepare(
    "INSERT INTO decisions (mission_id, task_id, thought, action, parameters_json) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(missionId, taskId ?? null, thought, action ?? null, parametersJson ?? null);
  return Number(result.lastInsertRowid);
}

export function insertObservation(decisionId: number, status: string, outputJson: string | undefined, executionTimeMs: number | undefined): number {
  const stmt = db.prepare(
    "INSERT INTO observations (decision_id, status, output_json, execution_time_ms) VALUES (?, ?, ?, ?)"
  );
  const result = stmt.run(decisionId, status, outputJson ?? null, executionTimeMs ?? null);
  return Number(result.lastInsertRowid);
}

export function getDecisionsByMission(missionId: string): any[] {
  return db.prepare("SELECT * FROM decisions WHERE mission_id = ? ORDER BY id ASC").all(missionId);
}

export function countDecisionsByMission(missionId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM decisions WHERE mission_id = ?").get(missionId) as { c: number };
  return row.c;
}

export function countObservationsByMission(missionId: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM observations o
     JOIN decisions d ON o.decision_id = d.id
     WHERE d.mission_id = ?`
  ).get(missionId) as { c: number };
  return row.c;
}

export function insertExecutionLog(params: {
  missionId: string;
  taskId?: number;
  phase: string;
  status: string;
  inputJson?: string;
  outputJson?: string;
  errorMessage?: string;
  executionTimeMs?: number;
  tokenDelta?: number;
}): number {
  const stmt = db.prepare(
    `INSERT INTO execution_logs (mission_id, task_id, phase, status, input_json, output_json, error_message, execution_time_ms, token_delta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    params.missionId,
    params.taskId ?? null,
    params.phase,
    params.status,
    params.inputJson ?? null,
    params.outputJson ?? null,
    params.errorMessage ?? null,
    params.executionTimeMs ?? null,
    params.tokenDelta ?? null
  );
  return Number(result.lastInsertRowid);
}

export function getExecutionLogsByMission(missionId: string): any[] {
  return db.prepare("SELECT * FROM execution_logs WHERE mission_id = ? ORDER BY id ASC").all(missionId);
}

export function getExecutionLogsByTask(taskId: number): any[] {
  return db.prepare("SELECT * FROM execution_logs WHERE task_id = ? ORDER BY id ASC").all(taskId);
}

export function createHumanIntervention(id: string, taskId: number | undefined, type: string, payload: string): void {
  db.prepare("INSERT OR REPLACE INTO human_interventions (id, task_id, type, status, payload) VALUES (?, ?, ?, 'PENDING', ?)")
    .run(id, taskId ?? null, type, payload);
}

export function resolveHumanIntervention(id: string, resolution: string): void {
  db.prepare("UPDATE human_interventions SET status = 'RESOLVED', resolution = ?, resolved_at = datetime('now') WHERE id = ?")
    .run(resolution, id);
}

export function getPendingHumanInterventions(): any[] {
  return db.prepare("SELECT * FROM human_interventions WHERE status = 'PENDING' ORDER BY id ASC").all();
}

export function createMissionArtifact(id: string, missionId: string, taskId: number | undefined, fileName: string, filePath: string, fileSize: number, mimeType: string): void {
  db.prepare("INSERT OR REPLACE INTO mission_artifacts (id, mission_id, task_id, file_name, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, missionId, taskId ?? null, fileName, filePath, fileSize, mimeType);
}

export function getArtifactsByMission(missionId: string): any[] {
  return db.prepare("SELECT * FROM mission_artifacts WHERE mission_id = ? ORDER BY id ASC").all(missionId);
}

export function createMissionCheckpoint(params: {
  missionId: string;
  taskId?: number | null;
  loopIteration: number;
  agentStateJson: string;
  taskStateJson: string;
  sandboxStateJson?: string;
  tokenSnapshotJson?: string;
  budgetSnapshotJson?: string;
  interruptionReason?: string | null;
}): number {
  const stmt = db.prepare(
    `INSERT INTO mission_checkpoints (mission_id, task_id, loop_iteration, agent_state_json, task_state_json, sandbox_state_json, token_snapshot_json, budget_snapshot_json, interruption_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    params.missionId,
    params.taskId ?? null,
    params.loopIteration,
    params.agentStateJson,
    params.taskStateJson,
    params.sandboxStateJson ?? null,
    params.tokenSnapshotJson ?? null,
    params.budgetSnapshotJson ?? null,
    params.interruptionReason ?? null
  );
  return Number(result.lastInsertRowid);
}

export function getLatestCheckpoint(missionId: string): any | undefined {
  return db.prepare("SELECT * FROM mission_checkpoints WHERE mission_id = ? ORDER BY id DESC LIMIT 1").get(missionId);
}

export function getCheckpointsByMission(missionId: string): any[] {
  return db.prepare("SELECT * FROM mission_checkpoints WHERE mission_id = ? ORDER BY id ASC").all(missionId);
}

export function createMissionQueueEntry(params: {
  missionId: string;
  priority?: number;
  budgetAllocatedTokens?: number;
  attributes?: string | undefined;
  tasksTotal?: number;
  tasksDone?: number;
  lastCognition?: string | undefined;
}): number {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO mission_queue (mission_id, priority, budget_allocated_tokens, attributes, tasks_total, tasks_done, last_cognition)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    params.missionId,
    params.priority ?? 0,
    params.budgetAllocatedTokens ?? 50000,
    params.attributes ?? null,
    params.tasksTotal ?? 0,
    params.tasksDone ?? 0,
    params.lastCognition ?? null
  );
  return Number(result.lastInsertRowid);
}

export function getMissionQueueEntry(missionId: string): any | undefined {
  return db.prepare("SELECT * FROM mission_queue WHERE mission_id = ?").get(missionId);
}

export function updateMissionQueueStatus(missionId: string, status: string, extra?: { preemptedBy?: string; startedAt?: string; completedAt?: string; budgetConsumed?: number }): void {
  const existing = getMissionQueueEntry(missionId);
  if (!existing) return;
  const sets: string[] = ["status = ?"];
  const vals: unknown[] = [status];
  if (extra?.preemptedBy) { sets.push("preempted_by = ?"); vals.push(extra.preemptedBy); }
  if (extra?.startedAt) { sets.push("started_at = ?"); vals.push(extra.startedAt); }
  if (extra?.completedAt) { sets.push("completed_at = ?"); vals.push(extra.completedAt); }
  if (extra?.budgetConsumed !== undefined) { sets.push("budget_consumed_tokens = ?"); vals.push(extra.budgetConsumed); }
  vals.push(missionId);
  db.prepare(`UPDATE mission_queue SET ${sets.join(", ")} WHERE mission_id = ?`).run(...vals);
}

export function getNextQueuedMission(): any | undefined {
  return db.prepare(
    `SELECT * FROM mission_queue WHERE status = 'QUEUED' ORDER BY priority DESC, queued_at ASC LIMIT 1`
  ).get();
}

export function getRunningMissions(): any[] {
  return db.prepare("SELECT * FROM mission_queue WHERE status = 'RUNNING' ORDER BY priority ASC, started_at ASC").all();
}

export function getPausedMissions(): any[] {
  return db.prepare("SELECT * FROM mission_queue WHERE status = 'PAUSED' ORDER BY priority DESC, queued_at ASC").all();
}

export function createTaskSchedule(params: {
  name: string;
  cronExpr?: string;
  intervalMinutes?: number;
  nextTriggerAt: string;
  priorityOverride?: number;
  budgetAllocatedTokens?: number;
  missionId?: string;
  attributes?: string | undefined;
}): number {
  const stmt = db.prepare(
    `INSERT INTO task_schedules (name, cron_expr, interval_minutes, next_trigger_at, priority_override, budget_allocated_tokens, mission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    params.name,
    params.cronExpr ?? null,
    params.intervalMinutes ?? null,
    params.nextTriggerAt,
    params.priorityOverride ?? null,
    params.budgetAllocatedTokens ?? 10000,
    params.missionId ?? null
  );
  return Number(result.lastInsertRowid);
}

export function getEnabledTaskSchedules(): any[] {
  return db.prepare("SELECT * FROM task_schedules WHERE enabled = 1 AND next_trigger_at <= datetime('now') ORDER BY next_trigger_at ASC").all();
}

export function updateTaskSchedule(id: number, updates: { nextTriggerAt?: string; lastStatus?: string; lastRunAt?: string; enabled?: number }): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.nextTriggerAt !== undefined) { sets.push("next_trigger_at = ?"); vals.push(updates.nextTriggerAt); }
  if (updates.lastStatus !== undefined) { sets.push("last_status = ?"); vals.push(updates.lastStatus); }
  if (updates.lastRunAt !== undefined) { sets.push("last_run_at = ?"); vals.push(updates.lastRunAt); }
  if (updates.enabled !== undefined) { sets.push("enabled = ?"); vals.push(updates.enabled); }
  vals.push(id);
  db.prepare(`UPDATE task_schedules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function deleteTaskSchedule(id: number): void {
  db.prepare("DELETE FROM task_schedules WHERE id = ?").run(id);
}

export function getAllTaskSchedules(): any[] {
  return db.prepare("SELECT * FROM task_schedules ORDER BY id ASC").all();
}

export function getDistinctTags(): string[] {
  const rows = db.prepare(
    `SELECT attributes FROM missions WHERE attributes IS NOT NULL
     UNION ALL
     SELECT attributes FROM task_schedules WHERE attributes IS NOT NULL`
  ).all() as { attributes: string }[];
  const tags = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.attributes) as { tags?: string[] };
      if (Array.isArray(parsed.tags)) {
        for (const t of parsed.tags) {
          if (typeof t === "string" && t.trim()) tags.add(t.trim());
        }
      }
    } catch {}
  }
  return Array.from(tags).sort();
}

export function insertInterruptionLog(params: {
  missionId: string;
  reason: string;
  taskId?: number;
  toolPid?: number;
  toolOutputThusFar?: string;
}): number {
  const stmt = db.prepare(
    `INSERT INTO interruption_logs (mission_id, task_id, reason, tool_pid, tool_output_thus_far) VALUES (?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    params.missionId,
    params.taskId ?? null,
    params.reason,
    params.toolPid ?? null,
    params.toolOutputThusFar ?? null
  );
  return Number(result.lastInsertRowid);
}

export function updateInterruptionLogCleanup(id: number, status: string): void {
  db.prepare("UPDATE interruption_logs SET sandbox_cleanup_status = ? WHERE id = ?").run(status, id);
}

export function archiveOldExecutionLogs(cutoffDays: number = 30): number {
  const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare("SELECT * FROM execution_logs WHERE created_at < ?").all(cutoff) as any[];
  const stmt = db.prepare(
    `INSERT INTO execution_logs_archive (mission_id, task_id, phase, status, input_json, output_json, error_message, execution_time_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    stmt.run(row.mission_id, row.task_id, row.phase, row.status, row.input_json, row.output_json, row.error_message, row.execution_time_ms, row.created_at);
  }
  const deleteResult = db.prepare("DELETE FROM execution_logs WHERE created_at < ?").run(cutoff);
  return Number(deleteResult.changes);
}

export function getInterruptionsByMission(missionId: string): any[] {
  return db.prepare("SELECT * FROM interruption_logs WHERE mission_id = ? ORDER BY id ASC").all(missionId);
}

export function getArtifactById(id: string): any | undefined {
  return db.prepare("SELECT * FROM mission_artifacts WHERE id = ?").get(id);
}

export function getAllMissions(): any[] {
  return db.prepare("SELECT * FROM missions ORDER BY created_at DESC").all();
}

export function getAllQueueEntries(): any[] {
  return db.prepare("SELECT * FROM mission_queue ORDER BY priority DESC, queued_at ASC").all();
}

export function getDb(): any {
  return db;
}

export function upsertImplicationHash(hash: string, tool: string, paramsJson: string, resultJson: string, environmentJson?: string, ttlMinutes = 30): void {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO implication_hashes (hash, tool, params_json, environment_json, result_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET result_json = excluded.result_json, expires_at = excluded.expires_at`
  ).run(hash, tool, paramsJson, environmentJson ?? null, resultJson, expiresAt);
}

export function lookupImplicationHash(hash: string): { result_json: string; expires_at: string } | undefined {
  const row = db.prepare("SELECT result_json, expires_at FROM implication_hashes WHERE hash = ?").get(hash) as { result_json: string; expires_at: string } | undefined;
  if (!row) return undefined;
  if (row.expires_at < new Date().toISOString()) {
    db.prepare("DELETE FROM implication_hashes WHERE hash = ?").run(hash);
    return undefined;
  }
  return row;
}

export function gcExpiredImplicationHashes(): number {
  const result = db.prepare("DELETE FROM implication_hashes WHERE expires_at < datetime('now')").run();
  return Number(result.changes);
}
