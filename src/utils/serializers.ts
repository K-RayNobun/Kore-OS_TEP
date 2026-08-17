export function parseAttributes(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function serializeMission(queueRow: any, missionRow: any | undefined): Record<string, unknown> {
  const attributes = parseAttributes(missionRow?.attributes ?? queueRow?.attributes);
  const latestCheckpointIteration =
    missionRow?.latest_checkpoint_iteration ?? queueRow?.latest_checkpoint_iteration ?? null;
  return {
    missionId: queueRow.mission_id,
    prompt: missionRow?.prompt ?? null,
    status: queueRow.status,
    priority: queueRow.priority,
    attributes,
    budgetAllocated: queueRow.budget_allocated_tokens,
    budgetConsumed: queueRow.budget_consumed_tokens,
    tasksTotal: queueRow.tasks_total ?? 0,
    tasksDone: queueRow.tasks_done ?? 0,
    preemptedBy: queueRow.preempted_by ?? null,
    lastCognition: queueRow.last_cognition ?? null,
    latestCheckpointIteration: latestCheckpointIteration == null ? null : Number(latestCheckpointIteration),
    queuedAt: queueRow.queued_at ?? null,
    startedAt: queueRow.started_at ?? null,
    completedAt: queueRow.completed_at ?? null
  };
}

export function serializeSchedule(row: any): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt ?? null,
    cronExpr: row.cron_expr ?? null,
    intervalMinutes: row.interval_minutes ?? null,
    nextTriggerAt: row.next_trigger_at,
    enabled: row.enabled === 1,
    priorityOverride: row.priority_override ?? null,
    budgetAllocatedTokens: row.budget_allocated_tokens,
    maxConcurrentRuns: row.max_concurrent_runs ?? 1,
    lastStatus: row.last_status ?? null,
    lastRunAt: row.last_run_at ?? null,
    attributes: parseAttributes(row.attributes)
  };
}

export function serializeCheckpoint(row: any): Record<string, unknown> {
  return {
    id: row.id,
    missionId: row.mission_id,
    taskId: row.task_id ?? null,
    loopIteration: row.loop_iteration ?? null,
    createdAt: row.created_at ?? null
  };
}

export function serializeInterruption(row: any): Record<string, unknown> {
  return {
    id: row.id,
    missionId: row.mission_id,
    taskId: row.task_id ?? null,
    reason: row.reason,
    toolPid: row.tool_pid ?? null,
    cleanupStatus: row.sandbox_cleanup_status ?? null,
    createdAt: row.created_at ?? null
  };
}
