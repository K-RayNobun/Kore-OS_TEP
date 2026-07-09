import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";

const dbPath = process.env.KORE_DB_PATH || "/home/elo/data/tasks.db";
const dbDir = path.dirname(dbPath);
try {
    fs.mkdirSync(dbDir, { recursive: true });
} catch {}
const db = new Database(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

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

export function createMission(id: string, prompt: string): void {
  db.prepare("INSERT OR IGNORE INTO missions (id, prompt) VALUES (?, ?)").run(id, prompt);
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export function insertExecutionLog(params: {
  missionId: string;
  taskId?: number;
  phase: string;
  status: string;
  inputJson?: string;
  outputJson?: string;
  errorMessage?: string;
  executionTimeMs?: number;
}): number {
  const stmt = db.prepare(
    `INSERT INTO execution_logs (mission_id, task_id, phase, status, input_json, output_json, error_message, execution_time_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    params.missionId,
    params.taskId ?? null,
    params.phase,
    params.status,
    params.inputJson ?? null,
    params.outputJson ?? null,
    params.errorMessage ?? null,
    params.executionTimeMs ?? null
  );
  return Number(result.lastInsertRowid);
}

export function getExecutionLogsByMission(missionId: string): any[] {
  return db.prepare("SELECT * FROM execution_logs WHERE mission_id = ? ORDER BY id ASC").all(missionId);
}

export function getExecutionLogsByTask(taskId: number): any[] {
  return db.prepare("SELECT * FROM execution_logs WHERE task_id = ? ORDER BY id ASC").all(taskId);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS human_interventions (
    id TEXT PRIMARY KEY,
    task_id INTEGER,
    type TEXT,
    status TEXT DEFAULT 'PENDING',
    payload TEXT,
    resolution TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

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

export function createHumanIntervention(id: string, taskId: number | undefined, type: string, payload: string): void {
  db.prepare("INSERT OR REPLACE INTO human_interventions (id, task_id, type, status, payload) VALUES (?, ?, ?, 'PENDING', ?)")
    .run(id, taskId ?? null, type, payload);
}

export function resolveHumanIntervention(id: string, resolution: string): void {
  db.prepare("UPDATE human_interventions SET status = 'RESOLVED', resolution = ? WHERE id = ?")
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

export function getArtifactById(id: string): any | undefined {
  return db.prepare("SELECT * FROM mission_artifacts WHERE id = ?").get(id);
}
