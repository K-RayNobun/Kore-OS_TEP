# Execution Logging & Telemetry Improvements Plan

**Mission:** 1783293859256-execution-logging-improvements  
**Status:** READY_FOR_REVIEW  
**Scope:** Fix 8 identified gaps in `reports/missions/execution_log_<missionId>.json` generation and underlying instrumentation.

---

## Goal

Produce a forensic-grade execution log where every micro-step inside `runTaskLoop()` is recorded with full LLM I/O, retry metadata, timing, state transitions, artifact hashes, and environment fingerprint.

---

## Data Model

### New Interface: `MicroStep`
```ts
interface MicroStep {
  micro_step_id: string;
  loop_iteration: number;
  task_state_step_id: number | null;
  phase: 'llm_reasoning' | 'tool_execution' | 'reflection';
  started_at: string;
  duration_ms: number;
  llm_request?: {
    prompt: string;
    system_prompt_preview: string;
    provider: string;
    model: string;
    attempt: number;
    api_key_id: string;
    request_chars: number;
    estimated_tokens: number;
  };
  llm_response?: {
    raw_text: string;
    char_count: number;
    truncated: boolean;
  };
  decision_parsing?: {
    success: boolean;
    sanitized_text: string;
    parsed_decision: any;
    parse_error?: string;
  };
  validation_phase?: {
    status: string;
    validated_action?: string;
    schema_used?: string;
    validation_error?: string;
  };
  tool_execution_phase?: {
    status: string;
    output?: unknown;
    output_path?: string;
    error?: string;
  };
  observation_phase?: {
    status: string;
    output?: unknown;
    execution_time_ms: number;
    error?: string;
  };
  decision_record_phase?: {
    decision_id: number;
    duration_ms: number;
  };
  observation_record_phase?: {
    observation_id: number;
    duration_ms: number;
  };
  task_state_update_phase?: {
    new_step_index: number;
    duration_ms: number;
    file_path: string;
  };
  retry_events: RetryEvent[];
  skeleton_injection?: {
    attempted: boolean;
    success: boolean;
    cache_hit: boolean;
    target_path: string;
    truncated_length: number;
    files_indexed: number;
  };
  reflection_type: 'tool_action' | 'null_action_continue' | 'completion';
  completion_signal?: 'TASK_COMPLETE' | 'MISSION_COMPLETE';
  state_summary_before: string;
  state_summary_after: string;
}
```

### New Interface: `RetryEvent`
```ts
interface RetryEvent {
  attempt: number;
  error_type: string;
  error_message: string;
  error_stack?: string;
  http_status?: number;
  timeout_duration_ms?: number;
  api_key_id_from?: string;
  api_key_id_to?: string;
  cooldown_ms: number;
  duration_ms: number;
  provider: string;
}
```

---

## File-by-File Changes

### 1. `src/utils/api_guard_middleware.ts`

| Change | Detail |
|--------|--------|
| Add `RetryEvent` interface | Exported interface with all retry metadata fields. |
| Modify `executeWithRetry` signature | Add optional `retryAccumulator: RetryEvent[] = []` parameter. |
| Record retry events | Before key rotation, push `RetryEvent` to accumulator with error details, old/new key IDs, cooldown, and elapsed time. |
| Add `getActiveKeyId(provider)` | Returns the `id` field of the active key config (currently only `key` is exposed). |
| Deterministic timeout label | Store timeout duration in retry event (hardcoded 120000 ms for now, since `llm_client.ts` owns the AbortController). |

### 2. `src/utils/agent_loop.ts`

| Change | Detail |
|--------|--------|
| Add micro-step accumulator | `const microSteps: MicroStep[] = []` at start of `executeMission` and pass through to task loop. |
| Instrument LLM call | Capture `systemPrompt`, `userPrompt`, `apiKeyId`, `attempt` count, `request_chars`, `estimated_tokens`. |
| Instrument LLM response | Capture `raw_text`, `char_count`, truncation flag. |
| Instrument decision parsing | Capture sanitized text, parsed JSON, parse errors. |
| Instrument skeleton injection | Capture cache hit/miss, file count, truncation length, success/failure. |
| Instrument validation phase | Map `decision.action` → schema name (see tool_dispatcher change); record validation status. |
| Instrument tool execution | Pass through `ToolResult.validation_error` and `ToolResult.schema_used`. |
| Instrument decision/observation/task-state DB ops | Use timed return values from Reporter (see #3). |
| Record reflection type | `'tool_action'` when action exists; `'null_action_continue'` when action is null; `'completion'` when MISSION/TASK_COMPLETE detected. |
| Record completion signal | `'TASK_COMPLETE'` or `'MISSION_COMPLETE'` in the matching micro-step. |
| Record state summaries | `buildStateSummary()` output before and after each step. |

### 3. `src/utils/reporter.ts`

| Change | Detail |
|--------|--------|
| `recordDecision` | Wrap `dbHelper.insertDecision` with `Date.now()`; return `{ decisionId, duration_ms }`. |
| `recordObservation` | Wrap `dbHelper.insertObservation`; return `{ observationId, duration_ms }`. |
| `updateTaskStateFile` | Time `loadTaskState`, `appendStep`, `saveTaskState` individually; return `{ state, duration_ms, load_ms, append_ms, save_ms }`. |
| Write methods | Time `PlaybookCompiler` calls; return path and `duration_ms`. |

### 4. `src/utils/tool_dispatcher.ts`

| Change | Detail |
|--------|--------|
| Extend `ToolResult` | Add optional `validation_error?: string` and `schema_used?: string`. |
| Capture Zod parse errors | Wrap each `schema.parse(...)` in try/catch; on failure return ERROR status with `validation_error` and `schema_used` before entering the switch. |
| Schema name map | Create a `schemas` object mapping each action to its schema variable name for human-readable logs. |

### 5. `src/utils/task_state_manager.ts`

No structural changes required. `agent_loop.ts` will read `state.steps.length` after `appendStep` to determine `task_state_step_id`.

### 6. `src/utils/interpreter.ts`

| Change | Detail |
|--------|--------|
| Propagate validation metadata | Add `validation_error` and `schema_used` to `ObservationResult` interface, populated from `ToolResult`. |

### 7. `src/utils/sys_inspect.ts`

| Change | Detail |
|--------|--------|
| Cache statistics | Add `getCacheStats()` to `SysInspect` class exposing hit/miss/entry counts. |
| Skeleton cache hit | Return `cache_hit` boolean inside `SkeletonResult`. |

### 8. `src/utils/execution_logger.ts` (new)

| Responsibility | Detail |
|----------------|--------|
| Post-mission log generation | Read DB, task-state files, reflection files, and in-memory `microSteps` to assemble final JSON. |
| Artifact hashing | Compute SHA-256 for technical reports, executive summaries, reflections, and task state files. |
| Environment fingerprint | Capture `node_version`, `pid`, `cwd`, sanitized `KORE_*` env vars, `tsconfig.json` target, git commits (project + workspace). |
| Reflection embedding | Read each `reflection_<taskId>.md` and embed content under `reflections_content[taskId]`. |
| Validation block | Check: reformulated missionId vs executed missionId, decision count matches tasks, artifact file counts, and emit `warnings` array. |
| Write to disk | `reports/missions/execution_log_<missionId>.json`. |

---

## New Execution Log Top-Level Shape

```json
{
  "mission_id": "...",
  "prompt": "...",
  "status": "COMPLETED",
  "started_at": "...",
  "completed_at": "...",
  "total_duration_ms": 298659,
  "reformulated_tool_chain": [...],
  "tasks": [...],
  "micro_steps": [...],
  "reflections_content": { "23": "...", "24": "..." },
  "artifacts": {
    "technical_reports": [...],
    "executive_summaries": [...],
    "reflections": [...],
    "task_states": [...],
    "hashes": { "technical": "...", "executive": "..." }
  },
  "environment": {
    "node_version": "v26.x",
    "pid": 12345,
    "cwd": "/Users/...",
    "env": { "KORE_DB_PATH": "...", "KORE_REPORTS_PATH": "..." },
    "ts_target": "ES2022",
    "project_git_commit": "...",
    "workspace_git_commit": "..."
  },
  "validation": {
    "reformulated_mission_id_matches_executed": false,
    "all_output_markers_checked": true,
    "missing_artifacts": [],
    "warnings": [ "..." ]
  },
  "database_records": {
    "mission_count": 1,
    "task_count": 2,
    "decision_count": 6,
    "observation_count": 2
  }
}
```

---

## Testing Criteria

1. Run `node --import tsx tests/run_mission_tests.js 01-social-media-content`
2. Open the new `execution_log_<missionId>.json`
3. Verify:
   - `micro_steps` array covers every loop iteration in both tasks
   - `llm_request.prompt` matches the exact prompt sent to Zhipu
   - `retry_events` is populated for any step that experienced an `AbortError` or rate limit
   - `validation_phase.schema_used` is present for every tool action
   - `reflection_type` is explicitly one of the three literals
   - Reflection file contents are embedded in `reflections_content`
   - `environment` block exists with version and path data
   - `validation.warnings` flags the reformulated-tool-chain missionId mismatch
   - `hashes` contains SHA-256 digests for all listed artifacts

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Large log file size from raw LLM I/O | Truncate stored text to 500 chars; log full char counts so original can be retrieved from task state. |
| Breaking `Reporter` API for external callers | Only `agent_loop.ts` calls these methods; change is internal and safe. |
| Timing noise from `Date.now()` resolution | Accept ~1ms granularity; sufficient for phases that take 5ms-225s. |
| Reflection files written by async `writeReflection` may not exist yet when log is generated | Ensure log generation runs after all `writeReflection` calls complete (they already do, because they happen before `executeMission` returns). |

---

## Files Changed Summary

| File | Change Type |
|------|-------------|
| `src/utils/api_guard_middleware.ts` | Modify |
| `src/utils/agent_loop.ts` | Modify |
| `src/utils/reporter.ts` | Modify |
| `src/utils/tool_dispatcher.ts` | Modify |
| `src/utils/interpreter.ts` | Modify |
| `src/utils/sys_inspect.ts` | Modify |
| `src/utils/execution_logger.ts` | New |
| `src/utils/task_state_manager.ts` | No change |
