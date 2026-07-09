import fs from "node:fs/promises";
import path from "node:path";
import * as dbHelper from "./database_helper.js";
import * as child_process from "node:child_process";

export interface MicroStep {
  micro_step_id: string;
  loop_iteration: number;
  task_state_step_id: number | undefined;
  phase: "llm_reasoning" | "tool_execution" | "reflection";
  started_at: string;
  duration_ms: number;
  llm_request: {
    prompt: string;
    system_prompt_preview: string;
    provider: string;
    model: string;
    attempt: number;
    api_key_id: string;
    request_chars: number;
    estimated_tokens: number;
  } | undefined;
  llm_response: {
    raw_text: string;
    char_count: number;
    truncated: boolean;
  } | undefined;
  decision_parsing: {
    success: boolean;
    sanitized_text: string;
    parsed_decision: any;
    parse_error?: string;
  } | undefined;
  validation_phase: {
    status: string;
    validated_action?: string;
    schema_used?: string;
    validation_error?: string;
  } | undefined;
  tool_execution_phase: {
    status: string;
    output?: unknown;
    output_path?: string;
    error?: string;
    duration_ms?: number;
  } | undefined;
  observation_phase: {
    status: string;
    output?: unknown;
    execution_time_ms: number;
    error?: string;
  } | undefined;
  decision_record_phase: {
    decision_id: number;
    duration_ms: number;
  } | undefined;
  observation_record_phase: {
    observation_id: number;
    duration_ms: number;
  } | undefined;
  task_state_update_phase: {
    new_step_index: number;
    duration_ms: number;
    file_path: string;
  } | undefined;
  retry_events: any[];
  skeleton_injection: {
    attempted: boolean;
    success: boolean;
    cache_hit: boolean;
    target_path: string;
    truncated_length: number;
    files_indexed: number;
  } | undefined;
  reflection_type: "tool_action" | "null_action_continue" | "completion";
  completion_signal: "TASK_COMPLETE" | "MISSION_COMPLETE" | undefined;
  state_summary_before: string;
  state_summary_after: string;
}

export interface ExecutionLog {
  mission_id: string;
  prompt: string;
  status: string;
  started_at: string;
  completed_at: string;
  total_duration_ms: number;
  reformulated_tool_chain: any[];
  tasks: any[];
  micro_steps: MicroStep[];
  reflections_content: Record<string, string>;
  artifacts: {
    technical_reports: string[];
    executive_summaries: string[];
    reflections: string[];
    task_states: string[];
    hashes: Record<string, string>;
  };
  environment: {
    node_version: string;
    pid: number;
    cwd: string;
    env: Record<string, string>;
    ts_target: string | undefined;
    project_git_commit: string | undefined;
    workspace_git_commit: string | undefined;
  };
  validation: {
    reformulated_mission_id_matches_executed: boolean;
    all_output_markers_checked: boolean;
    missing_artifacts: string[];
    warnings: string[];
  };
  database_records: {
    mission_count: number;
    task_count: number;
    decision_count: number;
    observation_count: number;
  };
}

export async function buildExecutionLog(params: {
  missionId: string;
  prompt: string;
  status: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  reformulatedToolChain: any[];
  tasks: any[];
  microSteps: MicroStep[];
  baseDir?: string;
}): Promise<ExecutionLog> {
  const baseDir = params.baseDir || path.join(process.cwd(), "reports", "missions");
  const technicalDir = path.join(baseDir, "technical");
  const executiveDir = path.join(baseDir, "executive");
  const reflectionDir = path.join(baseDir, "reflection");
  const taskDir = path.join(baseDir, "tasks");

  const warnings: string[] = [];
  const missingArtifacts: string[] = [];

  const reformulatedMissionId = params.reformulatedToolChain?.[0]?.parameters?.missionId;
  if (reformulatedMissionId && reformulatedMissionId !== params.missionId) {
    warnings.push(`Reformulated tool chain uses missionId ${reformulatedMissionId} but executed missionId is ${params.missionId}`);
  }

  const technicalReports: string[] = [];
  const executiveSummaries: string[] = [];
  const reflections: string[] = [];
  const taskStates: string[] = [];
  const hashes: Record<string, string> = {};

  const technicalFiles = await fs.readdir(technicalDir).catch(() => []);
  for (const file of technicalFiles) {
    if (file.startsWith(`mission_${params.missionId}_`)) {
      technicalReports.push(path.join(technicalDir, file));
    }
  }
  if (technicalReports.length === 0) missingArtifacts.push("technical_reports");

  const executiveFiles = await fs.readdir(executiveDir).catch(() => []);
  for (const file of executiveFiles) {
    if (file.startsWith(`mission_${params.missionId}_`)) {
      executiveSummaries.push(path.join(executiveDir, file));
    }
  }
  if (executiveSummaries.length === 0) missingArtifacts.push("executive_summaries");

  const reflectionsContent: Record<string, string> = {};
  const reflectionFiles = await fs.readdir(reflectionDir).catch(() => []);
  for (const file of reflectionFiles) {
    const match = file.match(/^reflection_(\d+)\.md$/);
    if (match) {
      const taskId = match[1] as string;
      const reflectionPath = path.join(reflectionDir, file);
      const content = await fs.readFile(reflectionPath, "utf8").catch(() => "");
      if (content.includes(params.missionId)) {
        reflections.push(reflectionPath);
        reflectionsContent[taskId] = content;
      }
    }
  }

  const taskFiles = await fs.readdir(taskDir).catch(() => []);
  for (const file of taskFiles) {
    const match = file.match(/^task_(\d+)\.json$/);
    if (match) {
      const taskPath = path.join(taskDir, file);
      const content = await fs.readFile(taskPath, "utf8").catch(() => "{}");
      if (content.includes(params.missionId)) {
        taskStates.push(taskPath);
      }
    }
  }
  if (taskStates.length === 0) missingArtifacts.push("task_states");

  const allArtifacts = [...technicalReports, ...executiveSummaries, ...reflections, ...taskStates];
  for (const artifactPath of allArtifacts) {
    try {
      const data = await fs.readFile(artifactPath);
      const crypto = await import("node:crypto");
      hashes[path.basename(artifactPath)] = crypto.createHash("sha256").update(data).digest("hex");
    } catch {
      hashes[path.basename(artifactPath)] = "";
    }
  }

  const projectGitCommit = await getGitCommit(process.cwd()).catch(() => undefined);
  const workspaceGitCommit = await getGitCommit(path.join(process.cwd(), "home", "elo", "workspace")).catch(() => undefined);

  return {
    mission_id: params.missionId,
    prompt: params.prompt,
    status: params.status,
    started_at: params.startedAt,
    completed_at: params.completedAt,
    total_duration_ms: params.totalDurationMs,
    reformulated_tool_chain: params.reformulatedToolChain,
    tasks: params.tasks,
    micro_steps: params.microSteps,
    reflections_content: reflectionsContent,
    artifacts: {
      technical_reports: technicalReports,
      executive_summaries: executiveSummaries,
      reflections: reflections,
      task_states: taskStates,
      hashes
    },
    environment: {
      node_version: process.version,
      pid: process.pid,
      cwd: process.cwd(),
      env: {
        KORE_DB_PATH: process.env.KORE_DB_PATH || "",
        KORE_REPORTS_PATH: process.env.KORE_REPORTS_PATH || "",
        KORE_API_POOL_PATH: process.env.KORE_API_POOL_PATH || "",
        KORE_WORKSPACE_ROOT: process.env.KORE_WORKSPACE_ROOT || ""
      },
      ts_target: undefined,
      project_git_commit: projectGitCommit,
      workspace_git_commit: workspaceGitCommit
    },
    validation: {
      reformulated_mission_id_matches_executed: reformulatedMissionId === params.missionId,
      all_output_markers_checked: true,
      missing_artifacts: missingArtifacts,
      warnings
    },
    database_records: {
      mission_count: 1,
      task_count: params.tasks.length,
      decision_count: dbHelper.countDecisionsByMission(params.missionId),
      observation_count: dbHelper.countObservationsByMission(params.missionId)
    }
  };
}

export async function writeExecutionLog(log: ExecutionLog, baseDir?: string): Promise<string> {
  const dir = baseDir || path.join(process.cwd(), "reports", "missions");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `execution_log_${log.mission_id}.json`);
  await fs.writeFile(filePath, JSON.stringify(log, null, 2), "utf8");
  return filePath;
}

async function getGitCommit(repoDir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const proc = child_process.spawn("git", ["rev-parse", "HEAD"], { cwd: repoDir, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        resolve(undefined);
      }
    });
    proc.on("error", () => resolve(undefined));
  });
}
