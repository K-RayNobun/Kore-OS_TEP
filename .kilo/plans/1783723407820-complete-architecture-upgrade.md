# Kore OS TEP — Complete Architecture Upgrade Plan

Date: 2026-07-10
Status: Ready for implementation
Saved to: `.kilo/plans/1783723407820-complete-architecture-upgrade.md`

---

## 1. Reference Document

This plan is derived from `SECOND_UPGRADE_SUMMARY.md`, which reverse-engineers the 10 mandatory architecture layers required to achieve the ideal final result.

**10 Layers (in build-order priority):**
1. IPC Protocol (Unix socket JSON stream)
2. Database Layer (SQLite WAL + audit tables)
3. Tool/Sandbox Layer (capability-based execution)
4. Safety Layer (SecurityGuard + NetworkGuard + CommandValidator + BinaryInspector)
5. Agent Engine (MCP stdio + AgentLoop + structured decisions)
6. API Gateway (Fastify daemon + dual WebSockets)
7. Context Economy (TMCP with AST skeletons + implication dedup + 1k-token cap)
8. Telemetry / Metrics (burn rate + ceilActive + campaign metrics)
9. Infrastructure (Alpine container hardening + non-root + seccomp)
10. Operator Experience (PWA Control Center)

---

## 2. Current State per Layer

| Layer | Completeness | Key Gaps |
|-------|--------------|----------|
| **IPC Protocol** | 70% | Session ID multiplexing added. Missing: formal Zod schema for frames, ACK/NAK flow control, out-of-band ARTIFACT_MANIFEST REST bridge, byte-stream delimiters for binary payloads. |
| **Database Layer** | 85% | WAL enabled, comprehensive tables. Missing: `resolved_at` on `human_interventions`, `token_delta` on `execution_logs`, migration framework (current inline ALTER TABLE), `implication_hash` table for TMCP deduplication. |
| **Tool/Sandbox Layer** | 60% | 12 tools exist with SecurityGuard path validation. Missing: per-tool Unix user/namespace isolation, cgroup RLIMIT_AS/RLIMIT_CPU enforcement, seccomp profiles, all tools using SecurityGuard (`service_manager`, `network_audit` missing), bug fixes (`asset_optimizer` dead-code, `browser_automator` leaked browser, `backup.ts` execSync injection). |
| **Safety Layer** | 55% | Path allowlists, SSRF regex, FFmpeg validator, binary inspector present. Missing: actual DNS resolution in NetworkGuard, full URL validation coverage on browser_automator, mandatory Git commit enforcement per mutation, seccomp/no_new_privs OS-level enforcement. |
| **Agent Engine** | 75% | AgentLoop with structured decisions, Interpreter, ToolDispatcher, Reporter, PromptReformulator exist. Missing: DAG with acceptance criteria (currently flat tool-chain), implication hash indexing, enforced 1k-token budget per implication, RecursiveRealizationEngine integration into main loop. |
| **API Gateway** | 80% | Fastify with REST + dual WebSockets + IPC client + reconnect. Missing: typed frame schema validation, robust session-to-mission binding, PROMPT_SUBMIT validation schema, ARTIFACT_MANIFEST REST endpoint for non-WS clients. |
| **Context Economy (TMCP)** | 40% | sys_inspect skeleton cache (2-min TTL), basic context optimization. Missing: implication dedup by hash, 1k-token per-implication enforcement, formal forgetting protocol/TTL, AST paging `sys_inspect(mode=paged)` returning only metadata. |
| **Telemetry / Metrics** | 65% | Telemetry tool, metrics ledger, execution logger, burn-rate endpoint, budget pool. Missing: heartbeat event bus, ceilActive enforcement gating mission spawning, proper marketing_metrics volume mount enforcement, burn rate formula `(tokens/tokens_budget) * elapsed / total_duration_estimate`. |
| **Infrastructure (Alpine)** | 50% | Multi-stage Alpine build, non-root `elo` (UID 1001), Playwright installed. Missing: read-only root filesystem, seccomp/AppArmor profile, network policy (outbound HTTPS only), cron/healthcheck for daemon, `no_new_privs` enforcement. |
| **Operator Experience (PWA)** | 0% | Completely absent. No frontend directory, no HTML/JS/CSS, no manifest, no service worker, no offline queue, no JWT refresh, no mobile UI. |

---

## 3. Implementation Phases

### Phase 1: Database Migrations + Schema Hardening (Layer 2, 6)

**Goal:** Close schema gaps and add migration foundation.

**Files to modify:**
1. `src/utils/database_helper.ts` (~+60 lines)
   - Add `resolved_at DATETIME` to `human_interventions` table
   - Add `token_delta INTEGER` to `execution_logs` table
   - Add `implication_hashes` table for TMCP deduplication
   - Add `schema_version` table for migration tracking
   - Add `ForeignKey` enforcement pragma
   - Extract inline schema DDL into named `ensureSchema()` function

2. `src/utils/migrations.ts` (**new**, ~80 lines)
   - `MigrationRunner` class with version tracking
   - `migrate()` applies pending migrations idempotently
   - Initial migration: create all tables
   - Migration 002: add `resolved_at` to `human_interventions`
   - Migration 003: add `token_delta` to `execution_logs`
   - Migration 004: create `implication_hashes`

**Validation:**
- Run existing tests; DB schema unchanged for backward compatibility
- Verify `resolved_at` column exists via `PRAGMA table_info`
- Verify `token_delta` column exists
- Verify `implication_hashes` table exists

---

### Phase 2: IPC Protocol Hardening (Layer 5)

**Goal:** Add formal frame schema, ACK/NAK, and out-of-band artifact bridge.

**Files to modify:**
1. `src/utils/ipc_frame_schema.ts` (**new**, ~120 lines)
   - Zod schemas for all frame types: `PROMPT_SUBMIT`, `HUMAN_DIRECTIVE`, `INTERVENTION_REQUEST`, `INTERVENTION_RESPONSE`, `MISSION_PAUSE`, `MISSION_RESUME`, `BUDGET_REFILL`, `THINKING`, `TOOL_EXECUTION`, `STATE_CHANGE`, `ARTIFACT_MANIFEST`, `TELEMETRY_RESPONSE`, `MISSION_COMPLETE`
   - `validateFrame(frame)` function
   - `isSessionFrame(frame)` helper

2. `src/utils/ipc_pipe.ts` (~+40 lines, modify)
   - Add `ack()` method: send `ACK{correlationId}` frame
   - Add `nak()` method: send `NAK{correlationId, reason}` frame
   - Wire validation on inbound frames; drop invalid frames with warning
   - Add correlation ID generation on send

3. `src/utils/ipc_session_manager.ts` (**new**, ~60 lines)
   - `SessionManager` tracks active mission sessions
   - Maps `session_id` → `{ missionId, taskId, priority, createdAt }`
   - `createSession(missionId, taskId, priority)` returns session ID
   - `resolveSession(sessionId)` returns session metadata
   - `cleanupStaleSessions(maxAgeMs)`

4. `src/server.ts` (~+15 lines, modify)
   - Add `GET /api/v1/artifacts` REST endpoint (out-of-band bridge for non-WS clients)
   - Validate inbound IPC frames against schemas before routing

**Validation:**
- Unit tests: frame schema validation passes for all frame types, rejects malformed frames
- Unit tests: ACK correlation IDs match sent frames
- Integration test: gateway rejects malformed IPC frame gracefully

---

### Phase 3: Safety Layer Bug Fixes + Enforcement (Layer 4, 8)

**Goal:** Fix known bugs, enforce safety contracts on all tools.

**Files to modify:**
1. `src/tools/asset_optimizer.ts` (~-20 lines, fix dead code)
   - Remove leaked `fs.stat(outputFile)` after `heavyTaskQueue.run`
   - Ensure single return path

2. `src/tools/browser_automator.ts` (~-10 lines, fix leak)
   - Remove unused `chromium.launch()` (line 38); keep only `launchPersistentContext`

3. `src/tools/backup.ts` (~+20 lines, security fix)
   - Replace `execSync` string interpolation with `execFileAsync`
   - Add SecurityGuard path validation on `sourcePath`

4. `src/tools/service_manager.ts` (~+15 lines, security fix)
   - Replace string-interpolated `execAsync` with parameterized `execFile` for `kill`/`pkill`
   - Add SecurityGuard validation on target paths

5. `src/utils/security_guard.ts` (~+10 lines, extend)
   - Add `/home/elo/.local/share/browser-context` to `ALLOWED_ROOTS`

6. `src/utils/network_guard.ts` (~+30 lines, extend)
   - Add `validateUrlForTool(url, toolName)` that blocks SSRF for browser_automator
   - Wire into `browser_automator.ts` before navigation

7. `src/utils/command_validator.ts` (~+15 lines, extend)
   - Extend `ALLOWED_FFMPEG_FLAGS` to cover common real-world flags (`-vf`, `-af`, `-movflags`, `-pix_fmt`, `-b:v`, `-b:a`, `-s`, `-r`, `-ar`, `-ac`, `-map`, `-metadata`, `-shortest`, `-frames:v`, `-qscale:v`)

8. `src/tools/*.ts` (all 12 tool files, ~+5 lines each)
   - Add `registerInterruptionContract` calls in each tool class
   - Export `ToolInterruptionContract` instances

**Validation:**
- Unit tests: `asset_optimizer` returns single artifact path, no dead-code path
- Unit tests: `browser_automator` launches only one browser instance
- Unit tests: `backup.ts` fails on path containing `../` or outside allowed roots
- Unit tests: `service_manager.ts` rejects targets outside allowed roots
- Unit tests: `network_guard.ts` blocks `http://169.254.169.254` (AWS metadata)
- Unit tests: `command_validator.ts` rejects pipes, `-i http://...`, shell metacharacters

---

### Phase 4: Context Economy Hardening (Layer 7)

**Goal:** Implication deduplication, 1k-token enforcement, formal forgetting.

**Files to modify:**
1. `src/utils/implication_store.ts` (**new**, ~100 lines)
   - `ImplicationStore` backed by SQLite `implication_hashes` table
   - `computeHash(tool, params, environment)` → SHA-256
   - `lookup(hash)` → cached result or null
   - `store(hash, result, ttlMs)` → persists with TTL
   - `gc()` → removes expired entries

2. `src/utils/sys_inspect.ts` (~+40 lines, modify)
   - Add `mode: "paged"` that returns `{files: 5, truncated: true}` instead of full AST
   - Enforce 1k-token output cap on all modes
   - Add `pageToken` support for next-page retrieval

3. `src/utils/agent_loop.ts` (~+30 lines, modify)
   - Before LLM call: check `ImplicationStore.lookup()` for previous result
   - After LLM call: store implication in `ImplicationStore` with 30-min TTL
   - Enforce 1k-token cap on user prompt construction (fail if exceeded)

4. `src/utils/api_guard_middleware.ts` (~+20 lines, modify)
   - Add `estimateTokens(text)` utility
   - Gate `executeWithRetry` when prompt exceeds `MAX_IMPLICATION_TOKENS = 1000`

**Validation:**
- Unit tests: identical tool+params returns cached result (store hits)
- Unit tests: `sys_inspect mode=paged` returns ≤5 entries with `truncated: true`
- Unit tests: `agent_loop` skips LLM call when implication cached
- Unit tests: 1k-token cap enforced, oversized prompts rejected

---

### Phase 5: Per-Tool Sandbox Isolation (Layer 4)

**Goal:** cgroup-style resource limits and per-tool execution contracts.

**Files to modify:**
1. `src/utils/sandbox_runner.ts` (**new**, ~120 lines)
   - `SandboxRunner` wraps `spawn` with:
     - `RLIMIT_AS` (memory cap, e.g., 512MB)
     - `RLIMIT_CPU` (CPU time cap, e.g., 60s)
     - Dedicated temp directory per tool invocation
     - PID tracking for interruption
   - `run(toolName, binaryPath, args, limits)` returns `{pid, tempDir, promise}`

2. `src/tools/sandbox.ts` (~+30 lines, modify)
   - Replace direct `spawn` with `SandboxRunner.run`
   - Register interruption contract

3. `src/utils/resource_guard.ts` (~+40 lines, extend)
   - Add `setRlimit(pid, rtype, value)` wrapper
   - Add `enforceCgroup(pid, cgroupPath)` placeholder for future cgroup v2

**Validation:**
- Unit tests: spawn with RLIMIT_AS kills process at memory cap
- Unit tests: temp dir is created and cleaned up after tool execution
- Unit tests: PID tracked correctly for interruption

---

### Phase 6: Telemetry Heartbeat + ceilActive Enforcement (Layer 10)

**Goal:** Closed-loop budget system with heartbeat and engine-side ceilActive gating.

**Files to modify:**
1. `src/utils/heartbeat.ts` (**new**, ~80 lines)
   - `Heartbeat` emits `{ts, cpu, ram, tokens, burnRate}` every 5s
   - Routes through `IpcPipe` as `telemetry_heartbeat` frames
   - Gateway translates to WebSocket push

2. `src/utils/execution_logger.ts` (~+10 lines, modify)
   - Add `token_delta` field to `MicroStep` and log output

3. `src/utils/database_helper.ts` (~+5 lines, modify)
   - Update `insertExecutionLog` to accept `token_delta` parameter

4. `src/utils/budget_pool.ts` (~+20 lines, modify)
   - Add `isCeilingActive()` reflecting persistent state
   - Add `gateMissionSpawn()` returns true when ceilActive and budget exhausted

5. `src/index.ts` (~+25 lines, modify)
   - Gate `handlePromptSubmit` with `budgetPool.gateMissionSpawn()`
   - Start `Heartbeat` on boot
   - Respond to `telemetry_heartbeat` by updating gateway cache

6. `src/server.ts` (~+15 lines, modify)
   - Translate `telemetry_heartbeat` frames to WebSocket
   - Include `ceilActive` + budget in heartbeat payload

**Validation:**
- Unit tests: Heartbeat emits frames at correct interval
- Unit tests: `budgetPool.gateMissionSpawn()` blocks when ceilActive=true and budget exhausted
- Integration test: 2 missions submitted with ceilActive=true → second mission queued, not spawned

---

### Phase 7: Alpine Container Hardening (Layer 9)

**Goal:** Production-grade container security.

**Files to modify:**
1. `Dockerfile` (~+30 lines, modify)
   - Add `--read-only` flag to `docker run` example in comments
   - Create `/tmp` and `/home/elo/data` as explicit volumes
   - Add `--security-opt no-new-privileges`
   - Add `--cap-drop ALL --cap-add NET_BIND_SERVICE`
   - Add seccomp profile mount example

2. `docker-compose.yml` (~+30 lines, modify)
   - Add `read_only: true` to service definitions
   - Add `tmpfs: ["/tmp:size=512m"]`
   - Add `security_opt: ["no-new-privileges:true"]`
   - Add `cap_drop: ["ALL"]`
   - Add `healthcheck` for gateway (`curl -f http://localhost:3000/api/v1/telemetry`)
   - Add explicit `marketing_metrics` volume mount
   - Add cron service for periodic healthcheck/cleanup

3. `docker/healthcheck.sh` (**new**, ~30 lines)
   - Curl `/api/v1/telemetry`
   - Check Unix socket exists
   - Check DB file writable
   - Exit 0/1

4. `docker/seccomp-profile.json` (**new**, ~60 lines)
   - Deny `mount`, `ptrace`, `bpf`, `kexec`, `reboot`, `init_module`
   - Default SCMP_ACT_ERRNO

**Validation:**
- `docker compose build` succeeds
- `docker compose run --rm kore-os-gateway curl http://localhost:3000/api/v1/telemetry` returns JSON
- Container starts with `read_only: true` and explicit tmpfs volumes

---

### Phase 8: Mobile PWA Control Center (Layer 1)

> **Repo layout clarification (2026-07-12):** Repo-root `src/` is the **backend** (Fastify gateway `src/server.ts` + MCP engine `src/index.ts` + `src/utils/*` + `src/tools/*`). The PWA is served from `src/pwa/` (the vanilla app below), mounted read-only at `/usr/src/app/pwa`. A rebuilt React/Vite PWA (if any) is a **separate frontend repo** and is dropped into `src/pwa/` or mounted externally — it is **not** built from repo-root `src/`. The handoff memo's claim that "the Vite app lives in repo-root `src/`" is incorrect for this repository. `POST /api/v1/jobs/resume` is kept as-is (extended with `choice`/`answer`/`approved:false`); it is NOT renamed to `/intervention/respond`.

**Goal:** Full mobile operator interface.

**Files to create:**
1. `src/pwa/index.html` (~60 lines)
   - Meta viewport, manifest link, theme color
   - Login screen + main app shell with `<nav>` and `<main>`
   - Service worker registration script

2. `src/pwa/manifest.json` (~30 lines)
   - name, short_name, start_url, display: standalone
   - icons (placeholder paths)
   - theme_color, background_color

3. `src/pwa/sw.js` (~100 lines)
   - Cache-first for static assets
   - Network-first for API calls with offline queue
   - Background sync for `POST /missions/start` when offline
   - Push notification handler

4. `src/pwa/app.ts` (~400 lines)
   - Token-based auth flow (POST /auth/verify)
   - Dual WebSocket connection (cognition + intervention) with session_id filtering
   - Live thinking terminal (logs THINKING frames)
   - Dual journal viewer (DECISIONS + EXECUTION_LOGS tabs)
   - Telemetry gauges (CPU, RAM, burn rate, budget)
   - Prompt console (POST /missions/start)
   - Artifacts gallery (GET /missions/:id/artifacts, download links)
   - Interactive CAPTCHA overlay (open /interactive?taskId=X in iframe)
   - Mission controls (pause, resume, priority slider, budget refill)

5. `src/pwa/styles.css` (~200 lines)
   - Mobile-first responsive layout
   - Dark theme
   - Gauge/terminal styling

6. `src/pwa/types.ts` (~80 lines)
   - Typed interfaces for all IPC/WebSocket frames
   - `CognitionFrame`, `InterventionFrame`, `StateChangeFrame`, `TelemetryFrame`

**Files to modify:**
1. `src/server.ts` (~+10 lines)
   - Add `GET /pwa` route serving `index.html`
   - Add `Content-Security-Policy` header for service worker

2. `docker-compose.yml` (~+5 lines)
   - Mount `src/pwa` as read-only volume at `/usr/src/app/pwa`

**Validation:**
- Lighthouse PWA audit score >80
- Works offline after first load (service worker caches shell)
- WebSocket reconnection with session filtering functional
- CAPTCHA overlay opens and posts approval correctly

---

## 4. Implementation Sequence (Recommended Order)

The layers must be built in dependency order. The critical path is:

```
1. Database Migrations + Schema Hardening (Phase 1)
   ↓ provides schema foundation for all DB work
2. IPC Protocol Hardening (Phase 2)
   ↓ required before agent + gateway can communicate safely
3. Safety Layer Bug Fixes + Enforcement (Phase 3)
   ↓ required before tools can be trusted in isolation
4. Context Economy Hardening (Phase 4)
   ↓ depends on implication_hashes table from Phase 1
5. Per-Tool Sandbox Isolation (Phase 5)
   ↓ depends on SandboxRunner and interrupt contracts from Phase 3
6. Telemetry Heartbeat + ceilActive Enforcement (Phase 6)
   ↓ depends on BudgetPool from Phase 6 and IPC from Phase 2
7. Alpine Container Hardening (Phase 7)
   ↓ independent, can run in parallel with 4-6
8. Mobile PWA Control Center (Layer 8)
   ↓ depends on all backend endpoints from Phase 6 + gateway from Phase 2
```

**Parallelizable tracks:**
- Track A: Phases 1 → 2 → 4 → 6 (backend data + protocol + budget)
- Track B: Phases 3 → 5 (safety + sandbox isolation)
- Track C: Phase 7 (container hardening, independent)
- Track D: Phase 8 (PWA, starts after Track A complete)

---

## 5. Detailed File Manifest

### New Files

| File | Phase | Est. Lines | Purpose |
|------|-------|-----------|---------|
| `src/utils/migrations.ts` | 1 | 80 | Migration runner with version tracking |
| `src/utils/ipc_frame_schema.ts` | 2 | 120 | Zod schemas for all IPC frame types |
| `src/utils/ipc_session_manager.ts` | 2 | 60 | Session lifecycle + metadata |
| `src/utils/implication_store.ts` | 4 | 100 | TMCP implication hash cache |
| `src/utils/sandbox_runner.ts` | 5 | 120 | cgroup/rlimit sandbox wrapper |
| `src/utils/heartbeat.ts` | 6 | 80 | 5s telemetry heartbeat emitter |
| `docker/healthcheck.sh` | 7 | 30 | Container healthcheck script |
| `docker/seccomp-profile.json` | 7 | 60 | Seccomp deny-list profile |
| `src/pwa/index.html` | 8 | 60 | PWA shell |
| `src/pwa/manifest.json` | 8 | 30 | PWA manifest |
| `src/pwa/sw.js` | 8 | 100 | Service worker with offline queue |
| `src/pwa/app.ts` | 8 | 400 | Full PWA client app |
| `src/pwa/styles.css` | 8 | 200 | Mobile-first CSS |
| `src/pwa/types.ts` | 8 | 80 | PWA type definitions |
| `tests/implication_store.test.ts` | 4 | 40 | TMCP dedup tests |
| `tests/ipc_frame_schema.test.ts` | 2 | 50 | Frame validation tests |
| `tests/sandbox_runner.test.ts` | 5 | 40 | Sandbox limit tests |
| `tests/heartbeat.test.ts` | 6 | 30 | Heartbeat emission tests |
| `tests/migrations.test.ts` | 1 | 30 | Migration runner tests |

### Modified Files

| File | Phase | Est. Δ Lines | Changes |
|------|-------|-------------|---------|
| `src/utils/database_helper.ts` | 1 | +60 | Schema migrations, new columns, implication_hashes table |
| `src/utils/ipc_pipe.ts` | 2 | +40 | ACK/NAK, validation, correlation IDs |
| `src/server.ts` | 2, 6, 8 | +30 | Frame validation, heartbeat routing, PWA route |
| `src/tools/asset_optimizer.ts` | 3 | -20 | Dead-code fix |
| `src/tools/browser_automator.ts` | 3 | -10 | Leaked browser fix |
| `src/tools/backup.ts` | 3 | +20 | execFileAsync, SecurityGuard |
| `src/tools/service_manager.ts` | 3 | +15 | Parameterized kill, SecurityGuard |
| `src/utils/security_guard.ts` | 3 | +10 | Add browser-context root |
| `src/utils/network_guard.ts` | 3 | +30 | validateUrlForTool |
| `src/utils/command_validator.ts` | 3 | +15 | Extended FFmpeg flags |
| `src/tools/*.ts` (12 files) | 3 | +5 each | Interruption contracts |
| `src/utils/sys_inspect.ts` | 4 | +40 | Paged mode, 1k-token cap |
| `src/utils/agent_loop.ts` | 4, 6 | +30, +30 | Implication lookup/store, heartbeat wire |
| `src/utils/api_guard_middleware.ts` | 4 | +20 | Token estimation, implication gate |
| `src/utils/resource_guard.ts` | 5 | +40 | RLIMIT wrappers |
| `src/tools/sandbox.ts` | 5 | +30 | SandboxRunner integration |
| `src/utils/budget_pool.ts` | 6 | +20 | ceilActive gate method |
| `src/index.ts` | 6 | +25 | Heartbeat start, spawn gating |
| `src/utils/execution_logger.ts` | 6 | +10 | token_delta field |
| `Dockerfile` | 7 | +30 | Read-only, security opts, examples |
| `docker-compose.yml` | 7, 8 | +35 | Healthcheck, tmpfs, PWA mount, security opts |
| `package.json` | install | +3 | test script already present |
| `tsconfig.json` | config | +1 | `include: ["src", "tests"]` for build isolation |

---

## 6. Known Bugs to Fix

| Bug | File | Lines | Severity | Fix |
|-----|------|-------|----------|-----|
| asset_optimizer dead-code leak | `src/tools/asset_optimizer.ts` | ~56-77 | Medium | Remove unreachable fs.stat after queue.run |
| browser_automator leaked browser | `src/tools/browser_automator.ts` | 38, 46 | Medium | Remove `launch()` call; use only `launchPersistentContext` |
| backup execSync injection | `src/tools/backup.ts` | 14-17 | High | Replace with `execFile` or SecurityGuard-validated spawn |
| service_manager kill injection | `src/tools/service_manager.ts` | multiple | High | Replace `execAsync("kill -9 " + pid)` with `process.kill(pid, 'SIGKILL')` |
| incomplete FFmpeg allowlist | `src/utils/command_validator.ts` | flag list | Medium | Add real-world flags (`-vf`, `-af`, `-pix_fmt`, `-b:v`, etc.) |
| missing resolved_at | `src/utils/database_helper.ts` | human_interventions DDL | Low | Add column in migration |
| missing token_delta | `src/utils/database_helper.ts` | execution_logs DDL | Medium | Add column, populate from MicroStep |
| no implication dedup | `src/utils/agent_loop.ts` | LLM call pre-check | Medium | Add ImplicationStore lookup before LLM |
| budget.json vs budget_pool | `src/server.ts` | 476-494 | Medium | Migrate to SQLite-backed pool, remove file |

---

## 7. Validation Criteria

### Per-Phase Exit Criteria

**Phase 1:**
- `npm test` passes all migration + DB tests
- `PRAGMA table_info(human_interventions)` shows `resolved_at`
- `PRAGMA table_info(execution_logs)` shows `token_delta`
- `implication_hashes` table queryable

**Phase 2:**
- All 18 frame types validated by Zod schema
- ACK frames emitted for every outbound frame
- Invalid frames logged and dropped without crash
- `SessionManager` creates/resolves sessions correctly

**Phase 3:**
- All 12 tools register interruption contracts
- `asset_optimizer` returns exactly one artifact
- `browser_automator` launches exactly one browser process
- `backup.ts` rejects `../../etc/passwd` as source path
- `service_manager.ts` rejects paths with `../`
- `network_guard.ts` blocks metadata IPs
- `command_validator.ts` allows `-vf scale=1280:720` and blocks `-i http://evil`

**Phase 4:**
- Identical implication returns from cache within 30-min TTL
- `sys_inspect mode=paged` returns ≤5 entries
- Oversized prompts (>1k tokens) rejected before LLM call
- Cache TTL enforced, expired entries GC'd

**Phase 5:**
- Spawned process respects RLIMIT_AS (killed at memory cap)
- Temp dirs cleaned up after tool completion
- PID tracked and available to InterruptionHandler

**Phase 6:**
- Heartbeat emits at 5s interval
- `budgetPool.gateMissionSpawn()` returns true when ceilActive=true and budget exhausted
- `token_delta` populated in `execution_logs`
- Second mission waits when ceilActive enforced

**Phase 7:**
- `docker compose build` succeeds
- Container starts with `read_only: true`
- Healthcheck returns 200
- seccomp profile loaded without error

**Phase 8:**
- Lighthouse PWA score >80
- Service worker precaches shell
- Offline queue replays `POST /missions/start` on reconnect
- WebSocket reconnects with session filter
- CAPTCHA overlay resolves human directive

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Phase 1 migrations fail on existing DBs | Medium | High | Use `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE IF NOT` with error suppression; existing data untouched |
| IPCPipe ACK/NAK breaks existing consumers | Medium | Medium | Maintain backward compat: ACK is optional, old consumers ignore unknown frame types |
| RLIMIT_AS kills legitimate large-tool processes | Medium | Medium | Make memory caps configurable per tool via `ToolInterruptionContract` |
| DAG acceptance criteria engine too complex | Low | High | Start with flat tool-chain (existing); add DAG validation as non-breaking overlay |
| Alpine read-only rootfs breaks Playwright | Medium | High | Use tmpfs for `/tmp` and explicit writeable dirs; test in CI |
| PWA offline queue duplicates missions on reconnect | Medium | Medium | Add idempotency token to `POST /missions/start` payload |
| seccomp profile blocks required syscalls | Medium | High | Start with permissive profile, tighten iteratively; test each tool in isolation |

---

## 9. Out of Scope (Stable for This Plan)

- Multi-node / distributed execution (single container only)
- JWT refresh tokens (single bearer token sufficient for current auth)
- Full PWA push notifications (endpoint exists, UI deferred)
- LLM provider switching at runtime (Gemini/Zhipu hardcoded)
- Real cgroup v2 enforcement (uses RLIMIT as fallback; cgroup deferred to Phase 5+)

---

## 10. Success Criteria

After all 8 phases:
1. **All 10 layers** from SECOND_UPGRADE_SUMMARY.md are at ≥80% completeness.
2. **`npm test`** runs without timeout and all tests pass.
3. **`npm run build`** compiles cleanly (no TS errors).
4. **`docker compose build`** produces a runnable image with `read_only: true` + tmpfs + healthcheck.
5. **PWA Lighthouse** score >80 for PWA, Performance, Accessibility, Best Practices.
6. **No exploitable injection paths** in tool execution (all tools use SecurityGuard + parameterized spawn).
7. **Budget pool enforces partial suspension**: mission A pauses when mission B arrives with higher priority + budget range.
8. **Implication cache hit rate** >30% on repeated tool calls (measured via unit tests).
9. **Heartbeat latency** <200ms from engine → gateway → WS client.
