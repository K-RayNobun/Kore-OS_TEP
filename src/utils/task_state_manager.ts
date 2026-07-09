import fs from "node:fs/promises";
import path from "node:path";

export interface TaskStep {
  step: number;
  decision: {
    thought: string;
    action: string | null;
    parameters: Record<string, unknown>;
  };
  observation: {
    status: string;
    output: string | undefined;
    execution_time_ms: number | undefined;
    error: string | undefined;
  } | undefined;
  timestamp: string;
}

export interface TaskStateFile {
  task_id: number;
  mission_id: string;
  status: string;
  created_at: string;
  steps: TaskStep[];
  current_file_states?: Record<string, { size: number; last_modified: string }>;
}

const TASKS_ROOT = path.join(process.cwd(), "reports", "missions", "tasks");

export async function ensureTasksRoot(): Promise<void> {
  await fs.mkdir(TASKS_ROOT, { recursive: true });
}

export function getTaskStatePath(taskId: number): string {
  return path.join(TASKS_ROOT, `task_${taskId}.json`);
}

export async function loadTaskState(taskId: number): Promise<TaskStateFile | null> {
  const filePath = getTaskStatePath(taskId);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as TaskStateFile;
  } catch {
    return null;
  }
}

export async function saveTaskState(state: TaskStateFile): Promise<void> {
  await ensureTasksRoot();
  const filePath = getTaskStatePath(state.task_id);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

export async function appendStep(state: TaskStateFile, step: TaskStep): Promise<TaskStateFile> {
  state.steps.push(step);
  state.status = step.observation ? "OBSERVED" : "REFLECTED";
  await saveTaskState(state);
  return state;
}

export async function createTaskState(taskId: number, missionId: string): Promise<TaskStateFile> {
  await ensureTasksRoot();
  const state: TaskStateFile = {
    task_id: taskId,
    mission_id: missionId,
    status: "CREATED",
    created_at: new Date().toISOString(),
    steps: [],
    current_file_states: {}
  };
  await saveTaskState(state);
  return state;
}
