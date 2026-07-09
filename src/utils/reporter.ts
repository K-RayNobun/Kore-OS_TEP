import * as dbHelper from "./database_helper.js";
import { type DecisionInput, type ObservationResult } from "./interpreter.js";
import { type TaskStateFile, appendStep, createTaskState, loadTaskState, saveTaskState } from "./task_state_manager.js";
import path from "node:path";
import fs from "node:fs/promises";

export interface DecisionRecordResult {
  decisionId: number;
  duration_ms: number;
}

export interface ObservationRecordResult {
  observationId: number;
  duration_ms: number;
}

export interface TaskStateUpdateResult {
  state: TaskStateFile;
  duration_ms: number;
  load_ms: number;
  append_ms: number;
  save_ms: number;
}

export interface ReportWriteResult {
  path: string;
  duration_ms: number;
}

export class Reporter {
  async recordDecision(
    missionId: string,
    taskId: number | undefined,
    decision: DecisionInput
  ): Promise<DecisionRecordResult> {
    const start = Date.now();
    const decisionId = dbHelper.insertDecision(
      missionId,
      taskId,
      decision.thought,
      decision.action ?? undefined,
      decision.parameters && Object.keys(decision.parameters).length > 0
        ? JSON.stringify(decision.parameters)
        : undefined
    );
    return { decisionId: Number(decisionId), duration_ms: Date.now() - start };
  }

  async recordObservation(
    decisionId: number,
    observation: ObservationResult
  ): Promise<ObservationRecordResult> {
    const start = Date.now();
    const observationId = dbHelper.insertObservation(
      decisionId,
      observation.status,
      observation.output ? JSON.stringify(observation.output) : undefined,
      observation.executionTimeMs
    );
    return { observationId: Number(observationId), duration_ms: Date.now() - start };
  }

  async updateTaskStateFile(
    taskId: number,
    decision: DecisionInput,
    observation: ObservationResult | null
  ): Promise<TaskStateUpdateResult> {
    const overallStart = Date.now();

    const loadStart = Date.now();
    let state = await loadTaskState(taskId);
    const loadMs = Date.now() - loadStart;

    if (!state) {
      const missionId = decision.parameters?.missionId as string | undefined || "unknown";
      state = await createTaskState(taskId, missionId);
    }

    const step = {
      step: state.steps.length + 1,
      decision: {
        thought: decision.thought,
        action: decision.action,
        parameters: decision.parameters
      },
      observation: observation
        ? {
            status: observation.status,
            output: typeof observation.output === "string" ? observation.output : JSON.stringify(observation.output),
            execution_time_ms: observation.executionTimeMs,
            error: observation.error
          }
        : undefined,
      timestamp: new Date().toISOString()
    };

    const appendStart = Date.now();
    await appendStep(state, step);
    const appendMs = Date.now() - appendStart;

    const saveStart = Date.now();
    await saveTaskState(state);
    const saveMs = Date.now() - saveStart;

    return {
      state,
      duration_ms: Date.now() - overallStart,
      load_ms: loadMs,
      append_ms: appendMs,
      save_ms: saveMs
    };
  }

  async updateTaskStatus(taskId: number, status: string): Promise<void> {
    dbHelper.updateTaskStatus(taskId, status);
  }

  async writeExecutiveSummary(missionId: string, summary: string): Promise<ReportWriteResult> {
    const start = Date.now();
    const compiler = new (await import("../tools/playbook_compiler.js")).PlaybookCompiler();
    const path = compiler.updateExecutiveReport(missionId, summary);
    return { path, duration_ms: Date.now() - start };
  }

  async writeTechnicalReport(missionId: string, entry: string): Promise<ReportWriteResult> {
    const start = Date.now();
    const compiler = new (await import("../tools/playbook_compiler.js")).PlaybookCompiler();
    const path = compiler.compileTechnicalReport(missionId, entry);
    return { path, duration_ms: Date.now() - start };
  }

  async writeReflection(taskId: number, logic: string): Promise<ReportWriteResult> {
    const start = Date.now();
    const compiler = new (await import("../tools/playbook_compiler.js")).PlaybookCompiler();
    const path = compiler.writeReflection(taskId, logic);
    return { path, duration_ms: Date.now() - start };
  }
}
