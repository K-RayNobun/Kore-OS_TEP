# Kore OS TEP — Full Project Documentation

> **Audience:** Expert reviewer (engineering examination).
> **Scope:** This document presents the Kore OS TEP project end-to-end — its concept, architectural
> pillars, runtime topology, and a module-by-module account of the technical implementation as it
> exists in the source tree. It is built from a direct reading of the source (`src/**`), the
> gateway (`src/server.ts`), the PWA (`src/pwa/**`), the container definitions, and the project's
> own design notes (`PROJECT_MAP.md`, `SECOND_UPGRADE_SUMMARY.md`, `NEW_FEATURE_CHANGE.md`,
> `FRONTEND_*.md`, `BACKEND_CONTRACT*.md`, `context_informant.md`, `admin_identity_v2.md`,
> `kore_controller_wpa.md`).
> **Convention used below:** `path:line` references point at the file and approximate region that
> backs each statement so the reviewer can verify quickly.

---

## 0. What this document reports (information inventory)

Before describing the system, here is the explicit set of facts the document must convey for a
complete expert review:

1. **What the product is** — a name, a one-paragraph definition, and the problem it solves.
2. **The governing concept / philosophy** — the "Sovereign Admin Engine" identity, the output
   contract, the priority hierarchy, and the Tri-Masterclass Context Protocol (TMCP).
3. **Runtime topology** — the three cooperating processes (PWA, Gateway, Engine) and how they
   communicate (REST, WebSocket, Unix-socket IPC).
4. **Conceptual pillars** — autonomy, context economy, safety, auditability, human-in-the-loop,
   resource governance, and the state machine.
5. **Technical implementation**, organized as:
   - boot / runtime entry,
   - the IPC protocol and its frame schema,
   - the Fastify gateway (REST + WebSocket surface),
   - the autonomous engine core (AgentLoop → Interpreter → ToolDispatcher → Reporter),
   - LLM integration and the API-guard key pool,
   - the tool suite,
   - the sandbox & security layer,
   - the SQLite data model,
   - mission orchestration (priority queue, scheduler, checkpoints, realization engine),
   - the PWA front-end,
   - the container / infrastructure hardening.
6. **Configuration & environment** — env vars, key pool, volume layout.
7. **API contract summary** — endpoints, WebSocket frames, auth model.
8. **File inventory / project map.**
9. **Honest gap analysis** — inconsistencies between the design docs, the contract, and the code,
   plus stubbed/partial areas an examiner must know about.
10. **Build & run** instructions.

---

## 1. Concept

### 1.1 Definition

**Kore OS TEP** is a self-hosted, autonomous "sovereign administrative engine." It is a hardened,
containerized Node.js system that accepts a high-level natural-language *mission* from an operator
(via a mobile/PWA control center), decomposes that mission into a chain of tool-driven tasks, and
executes them on the host — scraping the web, running sandboxed binaries, patching files, producing
marketing content, taking backups, and writing audit-grade reports — while streaming its reasoning
and telemetry back to the operator in real time and pausing to request human help when it hits a
CAPTCHA, 2FA wall, or missing information.

The suffix **TEP** is the project codename; the engine persona calls itself the **Kore OS Admin
Engine** and treats every emission as a *system artifact* and every action as *auditable*
(`admin_identity_v2.md`, `src/prompts/agent_system_prompt.ts`).

### 1.2 The "Sovereign Admin Engine" identity

The design is deliberately **not** a conversational chatbot. `admin_identity_v2.md` defines a
deterministic orchestration core with a strict output contract:

- A **tool decision** is exactly `{ "thought", "action", "parameters" }`.
- A **reflection / completion** is exactly `{ "thought", "action": null }`.
- No markdown, no code fences, no filler, no invented actions.
- Termination is signalled by the literals `TASK_COMPLETE` / `MISSION_COMPLETE` inside `thought`.

The **priority hierarchy** (`admin_identity_v2.md`) is fixed and non-negotiable when constraints
conflict:

1. Safety / security
2. Determinism
3. Auditability
4. Correctness
5. Minimality

The **core rules** are: safety guards are absolute; never guess (halt and await human input);
no blind retries (diagnose after one failure); no uncommitted mutations (every file change ends in
a Git commit linked to a decision); external data is hostile (sanitize); and the task state file is
the only memory between reasoning steps.

### 1.3 Tri-Masterclass Context Protocol (TMCP)

The hardest design constraint is **token economy**: keep each reasoning step's context small
(target < ~1 000 tokens) while supporting multi-step, long-running missions
(`context_informant.md`). TMCP manages context like an OS manages memory:

- **Mission → Tasks → Implications.** A mission is split into tasks; each task is a recursion loop
  of *implications* — single cognitive invocations typed as `PLANNING` (reflect/pivot, no mutation)
  or `TOOL_CALL` (sandbox, filesystem, web).
- **Structural skeletons (M1).** At task boot, the engine generates an ultra-compact AST map of the
  code tree (imports, classes, interfaces, function signatures) instead of ingesting raw source
  (`src/utils/sys_inspect.ts`).
- **Sliding breadcrumb buffer (M3).** The last *N* intent entries from the SQLite log form a
  chronological timeline of recent thought (`src/utils/sys_inspect.ts:appendBreadcrumb`,
  `src/utils/task_state_manager.ts`).
- **Just-In-Time internal inspection.** A single unified `sys_inspect` utility pages precise content
  into context on demand (`skeleton`, `grep_logs`, `read_db`, `append`, `paged`).
- **Implication deduplication / forgetting.** Results of `(tool, params, environment)` are hashed
  and cached for a TTL so identical implications are not re-derived (`src/utils/implication_store.ts`,
  `implication_hashes` table in `src/utils/database_helper.ts`).

### 1.4 Why it exists (the operator story)

The operator runs the engine on a VPS, opens the **Kore OS Control Center** PWA on a phone, and:

- watches a live "thinking feed" of the engine's intent,
- launches new missions by typing goals,
- downloads the artifacts (PDFs, CSVs, markdown reports) the engine produces,
- and is prompted to solve CAPTCHAs / approve decisions through an interactive overlay.

This is the "write-and-execute control center" vision (`FRONTEND_NEW_FEATURES_CHANGES.md`).

---

## 2. Runtime topology

```
┌──────────────────────────────────────────────────────────────┐
│                  KORE OS CONTROL CENTER (PWA)                 │
│   src/pwa/*  — vanilla TS/JS, service worker, manifest       │
│   Browser: HTTPS REST + WebSocket (token auth)               │
└───────────────────────────▲──────────────────────────────────┘
                             │  REST + WS   (X-Kore-Core-Token / Bearer)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│           SERVER.TS — Fastify Edge Gateway Daemon             │
│   REST API · WebSocket rooms (cognition / intervention)      │
│   IPC client to /tmp/kore-os.sock · SQLite reads             │
│   Serves /pwa, /interactive, artifact downloads              │
└───────────────────────────▲──────────────────────────────────┘
                             │  Line-delimited JSON over Unix socket
                             ▼
┌──────────────────────────────────────────────────────────────┐
│              INDEX.TS — Core Agentic Engine (MCP)             │
│   AgentLoop · ToolDispatcher · Reporter · StateMachine       │
│   BudgetPool · PriorityQueue · Scheduler · InterruptionHandler│
│   Writes audit trail to SQLite (WAL) · spawns isolated tools │
└──────────────────────────────────────────────────────────────┘
```

Three processes, two trust boundaries:

- **PWA ↔ Gateway** — network (HTTPS/WS), authenticated by a shared core token.
- **Gateway ↔ Engine** — local only, over the Unix domain socket `/tmp/kore-os.sock`
  (`IPC_SOCKET_PATH` in `src/utils/ipc_pipe.ts:6`). The browser never touches the engine directly.

> **Note on the design docs:** `kore_controller_wpa.md` describes the PWA as "Next.js Static /
> Vite + React," but the shipped implementation is a **vanilla TypeScript single-page app**
> (`src/pwa/app.ts` → `app.js`, plus `index.html`, `styles.css`, `sw.js`, `manifest.json`). See
> §9.

---

## 3. Conceptual pillars (mapped to code)

| Pillar | Concept | Primary implementation |
|--------|---------|------------------------|
| Autonomy | Self-driving mission loop with structured decisions | `src/utils/agent_loop.ts`, `src/utils/interpreter.ts`, `src/utils/tool_dispatcher.ts` |
| Context economy (TMCP) | Small context, JIT paging, implication cache | `src/utils/sys_inspect.ts`, `src/utils/implication_store.ts`, `src/utils/task_state_manager.ts` |
| Safety-first | Path/SSRF/binary/arg guards | `src/utils/security_guard.ts`, `src/utils/network_guard.ts`, `src/tools/binary_inspector.ts`, `src/utils/command_validator.ts`, `src/tools/sandbox.ts` |
| Auditability | Every decision/observation/state persisted | `src/utils/reporter.ts`, `src/utils/database_helper.ts`, `reports/missions/**` |
| Human-in-the-loop | Block & request help | `src/utils/captcha_interceptor.ts`, `src/utils/interruption_handler.ts`, `handleSuspendedTaskEscalation` in `src/index.ts:179` |
| Resource governance | Token budget, priority, preemption, interruption | `src/utils/budget_pool.ts`, `src/utils/priority_queue.ts`, `src/utils/scheduler.ts`, `src/utils/resource_guard.ts` |
| State machine | Global + per-mission lifecycle | `src/utils/state_machine.ts` (`IDLE/RUNNING/AWAITING_HUMAN/COMPLETED`) |

---

## 4. Technical implementation

### 4.1 Runtime entry & boot (`src/index.ts`)

`src/index.ts` is both the **MCP stdio server** (via `@modelcontextprotocol/sdk`) and the
autonomous engine supervisor. On `main()` (`src/index.ts:483`):

1. `dbHelper.ensureSchema()` creates the SQLite schema; `MigrationRunner` applies pending migrations
   (`src/utils/migrations.ts`).
2. `registerInterruptionContracts()` registers per-tool graceful-shutdown contracts
   (`src/index.ts:393`).
3. A `Heartbeat` is started (`src/utils/heartbeat.ts`) for telemetry streaming.
4. The `IpcPipe` server is started and an `onIncoming` handler is attached that dispatches inbound
   frames: `human_directive`, `prompt_submit`, `mission_pause`, `mission_resume`, `budget_refill`
   (`src/index.ts:496`).
5. The MCP `StdioServerTransport` is connected; the gateway (separate process) talks to this engine
   through the socket, not stdio.
6. `scheduler.start()` begins the 30 s schedule poll; `resumeInterruptedMissions()` replays paused
   missions from the `mission_queue`; `bootstrapAvailableTasks()` kicks legacy tasks.

The engine registers 16 tools on the `McpServer` (`src/index.ts:94-108`) plus a legacy
`executeTask` tool. The **new autonomous path** is `prompt_submit` → `handlePromptSubmit`
(`src/index.ts:335`) → `AgentLoop.executeMission`.

### 4.2 IPC layer (`src/utils/ipc_pipe.ts`, `src/utils/ipc_frame_schema.ts`)

- `IpcPipe` opens a `net.Server` on `/tmp/kore-os.sock`, unbinding any stale socket first
  (`src/utils/ipc_pipe.ts:17`). Frames are **line-delimited JSON**; each inbound frame is ack/nak'd
  and tagged with `session_id` + `correlation_id` (`src/utils/ipc_pipe.ts:58`).
- `ipc_frame_schema.ts` defines a **Zod union** of every frame type: `prompt_submit`,
  `human_directive`, `mission_pause/resume`, `budget_refill`, `thinking`, `tool_execution`,
  `state_change`, `intervention_request`, `artifact_manifest`, `telemetry_response`,
  `mission_complete`, `telemetry_heartbeat`, `ack`, `nak`. `validateFrame()` returns `null` on
  invalid frames.
- The engine broadcasts with `ipcPipe.sendTo(frame, sessionId)` so the gateway can route frames to
  the correct operator session.

### 4.3 Gateway (`src/server.ts`)

A Fastify daemon exposing the operator surface. Key points:

- **Auth hook** (`src/server.ts:84`): every request (except `PUBLIC_PATHS = ["/interactive"]`) must
  carry `X-Kore-Core-Token` matching `KORE_CORE_TOKEN`, else `401`.
- **CORS** allows `KORE_CORS_ORIGIN` (default `http://localhost:5173`) and `:3000`, and the
  `X-Kore-Core-Token` header.
- **Two WebSocket rooms** (`src/server.ts:504`, `:519`):
  - `/api/v1/stream/cognition` → sends `{ intent, rationale }` frames (latest replaces previous).
  - `/api/v1/stream/intervention` → sends typed `{ type, payload }` frames
    (`state_change`, `intervention_request`).
- **IPC client** (`src/server.ts:557`): connects to the socket, auto-reconnects (1 s backoff), and
  on each frame updates telemetry counters, ingests the `CaptchaInterceptor`, and fans frames out to
  the appropriate WS room. Critically, it filters so only `thinking` frames become cognition frames
  (`src/server.ts:590`) — directly addressing the mismatch documented in
  `BACKEND_CONTRACT_VALIDATION.md`.
- **Static PWA & interactive page** served from `src/pwa/*` and `/interactive`
  (`src/server.ts:468`).

### 4.4 Engine core: AgentLoop → Interpreter → ToolDispatcher → Reporter

**`AgentLoop` (`src/utils/agent_loop.ts`)** is the brain:

- `executeMission(prompt, missionId?)` (`agent_loop.ts:75`) first runs a `PromptReformulator`
  (`src/utils/prompt_reformulator.ts`) to turn the free-text prompt into a deterministic
  `tool_chain`. If validation fails, it writes a technical report and returns blocked.
- Otherwise it creates a `missions` row, sets state `RUNNING`, then loops over each tool-chain task,
  calling `runTaskLoop` per task (`agent_loop.ts:114`).
- `runTaskLoop` (`agent_loop.ts:224`) is the observation→thought→action loop, capped at
  `maxStepsPerTask` (50):
  1. On step 1, inject a code **skeleton** via `sys_inspect` (TMCP M1).
  2. Build the system prompt from `buildAgentSystemPrompt(getAvailableActions())` and the current
     task-state summary.
  3. **Implication cache**: compute a hash key; if cached, skip the LLM call (`agent_loop.ts:279`).
  4. Otherwise call **Zhipu** (`glm-4.5-flash`) through `apiGuard.executeWithRetry`.
  5. Parse the structured decision; detect `TASK_COMPLETE`/`MISSION_COMPLETE`.
  6. If `action` is null → record a reflection, append a breadcrumb, optionally checkpoint, continue.
  7. If `action` present → `Interpreter.interpret` → `ToolDispatcher.dispatchTool` → `Reporter`
     records decision + observation + task-state update, and emits `thinking` / `tool_execution`
     IPC frames.
- `checkpointManager.writeCheckpoint` is called every 5 steps and on completion
  (`agent_loop.ts:509`, `:628`).

**`Interpreter` (`src/utils/interpreter.ts`)** is a thin router: given a decision with an `action`,
it calls `dispatchTool(action, parameters)` and normalizes the result into an `ObservationResult`.

**`ToolDispatcher` (`src/utils/tool_dispatcher.ts`)** is the capability registry:

- `ToolAction` is a closed union of 16 action names (`tool_dispatcher.ts:14`).
- A `schemaMap` binds each action to a **Zod schema** (`tool_dispatcher.ts:148`). Unknown actions or
  schema violations are rejected *before* any tool runs.
- `dispatchTool` (`tool_dispatcher.ts:185`) validates, then switches to the matching tool instance,
  returning a `ToolResult { status, output, error, executionTimeMs, schema_used }`.
- `getAvailableActions()` returns the action catalogue injected into the LLM system prompt.

**`Reporter` (`src/utils/reporter.ts`)** is the audit sink: it inserts into `decisions`,
`observations`, and the per-task state file (`reports/missions/tasks/task_{id}.json`), and delegates
report writing to `PlaybookCompiler`.

### 4.5 LLM integration & API guard (`src/utils/llm_client.ts`, `src/utils/api_guard_middleware.ts`)

- Two providers are supported: **Gemini** (`gemini-2.5-flash-lite`) and **Zhipu** (`glm-4.5-flash`
  at `https://api.z.ai/api/paas/v4/chat/completions`). Both use `fetch` — no SDK
  (`src/utils/llm_client.ts`).
- `ApiGuardMiddleware` (`api_guard_middleware.ts`) loads `config/api_pool.json`
  (`{ providers: { gemini:[...], zhipu:[...] }, default_cooldown_ms }`), supports key rotation,
  context truncation (`optimizePayloadContext`), and `executeWithRetry` that rotates keys on
  `429/503`/abort and records `RetryEvent`s.
- Token estimation is `ceil(chars/4)`; `gatePromptByTokenBudget` enforces the ~1 000-token gate used
  by TMCP.

> **Important honesty note:** `src/index.ts:82 callModelGenerativeLoop` is a **stub** that returns
> `"Simulated successful generation pass."` and the `realization_engine.ts` LLM calls are also
> stubbed. The **real** model path used by missions is `AgentLoop` calling Zhipu
> (`agent_loop.ts:308`). See §9.

### 4.6 Tool suite (`src/tools/*`, dispatched via §4.4)

Each tool is a class with a `register*Tool(server)` MCP wrapper (called from `index.ts`) and is also
reachable programmatically through `ToolDispatcher`.

| Action | Tool class | What it does |
|--------|-----------|--------------|
| `GET_SYSTEM_TELEMETRY` | `TelemetryTool` | CPU/mem/load via `/proc` + `node:os` |
| `EXECUTE_SANDBOX_COMMAND` | `SecureSandbox` | Runs a binary in `SandboxRunner` with timeout + path validation |
| `PATCH_FILE_DIFF` | `PatchTool` | Surgical search/replace of file text (path-guarded) |
| `MANAGE_BACKGROUND_SERVICE` | `ServiceManager` | OpenRC/process `status/start/stop/restart/kill`; emits `taskCompleted` |
| `AUDIT_NETWORK_SOCKETS` | `NetworkAudit` | `netstat`-style TCP/UDP scan |
| `STAGE_SECURE_BACKUP` | `BackupTool` | Timestamped `.tar.gz` to `/var/backups/elo-tep` (path from SecurityGuard) |
| `INSPECT_BINARY_METADATA` | `BinaryInspector` | `file`/`ldd`/`strings`; rejects threat strings |
| `OPTIMIZE_MARKETING_ASSETS` | `AssetOptimizer` | FFmpeg with whitelisted profile args (`command_validator.ts`) |
| `WRITE_TECHNICAL_REPORT` | `PlaybookCompiler` | Appends to `reports/missions/technical/...` |
| `WRITE_EXECUTIVE_REPORT` | `PlaybookCompiler` | Overwrites executive summary |
| `WRITE_REFLECTION` | `PlaybookCompiler` | Writes `reflection_{taskId}.md` |
| `EXECUTE_BROWSER_FLOW` | `BrowserAutomator` | Playwright Chromium, isolated persistent context, SSRF-validated URL |
| `LOG_CAMPAIGN_METRICS` | `MetricsLedger` | Inserts campaign rows + computed score into `marketing_metrics.db` |
| `RECORD_GIT_MILESTONE` | `MetricsLedger` | Logs Git milestone telemetry |
| `REFORMULATE_PROMPT` | `PromptReformulator` | Turns raw prompt into tool chain (also called inside AgentLoop) |
| `SYS_INSPECT` | `sysInspect` | Unified context instrument (skeleton/grep/read_db/append/paged) |

`PromptReformulator` (`src/utils/prompt_reformulator.ts`) is a rule-based classifier
(`social_media_content`, `browser_flow`, `asset_optimization`, `backup_operation`,
`code_implementation`, `metrics_logging`, `multi_step_mission`, `unknown`) that emits a tool chain
with `output_marker`s. It is heuristic and prompt-keyword driven — not an LLM.

### 4.7 Sandbox & security layer

Defense is architectural, not post-hoc:

- **`SecurityGuard`** (`security_guard.ts`): `validateAndResolvePath` accepts only roots under
  `/home/elo/workspace`, `/home/elo/data`, `/tmp`, `/home/elo/.local/share/browser-context`.
  `scanContentRisk` rejects `rm -rf`, `nc -e`, `wget`, `curl ...|`. `sanitizeIngestedText` strips
  script tags and tactical prompt-injection terms.
- **`NetworkGuard`** (`network_guard.ts`): SSRF protection — only `http/https`, blocks loopback,
  private ranges (`10.`, `192.168.`, `172.16-31`), link-local `169.254.*`, and cloud metadata
  endpoints (`169.254.169.254`, `metadata.google.internal`).
- **`SandboxRunner`** (`sandbox_runner.ts`): spawns with `shell:false`, restricted `env`
  (`PATH=/usr/bin:/bin`, `HOME=/tmp`), a CPU-time kill timer, temporary dir cleanup, and
  process-tree kill on timeout. `applyRlimits` is a no-op placeholder today.
- **`BinaryInspector`**: refuses to load binaries containing dangerous strings.
- **`CommandValidator`**: JSON-Schema-style whitelist of FFmpeg args; no pipes/shell expansion.
- **Container hardening** (§4.11): non-root `elo` user, `no-new-privileges`, seccomp, dropped caps,
  read-only root FS, `tmpfs`.

### 4.8 Data model (SQLite, WAL)

`src/utils/database_helper.ts` opens `KORE_DB_PATH` (default `/home/elo/data/tasks.db`) with
`PRAGMA journal_mode = WAL; synchronous = NORMAL; foreign_keys = ON`
(`database_helper.ts:13`). Migrations are additive and idempotent (`ensureSchema` uses
`PRAGMA table_info` guards before `ALTER TABLE`).

Tables:

- `tasks` — `id, name, status, dependency_id, priority, logic_branch, mission_id,
  technical_report_path, executive_report_path, updated_at`. Statuses: `PENDING/RUNNING/DONE/
  SUSPENDED/FAILED`.
- `missions` — `id, prompt, status, created_at, completed_at`.
- `decisions` — `id, mission_id, task_id, thought, action, parameters_json, created_at` (full audit
  trail of AI choices).
- `observations` — `id, decision_id, status, output_json, execution_time_ms` (tool results).
- `execution_logs` (+ `_archive`) — phase/status/IO/error/duration/`token_delta`.
- `human_interventions` — `id, task_id, type, status, payload, resolution, resolved_at`.
- `mission_artifacts` — `id, mission_id, task_id, file_name, file_path, file_size, mime_type`.
- `mission_checkpoints` — `mission_id, task_id, loop_iteration, agent_state_json,
  task_state_json, …` (resume support).
- `mission_queue` — scheduling/priority/budget state per mission.
- `task_schedules` — cron/interval-based recurring missions.
- `interruption_logs` — who/what/why a mission was interrupted.
- `implication_hashes` — TMCP result cache with `expires_at` TTL.
- `schema_version` — migration ledger.

A **second** SQLite (`/home/elo/data/marketing_metrics.db`, `MetricsLedger`) holds `campaigns` and
`git_pipeline_telemetry`.

### 4.9 Mission orchestration & resilience

- **`PriorityQueue`** (`priority_queue.ts`): enqueues missions, selects the highest-priority
  runnable one, supports **preemption** of lower-priority running missions, and gates starts on
  budget.
- **`BudgetPool`** (`budget_pool.ts`): a pool of `KORE_BUDGET_POOL_TOKENS` (default 100 000) with a
  10% reserve ratio; `allocate` can refuse; `gateMissionSpawn` enforces the "hard ceiling" that
  pauses new spawns when exhausted.
- **`SchedulerDaemon`** (`scheduler.ts`): every 30 s fires enabled `task_schedules`
  (cron or interval) as `prompt_submit` frames (`cron-parser` dependency).
- **`InterruptionHandler`** (`interruption_handler.ts`): graceful SIGTERM→SIGKILL of tracked tool
  PIDs with per-tool `cleanup_fn` contracts; writes interruption + checkpoint records; supports
  human reject → mission interrupt.
- **`CheckpointManager`** (`checkpoint_manager.ts`): serializes agent + task state every 5 steps so
  a crashed mission resumes from `mission_checkpoints` (`priority_queue.ts:37`).
- **`RecursiveRealizationEngine`** (`realization_engine.ts`): for `Code`/`Implement` tasks, runs a
  test-and-patch loop (max 10 iterations) — `npm run build` in the sandbox, then an LLM-generated
  patch, then a "safe-brake" reflection on failure.
- **`EphemeralContentPurgeEngine`** (`purge_cleaner_engine.ts`): on mission finalize, recursively
  clears `reports/missions/scraped`, browser contexts, and `/tmp/downloads`.
- **`ResourceGuard`** (`resource_guard.ts`): periodic 5-min cleanup of `/tmp/kore-*` files, orphaned
  sandbox dirs, and execution-log rotation.
- **Suspended-task escalation** (`src/index.ts:179`): a `SUSPENDED` task emits `intercept_start`,
  sets `AWAITING_HUMAN`, and after a 30-min timeout auto-branches to a speculative git branch
  (`executeSpeculativePivot`), reconciled later by `receiveHumanReconciliationDirective`
  (`src/index.ts:214`).

### 4.10 PWA front-end (`src/pwa/*`)

A **vanilla TypeScript SPA** (not React/Next as the design docs claim). `app.ts`:

- Token login with `POST /api/v1/auth/verify` (stores in `localStorage`); tabs for
  login/terminal/journals/missions/artifacts.
- Launches missions via `POST /api/v1/missions/start` and opens **two** WebSockets
  (`connectCognition`, `connectIntervention`).
- Polls `/api/v1/telemetry` (5 s) and `/api/v1/missions` (5 s); renders live thinking feed and
  mission list with pause/resume.
- Interactive CAPTCHA overlay driven by `intervention_request` frames; `POST`s a resume.
- `sw.js` service worker + `manifest.json` for installability; `types.ts` holds shared types.

> Mismatch: the PWA sends auth as `Authorization: Bearer <token>` (`app.ts:45`) whereas the
> backend, contract, and other docs expect the `X-Kore-Core-Token` header, and it POSTs to
> `/api/v1/intervention/respond` whereas the backend implements `/api/v1/jobs/resume`. See §9.

### 4.11 Container & infrastructure

- **`Dockerfile`**: multi-stage Node 20 Alpine. Build stage `npm ci` + `tsc`. Runtime installs
  `ffmpeg`, `chromium`, Playwright deps; creates non-root `elo` (uid 1001); locks directory perms
  (`chmod 700` on browser context); runs `playwright install chromium`; `USER elo`.
- **`docker-compose.yml`**: services `kore-os-admin` (engine), `kore-os-gateway` (Fastify, port
  `3000:3000`, healthcheck), and `kore-os-admin-dev` (live source mount). Both production services
  run `read_only: true`, `tmpfs /tmp:512m`, `no-new-privileges`, `seccomp:./docker/seccomp-profile.json`,
  `cap_drop: ALL`, `cap_add: NET_BIND_SERVICE`. Named volumes `kore-ipc` (socket) and
  `kore-marketing-metrics` (persistence).
- **`.dockerignore` / `.gitignore`** keep the image lean and secrets out.
- **`tsconfig.json`**: strict ESM (`nodenext`), `target ES2022`, `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.

---

## 5. Configuration & environment

| Variable | Used by | Default / meaning |
|----------|---------|-------------------|
| `KORE_CORE_TOKEN` | Gateway auth (`server.ts:24`) | Shared operator token |
| `KORE_CORS_ORIGIN` | Gateway CORS | `http://localhost:5173` |
| `KORE_GATEWAY_PORT` | Gateway listen port | `3000` |
| `KORE_DB_PATH` | Engine DB path | `/home/elo/data/tasks.db` |
| `KORE_API_POOL_PATH` | API key pool | `config/api_pool.json` |
| `KORE_PUBLIC_URL` | CAPTCHA iframe base URL | derived from request |
| `KORE_BUDGET_POOL_TOKENS` | Budget pool size | `100000` |
| `KORE_REPORTS_PATH` | Report root | `reports/missions` |
| `NODE_ENV`, `PORT`, `ALLOWED_BUDGET_USD`, `EXTERNAL_SERVICE_API_KEY` | `.env.example` | illustrative |

`config/api_pool.json` shape: `{ "providers": { "gemini":[{id,key}], "zhipu":[{id,key}] },
"default_cooldown_ms": 60000 }`.

Workspace roots: `/home/elo/workspace` (git repo, code), `/home/elo/data` (DBs, vault),
`/home/elo/.local/share/browser-context`, `reports/missions/{technical,executive,reflection,
scraped,tasks}`.

---

## 6. API contract summary

**REST (all require `X-Kore-Core-Token` unless noted):**

| Method & path | Purpose |
|---------------|---------|
| `GET /api/v1/telemetry` | CPU, RAM, tokens, burn rate, `ceilActive`, budget |
| `POST /api/v1/telemetry/budget` | Toggle hard ceiling (persists `budget.json`) |
| `POST /api/v1/budget/refill` | Add tokens to pool |
| `GET /api/v1/budget/status` | Remaining / total |
| `GET /api/v1/decisions` | Decision+execution-log records (mission `001`) |
| `GET /api/v1/processes` | Local process snapshot |
| `POST /api/v1/jobs/resume` | Forward human directive (`{sessionId, approved?}`) over IPC |
| `POST /api/v1/auth/verify` | Token check (public-ish; returns `{status:"ok"}`) |
| `POST /api/v1/missions/start` | Submit a mission (`{prompt, missionId?, priority?, budgetTokens?}`) |
| `POST/GET /api/v1/missions/:id/pause|resume` | Pause/resume a mission |
| `GET /api/v1/missions` | All queue entries |
| `GET /api/v1/missions/:id/state` | Per-mission state |
| `GET /api/v1/missions/:id/artifacts` | List artifacts |
| `GET /api/v1/artifacts/download/:id` | Stream artifact file |
| `POST /api/v1/schedules` (+ `GET`, `:id/toggle`) | Recurring missions |
| `POST /api/v1/push/subscribe` | Web-push subscription vault |
| `GET /api/v1/captcha/active` | Pending CAPTCHA `{id,url}` or `null` |
| `GET /interactive` | **Public** human verification page |
| `GET /pwa*, /pwa` | Static PWA assets |

**WebSocket frames:**

- `/api/v1/stream/cognition?session_id=…` → `{ intent, rationale }` (latest-wins). Initial
  `{ intent:"Idle", rationale:"" }`.
- `/api/v1/stream/intervention?session_id=…` → typed `{ type, payload }`:
  `state_change`, `intervention_request` (captcha/clarification).

**IPC frames (engine ↔ gateway):** see `src/utils/ipc_frame_schema.ts` (§4.2).

> The backend is ~90% aligned with `BACKEND_CONTRACT.md`; the one breaking mismatch (cognition
> socket forwarding non-cognition frames) is already fixed in `server.ts:580` by filtering to
> `thinking` frames. The `approved` boolean is now forwarded through `jobs/resume`
> (`server.ts:200`).

---

## 7. File inventory (project map)

```
Dockerfile, docker-compose.yml, package.json, tsconfig.json,
.env(.example), .dockerignore, .gitignore
config/api_pool.json
docker/{seccomp-profile.json, healthcheck.sh}
src/
  index.ts                      # Engine entry + MCP server + mission supervisor
  server.ts                     # Fastify gateway (REST + WS + IPC client)
  pwa/{app.ts,app.js,index.html,styles.css,sw.js,manifest.json,types.ts}
  prompts/agent_system_prompt.ts
  tools/                        # 16 tools (see §4.6)
  utils/                       # agent_loop, interpreter, tool_dispatcher, reporter,
                               # llm_client, api_guard_middleware, ipc_pipe,
                               # ipc_frame_schema, state_machine, priority_queue,
                               # scheduler, interruption_handler, budget_pool,
                               # resource_guard, checkpoint_manager, migrations,
                               # captcha_interceptor, heartbeat, trait_registry,
                               # implication_store, sys_inspect, prompt_reformulator,
                               # security_guard, network_guard, command_validator,
                               # session_manager, task_queue, git_automation_helper,
                               # task_state_manager, database_helper, sandbox_runner,
                               # token_budget, ipc_session_manager
tests/                         # mission prompt fixtures + runners
reports/, home/elo/{workspace,data}/  # runtime state (git repo + SQLite)
```

(Exact tool/util file names confirmed via `glob src/**/*.ts`.)

---

## 8. Build & run

```bash
npm install
npm run build            # tsc -> dist/

# Engine (MCP/stdio + Unix socket)
KORE_DB_PATH="$(pwd)/home/elo/data/tasks.db" node dist/index.js

# Gateway (separate terminal)
KORE_DB_PATH="$(pwd)/home/elo/data/tasks.db" KORE_CORE_TOKEN=testtoken node dist/server.js

# Smoke test
curl -X POST http://localhost:3000/api/v1/missions/start \
  -H "X-Kore-Core-Token: testtoken" -H "Content-Type: application/json" \
  -d '{"prompt":"Write a short hello world report","missionId":"smoke"}'
curl http://localhost:3000/api/v1/missions/smoke/artifacts -H "X-Kore-Core-Token: testtoken"

# Container
docker compose --profile production up --build
```

Scripts (`package.json`): `dev` (`tsx src/index.ts`), `dev:gateway`, `build`, `start`,
`start:gateway`, `test` (`tsx --test tests/**/*.test.ts`).

---

## 9. Honest gap analysis (for the examiner)

The following are real discrepancies, partial implementations, or documentation/code mismatches an
expert reviewer must be aware of. They are not necessarily defects — some are intentional scaffolding
— but they must be flagged.

1. **PWA framework mismatch.** Design docs (`kore_controller_wpa.md`, `FRONTEND_IMPLEMENTATION_GUIDE.md`)
   specify Next.js/Vite+React. The shipped PWA is **vanilla TS** (`src/pwa/app.ts`). Components named
   in the docs (`TerminalStream.tsx`, `DualJournalViewer.tsx`, `ArtifactsGallery.tsx`,
   `InteractiveCanvas.tsx`) do not exist as separate files.

2. **Auth header inconsistency.** PWA sends `Authorization: Bearer <token>` (`app.ts:45`), but the
   gateway's `onRequest` hook checks `X-Kore-Core-Token` (`server.ts:89`). The PWA's `/auth/verify`
   call would 401 unless the token also happens to match — currently the **gateway's** `auth/verify`
   ignores the token entirely and returns `{status:"ok"}` (`server.ts:228`), so login "succeeds" but
   other calls would fail. This must be reconciled.

3. **Resume endpoint mismatch.** PWA POSTs `/api/v1/intervention/respond` (`app.ts:107`); the gateway
   implements `/api/v1/jobs/resume` (`server.ts:186`). The CAPTCHA "release worker" flow is broken
   on the PWA side until aligned.

4. **Stubbed LLM paths.** `index.ts:callModelGenerativeLoop` returns a hardcoded simulated string.
   `realization_engine.ts` and `prompt_reformulator` LLM calls are stubs returning fixed text.
   The **operative** model integration is `AgentLoop` → Zhipu (`agent_loop.ts:308`). Any reviewer
   testing the realization/safe-brake loop will see simulated output.

5. **Legacy `executeTask` synthetic values.** The legacy task path (`src/index.ts:127`) hardcodes
   `executionDurationMs=4500`, `tokenCount=1420`, `gitCommitHash="abc123"` and does not invoke the
   real LLM — it coexists with the new autonomous path and should be considered a demo/compat
   surface.

6. **`executeTask` vs `AgentLoop` dual paths.** Two execution models run side by side: the legacy
   `ServiceManager`-driven `executeTask` and the new `AgentLoop` mission path. The contract doc
   (`PROJECT_MAP.md`) still describes only the legacy path; the code has moved on.

7. **`SandboxRunner.applyRlimits` is a no-op.** Resource limits are declared but not enforced
   (`sandbox_runner.ts:118`); hardening currently relies on the container (seccomp/caps/read-only).

8. **PWA `artifacts`/`journals` tabs are declared but thin.** `app.ts` wires login/terminal/missions
   and telemetry, plus a minimal CAPTCHA form; the Artifacts gallery and dual-journal viewer
   described in `FRONTEND_*` docs are not implemented in the shipped vanilla app.

9. **`ipc_session_manager.ts` / `token_budget.ts` exist but are lightly wired.** They are part of the
   expanded surface; the active budget logic lives in `budget_pool.ts`. The examiner should confirm
   intended vs. dead code.

10. **`git_automation_helper.ts`** enforces the "no uncommitted mutations" rule (commits per task/
    pivot). It is invoked from the legacy path and speculative-pivot logic; the new `AgentLoop` path
    records milestones via `MetricsLedger` rather than git-per-step.

11. **Mixed message types risk (historically).** The cognition socket previously forwarded *all* IPC
    frames; `server.ts:580` now filters. The contract validation doc (`BACKEND_CONTRACT_VALIDATION.md`)
    is the canonical "before" reference and is now largely resolved.

---

## 10. Summary

Kore OS TEP is a coherent, layered autonomous-administration platform: a **vanilla PWA** operator
surface, a **Fastify gateway** that translates REST/WebSocket into a **Unix-socket IPC** protocol,
and a **Node MCP engine** that drives missions through a structured-decision agent loop
(`AgentLoop` → `Interpreter` → `ToolDispatcher` → `Reporter`), governed by a token budget, priority
queue, scheduler, checkpointing, and a strict safety/audit posture. Its distinguishing ideas are the
**Tri-Masterclass Context Protocol** (context-as-memory with skeletons, breadcrumbs, and implication
caching) and the **human-in-the-loop** CAPTCHA/2FA interception flow. The architecture is
production-minded (WAL SQLite, container hardening, seccomp, non-root, reconnection), with a few
intentional stubs and PWA/contract mismatches that the gap analysis (§9) documents for the examiner.
