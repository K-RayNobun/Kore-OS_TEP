import { ApiGuardMiddleware, type RetryEvent } from "./api_guard_middleware.js";
import { buildAgentSystemPrompt } from "../prompts/agent_system_prompt.js";
import { getAvailableActions } from "./tool_dispatcher.js";
import { Interpreter } from "./interpreter.js";
import { Reporter, type DecisionRecordResult, type ObservationRecordResult, type TaskStateUpdateResult, type ReportWriteResult } from "./reporter.js";
import { loadTaskState, createTaskState, type TaskStateFile, getTaskStatePath } from "./task_state_manager.js";
import * as dbHelper from "./database_helper.js";
import { callGemini, callZhipu } from "./llm_client.js";
import { PromptReformulator, type ReformulatedPrompt } from "./prompt_reformulator.js";
import { sysInspect, type SysInspectParams } from "./sys_inspect.js";
import { buildExecutionLog, writeExecutionLog, type MicroStep } from "./execution_logger.js";
import type { Broadcaster } from "./ipc_pipe.js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface Mission {
  id: string;
  prompt: string;
}

export interface AgentLoopResult {
  missionId: string;
  completed: boolean;
  summary: string;
}

const SCHEMA_NAME_MAP: Record<string, string> = {
  "GET_SYSTEM_TELEMETRY": "telemetrySchema",
  "EXECUTE_SANDBOX_COMMAND": "sandboxSchema",
  "PATCH_FILE_DIFF": "patchSchema",
  "MANAGE_BACKGROUND_SERVICE": "serviceSchema",
  "AUDIT_NETWORK_SOCKETS": "networkSchema",
  "STAGE_SECURE_BACKUP": "backupSchema",
  "INSPECT_BINARY_METADATA": "binarySchema",
  "OPTIMIZE_MARKETING_ASSETS": "assetSchema",
  "WRITE_TECHNICAL_REPORT": "techReportSchema",
  "WRITE_EXECUTIVE_REPORT": "execReportSchema",
  "WRITE_REFLECTION": "reflectionSchema",
  "EXECUTE_BROWSER_FLOW": "browserSchema",
  "LOG_CAMPAIGN_METRICS": "metricsSchema",
  "RECORD_GIT_MILESTONE": "milestoneSchema",
  "REFORMULATE_PROMPT": "reformulateSchema",
  "SYS_INSPECT": "sysInspectSchema"
};

function detectCompletionSignal(thought: string): "TASK_COMPLETE" | "MISSION_COMPLETE" | undefined {
  if (thought.includes("MISSION_COMPLETE")) return "MISSION_COMPLETE";
  if (thought.includes("TASK_COMPLETE")) return "TASK_COMPLETE";
  return undefined;
}

export class AgentLoop {
  private apiGuard: ApiGuardMiddleware;
  private interpreter: Interpreter;
  private reporter: Reporter;
  private maxStepsPerTask: number;
  private readonly ipcBroadcaster: Broadcaster | null;
  private readonly stateBroadcaster: ((state: Record<string, unknown>) => void) | null;
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly startedAt = Date.now();

  constructor(apiGuard: ApiGuardMiddleware, ipcBroadcaster: Broadcaster | null = null, stateBroadcaster: ((state: Record<string, unknown>) => void) | null = null, maxStepsPerTask = 50) {
    this.apiGuard = apiGuard;
    this.interpreter = new Interpreter();
    this.reporter = new Reporter();
    this.maxStepsPerTask = maxStepsPerTask;
    this.ipcBroadcaster = ipcBroadcaster;
    this.stateBroadcaster = stateBroadcaster;
  }

  async executeMission(prompt: string, missionIdOverride?: string): Promise<AgentLoopResult> {
    const overallStart = Date.now();
    console.error("[AGENT_LOOP] executeMission START", { prompt, missionIdOverride });
    const reformulator = new PromptReformulator();
    const reformulated: ReformulatedPrompt = reformulator.reformulate(prompt, missionIdOverride);
    console.error("[AGENT_LOOP] reformulate DONE", { status: reformulated.status, mission_id: reformulated.mission_id, tool_chain_length: reformulated.tool_chain?.length ?? 0 });

    if (reformulated.status === "VALIDATION_ERROR") {
      const missionId = reformulated.mission_id;
      dbHelper.createMission(missionId, prompt);
      dbHelper.updateMissionStatus(missionId, "ACTIVE");
      const entry = `**REFORMULATE_ERROR** Missing required parameters: ${reformulated.validation_errors.join(", ")}`;
      await this.reporter.writeTechnicalReport(missionId, entry);
      return {
        missionId,
        completed: false,
        summary: "Mission blocked: Invalid or incomplete prompt structure"
      };
    }

    const missionId = reformulated.mission_id;
    dbHelper.createMission(missionId, prompt);
    dbHelper.updateMissionStatus(missionId, "ACTIVE");

    this.stateBroadcaster?.({ state: "RUNNING", mission_id: missionId });

    const tasks = reformulated.tool_chain.map(tool => ({
      id: null,
      description: JSON.stringify({ tool: tool.tool, parameters: tool.parameters, output_marker: tool.output_marker })
    }));

    this.ipcBroadcaster?.({ type: "mission_start", payload: { mission_id: missionId, prompt, tasks_count: tasks.length } });

    const technicalReportEntry = `## Mission Start: ${missionId}\n**Prompt:** ${prompt}\n**Reformulated Tool Chain:** ${JSON.stringify(reformulated.tool_chain, null, 2)}\n`;
    const technicalPath = await this.reporter.writeTechnicalReport(missionId, technicalReportEntry);
    this.emitArtifact(missionId, path.basename(technicalPath.path), technicalPath.path, fs.statSync(technicalPath.path).size, "text/markdown");

    const microSteps: MicroStep[] = [];

    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex]!;
      const taskId = task.id || dbHelper.createTask(task.description);
      const taskState = await createTaskState(taskId, missionId);
      await this.reporter.updateTaskStatus(taskId, "RUNNING");

      console.error("[AGENT_LOOP] task START", { taskId, description: task.description });

      this.ipcBroadcaster?.({ type: "task_start", payload: { task_id: taskId, mission_id: missionId, description: task.description } });

      const retryEvents: RetryEvent[] = [];

      const result = await this.runTaskLoop(missionId, taskId, task.description, taskState, microSteps, retryEvents);
      console.error("[AGENT_LOOP] task END", { taskId, completed: result.completed });

      if (result.completed) {
        await this.reporter.updateTaskStatus(taskId, "DONE");
      } else {
        await this.reporter.updateTaskStatus(taskId, "FAILED");
      }
    }

    const executiveSummary = `Mission ${missionId} completed. All tasks processed.`;
    await this.reporter.writeExecutiveSummary(missionId, executiveSummary);

    console.error("[AGENT_LOOP] executeMission COMPLETED", { missionId, totalDurationMs: Date.now() - overallStart });
    dbHelper.updateMissionStatus(missionId, "COMPLETED", new Date().toISOString());

    const completedAt = new Date().toISOString();
    const totalDurationMs = Date.now() - overallStart;

    this.ipcBroadcaster?.({ type: "mission_complete", payload: { mission_id: missionId, status: "COMPLETED", total_duration_ms: totalDurationMs } });
    this.stateBroadcaster?.({ state: "COMPLETED", mission_id: missionId });

    try {
      const log = await buildExecutionLog({
        missionId,
        prompt,
        status: "COMPLETED",
        startedAt: new Date(overallStart).toISOString(),
        completedAt,
        totalDurationMs,
        reformulatedToolChain: reformulated.tool_chain,
        tasks,
        microSteps
      });
      await writeExecutionLog(log);
    } catch (logError) {
      console.error("[EXECUTION_LOGGER_ERROR]", logError);
    }

    return {
      missionId,
      completed: true,
      summary: executiveSummary
    };
  }

  private emitArtifact(missionId: string, fileName: string, filePath: string, fileSize: number, mimeType: string): void {
    this.ipcBroadcaster?.({
      type: "artifact_manifest",
      payload: {
        id: `artifact-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        mission_id: missionId,
        file_name: fileName,
        file_path: filePath,
        file_size: fileSize,
        mime_type: mimeType
      }
    });
  }

  private async decomposeMission(prompt: string): Promise<{ tasks: { id: number | null; description: string }[] }> {
    const systemPrompt = `You are a mission planner. Analyze the user's goal and decompose it into explicit, executable tasks if needed.
If the goal is simple, return a single task.
If complex, break it into 2-5 sequential or parallel tasks.

Emits ONLY valid JSON:
{
  "isComplex": boolean,
  "tasks": [
    { "description": "Clear, actionable task description" }
  ]
}`;

    const retryEvents: RetryEvent[] = [];
    const response = await this.apiGuard.executeWithRetry("zhipu", async (apiKey) => {
      const text = await callZhipu(apiKey, `${systemPrompt}\n\nGoal: ${prompt}`);
      return { text };
    }, null, retryEvents);

    let parsed: any;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      return { tasks: [{ id: null, description: prompt }] };
    }

    if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      return { tasks: [{ id: null, description: prompt }] };
    }

    return {
      tasks: parsed.tasks.map((t: any) => ({
        id: null as number | null,
        description: typeof t === "string" ? t : t.description || String(t)
      }))
    };
  }

  private async runTaskLoop(
    missionId: string,
    taskId: number,
    taskDescription: string,
    initialState: TaskStateFile,
    microSteps: MicroStep[],
    retryEvents: RetryEvent[]
  ): Promise<{ completed: boolean }> {
    let state = initialState;
    let steps = 0;

    while (steps < this.maxStepsPerTask) {
      steps++;
      const loopStart = Date.now();

      let skeletonInjection: MicroStep["skeleton_injection"] = undefined;
      if (steps === 1) {
        try {
          const params: SysInspectParams = { mode: "skeleton", targetPath: "/home/elo/workspace/src" };
          const skeleton = await sysInspect(params);
          const cacheHit = (skeleton as any).cache_hit || false;
          skeletonInjection = {
            attempted: true,
            success: true,
            cache_hit: cacheHit,
            target_path: params.targetPath || "/home/elo/workspace/src",
            truncated_length: JSON.stringify(skeleton).substring(0, 2000).length,
            files_indexed: (skeleton as any).imports?.length || 0
          };
        } catch {
          skeletonInjection = {
            attempted: true,
            success: false,
            cache_hit: false,
            target_path: "/home/elo/workspace/src",
            truncated_length: 0,
            files_indexed: 0
          };
        }
      }

      const systemPrompt = buildAgentSystemPrompt(getAvailableActions());
      const stateSummaryBefore = this.buildStateSummary(state);
      const userPrompt = `Mission: ${missionId}\nTask: ${taskDescription}\n\nCurrent task state:\n${stateSummaryBefore}\n\nWhat is your next decision?`;

      const llmStart = Date.now();
      console.error("[AGENT_LOOP] LLM call START", { taskId, step: steps, provider: "zhipu" });
      const activeKeyId = this.apiGuard.getActiveKeyId("zhipu");
      const llmResponse = await this.apiGuard.executeWithRetry("zhipu", async (apiKey) => {
        const text = await callZhipu(apiKey, `${systemPrompt}\n\n${userPrompt}`);
        return { text };
      }, null, retryEvents);
      const llmDuration = Date.now() - llmStart;
      console.error("[AGENT_LOOP] LLM call END", { taskId, step: steps, durationMs: llmDuration, responseLength: llmResponse.text?.length ?? 0 });
      const rawResponseText = llmResponse.text;
      const estimatedTokens = Math.floor((systemPrompt.length + userPrompt.length) / 4);
      const estimatedResponseTokens = Math.floor(rawResponseText.length / 4);

      this.inputTokens += estimatedTokens;
      this.outputTokens += estimatedResponseTokens;

      const llmRequest: MicroStep["llm_request"] = {
        prompt: userPrompt,
        system_prompt_preview: systemPrompt.substring(0, 500) + (systemPrompt.length > 500 ? "..." : ""),
        provider: "zhipu",
        model: "glm-4.5-flash",
        attempt: retryEvents.length + 1,
        api_key_id: activeKeyId,
        request_chars: systemPrompt.length + userPrompt.length,
        estimated_tokens: estimatedTokens
      };

      const llmResponseData: MicroStep["llm_response"] = {
        raw_text: rawResponseText,
        char_count: rawResponseText.length,
        truncated: rawResponseText.length > 2000
      };

      let decisionParsing: MicroStep["decision_parsing"];
      let decision: { thought: string; action: string | null; parameters: Record<string, unknown> };
      try {
        const sanitized = rawResponseText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(sanitized);
        decision = {
          thought: parsed.thought || "",
          action: parsed.action ?? null,
          parameters: parsed.parameters || {}
        };
        decisionParsing = {
          success: true,
          sanitized_text: sanitized.substring(0, 1000) + (sanitized.length > 1000 ? "..." : ""),
          parsed_decision: parsed
        };
      } catch (parseError: any) {
        decision = {
          thought: rawResponseText,
          action: null,
          parameters: {}
        };
        decisionParsing = {
          success: false,
          sanitized_text: rawResponseText.replace(/```json/g, "").replace(/```/g, "").trim().substring(0, 1000),
          parsed_decision: null,
          parse_error: parseError.message || String(parseError)
        };
      }

      const completionSignal = detectCompletionSignal(decision.thought);
      const reflectionType = completionSignal ? "completion" : decision.action ? "tool_action" : "null_action_continue";

      let validationPhase: MicroStep["validation_phase"] = undefined;
      if (decision.action) {
        const schemaName = SCHEMA_NAME_MAP[decision.action];
        validationPhase = {
          status: "passed",
          validated_action: decision.action,
          schema_used: schemaName || "unknown"
        };
      }

      let toolExecutionPhase: MicroStep["tool_execution_phase"] = undefined;
      let observationPhase: MicroStep["observation_phase"] = undefined;
      let decisionRecordPhase: MicroStep["decision_record_phase"] = undefined;
      let observationRecordPhase: MicroStep["observation_record_phase"] = undefined;
      let taskStateUpdatePhase: MicroStep["task_state_update_phase"] = undefined;

      if (completionSignal) {
        const reflectionStart = Date.now();
        const reflectionResult = await this.reporter.writeReflection(taskId, decision.thought);
        const reflectionDuration = Date.now() - reflectionStart;
        this.emitArtifact(missionId, path.basename(reflectionResult.path), reflectionResult.path, fs.statSync(reflectionResult.path).size, "text/markdown");

        const decisionRecord = await this.reporter.recordDecision(missionId, taskId, decision) as DecisionRecordResult;

        microSteps.push({
          micro_step_id: `micro_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          loop_iteration: steps,
          task_state_step_id: undefined,
          phase: "reflection",
          started_at: new Date(loopStart).toISOString(),
          duration_ms: Date.now() - loopStart,
          llm_request: llmRequest,
          llm_response: llmResponseData,
          decision_parsing: decisionParsing,
          validation_phase: validationPhase,
          tool_execution_phase: {
            status: "SUCCESS",
            output_path: reflectionResult.path,
            duration_ms: reflectionDuration
          },
          observation_phase: observationPhase,
          decision_record_phase: {
            decision_id: decisionRecord.decisionId,
            duration_ms: decisionRecord.duration_ms
          },
          observation_record_phase: observationRecordPhase,
          task_state_update_phase: taskStateUpdatePhase,
          retry_events: retryEvents.length > 0 ? [...retryEvents] : [],
          skeleton_injection: skeletonInjection,
          reflection_type: reflectionType,
          completion_signal: completionSignal,
          state_summary_before: stateSummaryBefore,
          state_summary_after: stateSummaryBefore
        } as any);

        return { completed: true };
      }

      const decisionRecord = await this.reporter.recordDecision(missionId, taskId, decision) as DecisionRecordResult;
      decisionRecordPhase = {
        decision_id: decisionRecord.decisionId,
        duration_ms: decisionRecord.duration_ms
      };

      const telemetryPayload: Record<string, unknown> = {
        task_id: taskId,
        mission_id: missionId,
        thought: decision.thought,
        action: decision.action,
        parameters: decision.parameters,
        input_tokens: this.inputTokens,
        output_tokens: this.outputTokens
      };
      if (this.startedAt) {
        telemetryPayload.burn_rate = this.outputTokens / ((Date.now() - this.startedAt) / 1000);
      }
      this.ipcBroadcaster?.({ type: "thinking", payload: telemetryPayload });

      if (!decision.action) {
        const taskStateUpdate = await this.reporter.updateTaskStateFile(taskId, decision, null) as TaskStateUpdateResult;
        const stateSummaryAfter = this.buildStateSummary(taskStateUpdate.state);

        const obsPhase = observationPhase as any;
        microSteps.push({
          micro_step_id: `micro_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          loop_iteration: steps,
          task_state_step_id: state.steps.length + 1,
          phase: "reflection",
          started_at: new Date(loopStart).toISOString(),
          duration_ms: Date.now() - loopStart,
          llm_request: llmRequest,
          llm_response: llmResponseData,
          decision_parsing: decisionParsing,
          validation_phase: validationPhase,
          tool_execution_phase: toolExecutionPhase,
          observation_phase: obsPhase,
          decision_record_phase: decisionRecordPhase,
          observation_record_phase: observationRecordPhase,
          task_state_update_phase: {
            new_step_index: state.steps.length + 1,
            duration_ms: taskStateUpdate.duration_ms,
            file_path: getTaskStatePath(taskId)
          },
          retry_events: retryEvents.length > 0 ? [...retryEvents] : [],
          skeleton_injection: skeletonInjection,
          reflection_type: reflectionType,
          completion_signal: completionSignal,
          state_summary_before: stateSummaryBefore,
          state_summary_after: stateSummaryAfter
        } as any);

        state = taskStateUpdate.state;
        continue;
      }

      const interpretStart = Date.now();
      const observation = await this.interpreter.interpret(decision);
      const interpretDuration = Date.now() - interpretStart;

      if (observation) {
        observationPhase = {
          status: observation.status,
          output: observation.output,
          execution_time_ms: observation.executionTimeMs,
          error: observation.error ?? undefined
        } as any;
      }

      const observationRecord = await this.reporter.recordObservation(decisionRecord.decisionId, observation!) as ObservationRecordResult;
      if (observationRecord) {
        observationRecordPhase = {
          observation_id: observationRecord.observationId,
          duration_ms: observationRecord.duration_ms
        };
      }

      const taskStateUpdate = await this.reporter.updateTaskStateFile(taskId, decision, observation) as TaskStateUpdateResult;
      state = taskStateUpdate.state;
      const stateSummaryAfter = this.buildStateSummary(state);

      if (observation && observation.status === "SUCCESS") {
        const writeStart = Date.now();
        const writeResult = decision.action === "WRITE_EXECUTIVE_REPORT"
          ? await this.reporter.writeExecutiveSummary(missionId, `Generated social media content for campaign ${taskDescription}`)
          : await this.reporter.writeTechnicalReport(missionId, `Tool ${decision.action} completed successfully for task ${taskId}.`);
        const writeDuration = Date.now() - writeStart;
        this.emitArtifact(missionId, path.basename(writeResult.path), writeResult.path, fs.statSync(writeResult.path).size, "text/markdown");

        toolExecutionPhase = {
          status: "SUCCESS",
          output_path: writeResult.path,
          duration_ms: writeDuration
        };
      } else if (observation && observation.status === "FAILED") {
        toolExecutionPhase = {
          status: "FAILED",
          error: observation.error ?? undefined
        } as any;
      } else {
        toolExecutionPhase = {
          status: observation?.status || "UNKNOWN"
        };
      }

      const executionTelemetry: Record<string, unknown> = {
        task_id: taskId,
        mission_id: missionId,
        action: decision.action,
        status: toolExecutionPhase?.status,
        output: toolExecutionPhase?.output_path,
        error: toolExecutionPhase?.error,
        duration_ms: toolExecutionPhase?.duration_ms,
        input_tokens: this.inputTokens,
        output_tokens: this.outputTokens
      };
      if (this.startedAt) {
        executionTelemetry.burn_rate = this.outputTokens / ((Date.now() - this.startedAt) / 1000);
      }
      this.ipcBroadcaster?.({ type: "tool_execution", payload: executionTelemetry });

      microSteps.push({
        micro_step_id: `micro_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        loop_iteration: steps,
        task_state_step_id: state.steps.length,
        phase: "tool_execution",
        started_at: new Date(loopStart).toISOString(),
        duration_ms: Date.now() - loopStart,
        llm_request: llmRequest,
        llm_response: llmResponseData,
        decision_parsing: decisionParsing,
        validation_phase: validationPhase,
        tool_execution_phase: toolExecutionPhase,
        observation_phase: observationPhase,
        decision_record_phase: decisionRecordPhase,
        observation_record_phase: observationRecordPhase,
          task_state_update_phase: {
            new_step_index: taskStateUpdate.state.steps.length,
            duration_ms: taskStateUpdate.duration_ms,
            file_path: getTaskStatePath(taskId)
          },
        retry_events: retryEvents.length > 0 ? [...retryEvents] : [],
        skeleton_injection: skeletonInjection,
        reflection_type: reflectionType,
        completion_signal: completionSignal,
        state_summary_before: stateSummaryBefore,
        state_summary_after: stateSummaryAfter
      } as any);
    }

    return { completed: false };
  }

  private buildStateSummary(state: TaskStateFile): string {
    const recentSteps = state.steps.slice(-5);
    if (recentSteps.length === 0) {
      return "No steps taken yet.";
    }

    const truncate = (s: string, n = 200) => (s.length > n ? s.substring(0, n) + "..." : s);

    return recentSteps
      .map(step => {
        let summary = `Step ${step.step}: ${truncate(step.decision.thought)}`;
        if (step.decision.action) {
          summary += ` | Action: ${step.decision.action}`;
        }
        if (step.observation) {
          summary += ` | Result: ${step.observation.status}`;
          if (step.observation.error) {
            summary += ` (${truncate(step.observation.error)})`;
          }
        }
        return summary;
      })
      .join("\n");
  }
}
