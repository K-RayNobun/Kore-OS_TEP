# Kore OS TEP — Upgrade Plan: Long-Duration Autonomous Mission Engine

Date: 2026-07-10
Status: Ready for implementation
Saved to: `.kilo/plans/1783712346079-long-mission-engine.md`

---

## 1. Problem Statement

The current system is built around **short-lived, synchronous mission execution**:

- `AgentLoop.executeMission()` runs a single mission to completion in one async call. If the process crashes, the mission is lost. There is no way to resume.
- `runningMissions` is an in-memory `Map<string, { agentLoop }>()` (`src/index.ts:34`). A container restart wipes all state.
- `bootstrapAvailableTasks()` (`src/index.ts:272`) re-fires `PENDING` tasks on restart, but has no concept of what was running, partially complete, or interrupted.
- `handleSuspendedTaskEscalation()` (`src/index.ts:165`) implements a 30-minute hard timeout on `SUSPENDED` tasks, after which it pivots to a speculative git branch. This is an **escape hatch**, not a controlled interruption/resume mechanism.
- `IpcPipe` (`src/utils/ipc_pipe.ts`) fans out all frames to all connected sockets with no session ID multiplexing. Concurrent missions produce interleaved, uncorrelated telemetry.
- `ToolDispatcher.dispatchTool()` (`src/utils/tool_dispatcher.ts`) calls tools without a cancellation token or graceful-timeout contract. SIGKILL is the only interruption path, leaving sandbox state corrupt.
- No priority queue. `serviceManager.getAvailableTasks()` (`src/utils/database_helper.ts:80`) selects by dependency + status only.
- No recurring task registry. There is no table, scheduler, or injection mechanism for cron/interval-based tasks.
- Budget is a **single global boolean** (`ceilActive`) stored in `/home/elo/data/kore-vault/budget.json` (`src/server.ts:476`). It halts *all* missions, not specific ones.

The system cannot run for hours because it has **no persistence of execution state, no interruption protocol, no scheduler, and no priority-aware resource arbitration**.

---

## 2. Goals

1. **Mission checkpointing** — serialize AgentLoop state + sandbox state to SQLite every N seconds, enabling crash recovery and resume.
2. **Graceful interruption** — send SIGTERM to tool subprocesses, capture partial output, clean up sandbox, and record the interruption in `interruption_logs`.
3. **Priority-aware scheduling** — a persistent priority queue that can reorder tasks, preempt lower-priority missions, and partially suspend (not all-or-nothing) when `ceilActive` is toggled.
4. **Recurring task registry** — a `task_schedules` table with cron/interval support, independent budget allocation per schedule, and autonomous injection into the mission queue.
5. **Mission preemption** — checkpoint the running mission, release its budget and sandbox resources, and resume it later when capacity frees up or the operator re-enables it.
6. **Tool interruption contracts** — every tool declares `graceful_timeout_ms` and a `cleanup_fn` so the engine can interrupt safely without corrupting state.
7. **Budget pool with partial suspension** — replace the global boolean with a token/budget pool that can drain specific missions first.

---

## 3. Current State Audit

| Layer | File | Status |
|-------|------|--------|
| Unix socket IPC | `src/utils/ipc_pipe.ts` | Exists — no session IDs, no multiplexing |
| IPC inbound handler | `src/index.ts:309-318` | Exists — handles `human_directive` and `prompt_submit` only |
| IPC outbound | `src/index.ts` + `src/server.ts` | Exists — `thinking`, `tool_execution`, `mission_complete`, `intercept_start`, `artifact_manifest`, `state_change` |
| State machine | `src/utils/state_machine.ts` | Exists — global + per-mission, but lost on restart |
| SQLite schema | `src/utils/database_helper.ts` | Has `tasks`, `missions`, `decisions`, `observations`, `execution_logs`, `mission_artifacts`, `human_interventions` |
| AgentLoop | `src/utils/agent_loop.ts` | Exists — structured decisions, task state files, microSteps. Runs synchronously per task. No preemption hooks. |
| Tool dispatcher | `src/utils/tool_dispatcher.ts` | Exists — 16 actions, Zod validation, synchronous/async dispatch. No cancellation. |
| Suspension / escalation | `src/index.ts:165-198` | Exists — 30-min timeout, speculative branch pivot. No graceful stop. |
| Budget | `src/server.ts:471-494` | Global boolean in JSON file. No pool, no per-mission allocation. |
| Pivot/reconciliation | `src/index.ts:200-232` | Exists — handles speculative branch approval/rejection. No checkpoint. |
| PWA | not yet inspected; assumed partial | — |

---

## 4. Design Decisions

### 4.1 Checkpoint Format and Frequency

**Decision:** AgentLoop checkpoints are written to SQLite every 5 LLM-call iterations (configurable via `CHECKPOINT_INTERVAL_STEPS`) and on every state transition (`RUNNING` → `AWAITING_HUMAN`, `RUNNING` → `INTERRUPTED`).

**Checkpoint record schema** (`mission_checkpoints` table):

```sql
CREATE TABLE IF NOT EXISTS mission_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  task_id INTEGER,
  loop_iteration INTEGER,
  agent_state_json TEXT NOT NULL,       -- serialized AgentLoop state
  task_state_json TEXT NOT NULL,         -- full TaskStateFile JSON
  sandbox_state_json TEXT,               -- optional: open file handles, browser session IDs, temp dir paths
  token_snapshot_json TEXT,              -- { inputTokens, outputTokens, startedAt }
  budget_snapshot_json TEXT,             -- { allocated, consumed, ceilActive }
  interruption_reason TEXT,              -- null for routine checkpoints
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Rationale:** SQLite WAL mode already handles concurrent reads during writes. Writing a checkpoint is a single transaction. On resume, the engine reads the latest `mission_checkpoints` row for the mission, rehydrates `AgentLoop` with the saved state, and continues from the next iteration.

### 4.2 Session ID Multiplexing on IPC

**Decision:** Every `IpcFrame` sent over `/tmp/kore-os.sock` includes a `session_id` field. `IpcPipe` still fans out to all connected clients, but the Fastify gateway filters frames by `session_id` when routing to WebSocket clients.

New frame envelope:

```typescript
interface IpcFrame {
  session_id: string;   // e.g. "mission-abc123" or "schedule-def456"
  type: string;
  payload: Record<string, unknown>;
  timestamp?: string;
}
```

Backward compatibility: if `session_id` is missing, the frame is treated as a broadcast (all sessions receive it).

**Rationale:** Concurrent missions produce interleaved telemetry today. Without session IDs, the PWA cannot attribute a `thinking` frame to the correct mission. This is a prerequisite for priority-aware preemption.

### 4.3 Graceful Tool Interruption Contract

**Decision:** Every tool class exposes:

```typescript
interface ToolInterruptionContract {
  graceful_timeout_ms: number;   // max time to wait after SIGTERM before SIGKILL
  cleanup_fn?: (pid: number, tempPaths: string[]) => Promise<void>;
  validate_after_resume?: (state: Record<string, unknown>) => boolean; // post-interruption integrity check
}
```

The engine's `ToolRunner` wraps every tool invocation:

1. Spawns the tool in a child process (or manages its PID if the tool manages its own process).
2. On interrupt signal, sends SIGTERM.
3. Waits `graceful_timeout_ms`.
4. If still alive, sends SIGKILL.
5. Calls `cleanup_fn` (remove temp files, close browser sessions, stash git changes).
6. Records the interruption in `interruption_logs`.
7. On resume, calls `validate_after_resume` before re-attempting.

Tools currently missing this contract: `browser_automator` (zombie Chromium), `asset_optimizer` (corrupt FFmpeg output), `backup` (partial tarballs), `patch` (dirty worktree).

**Rationale:** Hours-long missions will be interrupted by operators, budget exhaustion, and container restarts. Without this contract, interruption leaves corrupt state that the agent cannot reason about.

### 4.4 Priority Queue and Mission Preemption

**Decision:** Replace `serviceManager.getAvailableTasks()` dependency-only selection with a **priority queue** backed by SQLite.

New table:

```sql
CREATE TABLE IF NOT EXISTS mission_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,          -- higher = more important
  budget_allocated_tokens INTEGER NOT NULL DEFAULT 50000,
  budget_consumed_tokens INTEGER DEFAULT 0,
  status TEXT DEFAULT 'QUEUED',                 -- QUEUED, RUNNING, PAUSED, COMPLETED, FAILED
  preempted_by TEXT,                            -- mission_id that caused preemption
  queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);
```

**Priority rules:**
- `ceilActive` toggle is replaced by `budget_pool_remaining_tokens`. When the pool is exhausted, the engine dequeues from lowest-priority running missions first, checkpoints them, and sets them to `PAUSED`.
- A newly submitted mission with higher priority than a running mission preempts the running one.
- When a `PAUSED` mission's budget is replenished (operator toggle, time-based refill, or higher-priority mission completion), it is re-enqueued and resumed from its latest checkpoint.

**Rationale:** A global boolean that halts *everything* is useless for mixed-importance workloads. An operator running a critical security audit should not be blocked by a marketing content pipeline consuming the same budget.

### 4.5 Recurring Task Registry

**Decision:** A `task_schedules` table decoupled from missions:

```sql
CREATE TABLE IF NOT EXISTS task_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT,                    -- null for global schedules
  name TEXT NOT NULL,
  cron_expr TEXT,                      -- e.g. "0 */6 * * *" (every 6 hours)
  interval_minutes INTEGER,            -- alternative to cron
  next_trigger_at DATETIME NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority_override INTEGER,           -- overrides default priority
  budget_allocated_tokens INTEGER DEFAULT 10000,
  last_status TEXT,                    -- SUCCESS, FAILED, SKIPPED
  last_run_at DATETIME,
  max_concurrent_runs INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

A `SchedulerDaemon` loop (inside `src/index.ts` or a new `src/utils/scheduler.ts`) polls `task_schedules` every 60 seconds, finds entries where `next_trigger_at <= NOW()`, injects a `PROMPT_SUBMIT` IPC frame with a derived `mission_id`, and updates `next_trigger_at` to the next trigger time.

Each scheduled run gets its **own budget allocation** drawn from the same budget pool. If the pool is exhausted, the scheduled task is skipped and `last_status = 'SKIPPED'`, with an IPC notification to the operator.

**Rationale:** The current system has no recurring capability. An operator cannot say "check system health every 4 hours" or "run the LinkedIn content pipeline every morning". This table makes that declarative and persistent.

### 4.6 Resource Lifecycle Management

**Decision:** The engine tracks and enforces resource limits per active mission:

- **Open file handles:** Each mission's sandbox tracks open file descriptors. On task completion or interruption, `ResourceGuard` closes all handles associated with the task.
- **Memory:** Periodic `global.gc()` triggers (if `--expose-gc` is set) or subprocess restarts every N tasks.
- **Inode cleanup:** On every task boundary, `purgeEngine` removes temp files older than 1 hour from `/tmp/kore-*`.
- **Log rotation:** `execution_logs` older than 30 days are archived to `execution_logs_archive` and the original rows are deleted. (New `execution_logs_archive` table with identical schema.)

**Rationale:** A container running for hours will exhaust inodes or file handles without explicit cleanup.

### 4.7 Checkpoint-Resume Protocol

**Decision:** The resume flow in `src/server.ts` is extended:

1. `POST /api/v1/missions/start` with `resumeFrom: "<mission_id>"` looks up the latest checkpoint.
2. If found, the engine rehydrates `AgentLoop` from `agent_state_json`, re-acquires sandbox resources (calls `validate_after_resume` on each tool), and continues from `loop_iteration + 1`.
3. If not found (no checkpoint exists), the mission starts fresh.
4. `POST /api/v1/jobs/resume` is renamed to `POST /api/v1/intervention/respond` and accepts `{ mission_id, task_id, approved }`. It sends an IPC `human_directive` frame with the `session_id` set to the mission ID.

---

## 5. Affected Files and Boundaries

| File | Role | Change Type |
|------|------|-------------|
| `src/utils/ipc_pipe.ts` | Unix socket JSON stream | Add `session_id` to `IpcFrame` type; `send()` accepts session_id; backward-compatible broadcast if missing |
| `src/utils/database_helper.ts` | SQLite access | Add `mission_checkpoints`, `mission_queue`, `task_schedules`, `interruption_logs`, `execution_logs_archive` tables + CRUD functions |
| `src/utils/state_machine.ts` | Per-mission state | Extend `EngineState` with `PAUSED`, `INTERRUPTED`, `CHECKPOINTING`; persist state to DB on every transition |
| `src/utils/agent_loop.ts` | Agent loop | Add `pause()` / `resume(checkpoint)` methods; emit `state_change` on checkpoint; serialize AgentLoop state |
| `src/index.ts` | Engine entry | Replace `runningMissions` Map with `mission_queue` DB reads; add `SchedulerDaemon`; add `BudgetPool`; add `InterruptionHandler`; add `ResourceGuard` |
| `src/server.ts` | Fastify gateway | Add `POST /api/v1/missions/start` resume logic; add `POST /api/v1/missions/:id/pause` and `POST /api/v1/missions/:id/resume`; session_id in IPC frames |
| `src/utils/tool_dispatcher.ts` | Tool routing | Accept `AbortSignal`; return `graceful_timeout_ms`; wrap tool calls in `ToolRunner` with SIGTERM + SIGKILL logic |
| `src/tools/browser_automator.ts` | Playwright automation | Add `graceful_timeout_ms = 15000`, `cleanup_fn` (close browser), `validate_after_resume` |
| `src/tools/asset_optimizer.ts` | FFmpeg optimization | Add `graceful_timeout_ms = 30000`, `cleanup_fn` (remove partial output), `validate_after_resume` (check file header) |
| `src/tools/backup.ts` | Backup tool | Add `graceful_timeout_ms = 60000`, `cleanup_fn` (remove partial tarball) |
| `src/tools/sandbox.ts` | Sandbox runner | Add `graceful_timeout_ms`, `cleanup_fn`, support for child_process PID tracking |
| `src/tools/patch.ts` | Patch tool | Add `cleanup_fn` (git stash if worktree dirty) |
| `src/utils/budget_pool.ts` | **New** | Token budget pool with per-mission allocation, partial suspension, refill logic |
| `src/utils/scheduler.ts` | **New** | Cron/interval scheduler polling `task_schedules`, injecting `PROMPT_SUBMIT` frames |
| `src/utils/interruption_handler.ts` | **New** | SIGTERM/SIGKILL dispatch, `cleanup_fn` orchestration, `interruption_logs` recording |
| `src/utils/checkpoint_manager.ts` | **New** | Serialize/deserialize AgentLoop state, TaskStateFile, sandbox state to/from `mission_checkpoints` |
| `src/utils/priority_queue.ts` | **New** | Priority-aware dequeuing, preemption logic, budget pool integration |
| `src/utils/resource_guard.ts` | **New** | File handle tracking, inode cleanup, periodic GC trigger |

---

## 6. Implementation Sequence

### Phase 1: Persistence Layer (no behavior change)

1. Add new SQLite tables: `mission_checkpoints`, `mission_queue`, `task_schedules`, `interruption_logs`, `execution_logs_archive`
2. Add `database_helper.ts` CRUD functions for all new tables
3. Add `session_id` to `IpcFrame` type; make `IpcPipe.send()` accept optional `session_id`; make gateway filter by `session_id`

**Validation:** Existing tests pass. New tables created on startup. `IpcPipe` backward-compatible (frames without `session_id` broadcast to all).

### Phase 2: Checkpoint & Resume

4. Create `checkpoint_manager.ts` — serialize/deserialize AgentLoop + TaskStateFile + sandbox state
5. Add `mission_checkpoints` writes to `AgentLoop.runTaskLoop()` every 5 steps and on `AWAITING_HUMAN`/`INTERRUPTED` transitions
6. Add `pause()` / `resume(checkpoint)` methods to `AgentLoop`
7. Extend `POST /api/v1/missions/start` to accept `resumeFrom` and rehydrate from checkpoint
8. Add `POST /api/v1/missions/:id/pause` gateway endpoint

**Validation:** Submit a mission, let it reach step 3, call pause, restart the process, call resume with `resumeFrom`, verify it continues from step 4.

### Phase 3: Budget Pool

9. Create `budget_pool.ts` — `allocate(mission_id, tokens)`, `consume(mission_id, tokens)`, `release(mission_id)`, `remaining()`, `exhausted()`
10. Replace global `budget.json` ceilActive with `budget_pool` table
11. On `exhausted()`, trigger preemption: checkpoint lowest-priority running mission, set to `PAUSED`
12. Add `POST /api/v1/budget/refill` endpoint

**Validation:** Run two missions with different priorities. Exhaust budget. Verify lower-priority mission is paused, higher-priority continues.

### Phase 4: Graceful Interruption

13. Create `interruption_handler.ts` — SIGTERM dispatch, SIGKILL fallback, `cleanup_fn` orchestration
14. Add `ToolInterruptionContract` interface; add `graceful_timeout_ms` + `cleanup_fn` to each tool
15. Wrap `ToolDispatcher.dispatchTool()` in `ToolRunner` with AbortSignal support
16. Add `interruption_logs` recording

**Validation:** Start a long-running FFmpeg optimization, trigger interruption via API, verify partial output is cleaned up, verify engine recovers cleanly.

### Phase 5: Priority Queue and Preemption

17. Create `priority_queue.ts` — select next mission from `mission_queue` by priority, respect `PAUSED` missions
18. Replace `bootstrapAvailableTasks()` with priority queue scan on startup
19. Add `POST /api/v1/missions/submit` with `priority` and `budget_tokens` body fields
20. Wire `budget_pool.exhausted()` to preemption via priority queue

**Validation:** Submit high-priority mission while low-priority mission runs. Verify low-priority mission is checkpointed and paused, high-priority mission starts. Verify low-priority resumes when budget refills.

### Phase 6: Recurring Scheduler

21. Create `scheduler.ts` — poll `task_schedules`, inject `PROMPT_SUBMIT` frames, update `next_trigger_at`
22. Add gateway endpoints for `task_schedules` CRUD (or use MCP tool registration)
23. Budget isolation per schedule entry (drawn from same pool, but tracked separately)

**Validation:** Create a schedule that fires every 2 minutes. Verify missions are injected automatically. Verify `last_run_at` updates. Verify skip when budget exhausted.

### Phase 7: Resource Lifecycle

24. Create `resource_guard.ts` — file handle tracking, temp file cleanup, GC trigger
25. Hook `resource_guard.cleanup_task(task_id)` into task completion and interruption flows
26. Add `execution_logs_archive` + auto-rotation logic

**Validation:** Run a mission that opens 100+ files. Verify handles are closed after each task. Verify temp dirs are cleaned. Verify old logs are archived.

### Phase 8: PWA Integration

27. Add priority/preemption controls to PWA (pause mission, resume mission, adjust priority, set budget refill)
28. Add recurring task schedule UI
29. Add session-scoped cognition/intervention WebSocket filtering (filter by `session_id`)

**Validation:** Operator pauses a mission from PWA, starts a higher-priority mission, observes preemption in real-time via WebSocket, resumes paused mission from PWA.

---

## 7. Failure Modes and Mitigations

| Failure Mode | Mitigation |
|--------------|------------|
| Container restart during LLM call | Checkpoint written every 5 steps; on restart, resume from latest checkpoint |
| Tool hung (no output for N seconds) | `graceful_timeout_ms` enforced by `InterruptionHandler`; SIGTERM + cleanup |
| Budget pool exhausted with no lower-priority mission to pause | Operator notified via IPC `budget_exhausted` frame; mission stays `QUEUED` until refill |
| Checkpoint write fails (disk full, DB locked) | Engine retries with backoff; if still failing, aborts mission gracefully and records in `interruption_logs` |
| Corrupt checkpoint JSON | Engine validates JSON schema on read; if invalid, discards and starts mission fresh, logging a warning |
| Sandbox temp files accumulate across hours | `ResourceGuard` runs cleanup on every task boundary; 1-hour TTL on `/tmp/kore-*` |
| Concurrent missions produce interleaved logs | `session_id` on all IPC frames; PWA filters by mission |
| Cron schedule fires while engine is restarting | Scheduler checks engine state before injection; if engine not ready, skips and logs |

---

## 8. Validation Plan

### Unit Tests

- `checkpoint_manager.ts` — serialize/deserialize round-trip, corrupt JSON handling
- `budget_pool.ts` — allocate, consume, release, preemption trigger
- `priority_queue.ts` — dequeuing order, preemption of lowest-priority
- `scheduler.ts` — cron parsing, next_trigger_at calculation, skip-when-budget-exhausted
- `interruption_handler.ts` — SIGTERM → SIGKILL escalation, cleanup_fn execution
- `resource_guard.ts` — temp file cleanup, file handle tracking

### Integration Tests

1. **Checkpoint-resume cycle:** Submit mission → let it run 3 steps → pause → restart process → resume → verify it continues from step 4
2. **Budget exhaustion preemption:** Submit mission A (priority 1, 5000 tokens) and mission B (priority 10, 50000 tokens). Set pool to 10000 tokens. Verify A pauses, B runs, A resumes after B completes and pool refills.
3. **Graceful interruption:** Start FFmpeg optimization (30s encode) → call interrupt API at 5s → verify partial file removed → verify engine recovers → verify interruption logged in `interruption_logs`
4. **Recurring schedule:** Create schedule (every 60s) → wait 120s → verify 2 missions auto-injected → verify budget tracked per run
5. **Resource cleanup:** Run 50 tasks in a loop → verify `/tmp/kore-*` count does not grow unbounded → verify `execution_logs` size stays bounded

### Load Test

Run a synthetic 8-hour mission (50 tasks, each with 2-3 AgentLoop iterations) and verify:
- Memory does not grow unbounded (GC or subprocess restart effective)
- Disk inodes do not exhaust
- Checkpoint file size stays under 1MB per mission
- WebSocket telemetry latency stays under 200ms per frame

---

## 9. Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Where does the `SchedulerDaemon` live? | Inside `src/index.ts` alongside existing code, or new `src/utils/scheduler.ts` invoked from `index.ts`? | New file `scheduler.ts` for separation of concerns; bootstrapped from `index.ts` |
| Should `AgentLoop` be extended in-place or wrapped? | Extend `AgentLoop` class with `pause()`/`resume()` methods vs. wrap it in a `MissionRunner` facade | Extend `AgentLoop` in-place — fewer indirections, the class is already the state owner |
| Should budget pool persistence be SQLite or file-based? | SQLite (`budget_pool` table) vs. JSON file (current approach) | SQLite — consistent with the rest of the state layer, survives crashes |
| Should tool interruption be per-tool-process or centralized? | Each tool spawns its own child process with a PID we track vs. `ToolRunner` wraps the existing tool class | `ToolRunner` wraps the existing class; if the tool internally spawns a child, it must expose the PID via the contract. This is a tool-by-tool migration. |
| Should `task_schedules` use cron or interval? | Cron expressions only, interval minutes only, or both? | Both — `cron_expr` and `interval_minutes` columns; if both set, cron takes precedence |
| Should the PWA control `ceilActive` globally or per-mission? | Global toggle (current behavior) vs per-mission toggle in `mission_queue` | Per-mission — the global toggle is retained as a "pause all non-critical" emergency brake, but normal operation is per-mission |

---

## 10. Out of Scope

- Multi-node / distributed execution (single container only)
- Human-in-the-loop for tool selection (operator can approve/reject tasks, but cannot rewrite tool parameters mid-loop)
- Persistent sandbox (each task gets a fresh or explicitly specified sandbox directory)
- LLM provider switching at runtime (Gemini/Zhipu hardcoded in `ApiGuardMiddleware`)
- PWA push notifications (the `/api/v1/push/subscribe` endpoint exists but is not upgraded)

---

## 11. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Checkpoint serialization loses state fidelity | Medium | High | Round-trip test suite; schema versioning in `mission_checkpoints` |
| SIGTERM does not reach FFmpeg/Playwright child processes | Medium | High | Use `child_process.execFile` with explicit `pid` tracking; use `process.kill(-pid)` for process group kill |
| Budget pool starvation causes all missions to pause | Medium | Medium | Minimum reserve (10% of pool) that cannot be allocated; emergency refill endpoint |
| `task_schedules` polling misses triggers if engine is busy | Low | Medium | Poll every 30s (not 60s); `next_trigger_at` is computed, not drifted |
| Zombie file handles from interrupted browser sessions | Medium | High | `cleanup_fn` in `browser_automator` must kill Chromium child processes explicitly |
| SQLite WAL grows unbounded with hours of checkpoints | Medium | Medium | `PRAGMA wal_checkpoint(TRUNCATE)` on every checkpoint write |

---

## 12. Summary of New Files

| File | Purpose |
|------|---------|
| `src/utils/checkpoint_manager.ts` | Serialize/rehydrate AgentLoop, TaskStateFile, sandbox state to/from `mission_checkpoints` |
| `src/utils/budget_pool.ts` | Per-mission token budget with allocation, consumption, release, and preemption trigger |
| `src/utils/scheduler.ts` | Cron/interval poller that injects `PROMPT_SUBMIT` frames for `task_schedules` |
| `src/utils/interruption_handler.ts` | SIGTERM→SIGKILL escalation, cleanup orchestration, `interruption_logs` recording |
| `src/utils/priority_queue.ts` | Priority-aware mission dequeuing, preemption logic |
| `src/utils/resource_guard.ts` | File handle tracking, temp file cleanup, periodic GC trigger |

---

## 13. Migration Path

1. Deploy new tables alongside existing ones (all `CREATE TABLE IF NOT EXISTS`). No schema migration needed.
2. Deploy new code. Existing REST endpoints and IPC frame types are backward-compatible.
3. Operator enables `budget_pool` mode via `POST /api/v1/telementry/budget` or config flag. Old `budget.json` is read once at boot and imported into `budget_pool` if present.
4. `task_schedules` starts empty. Operator populates it via gateway or MCP tool.
5. Old `runningMissions` Map is replaced by `mission_queue` reads. No data migration needed (in-memory state is ephemeral by design).
6. `execution_logs` rotation runs as a background job; old logs are archived, not deleted.
