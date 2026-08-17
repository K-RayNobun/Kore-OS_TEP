# Backend Upgrade Plan — PWA Handoff `1783723407821-PWA-HANDOFF-TO-BACKEND.md`

**Date:** 2026-07-11
**Author:** backend analysis (Kilo)
**Scope:** Upgrade the Fastify gateway + supporting utils to satisfy the PWA's contract, **extending** the already-substantial existing implementation rather than rewriting it.

---

## ⚠️ READ FIRST — Potential "worse version" traps (need your decision)

The handoff was written as if the backend were greenfield. It is **not** — `src/server.ts`, `budget_pool.ts`, `priority_queue.ts`, `scheduler.ts`, `ipc_frame_schema.ts`, and `database_helper.ts` already implement most of what it describes. Adopting the handoff literally in a few places would **downgrade** or **break** the current system. Flags:

### FLAG 1 — Phase 8 PWA mount would mount the BACKEND as the PWA (critical, do NOT do)
The handoff §5 Phase 8 & §7 says: *"The implementation lives in the repo root `src/` (Vite app), not `src/pwa/`. Adjust the docker-compose PWA mount … mount repo root `src` → `/usr/src/app/src` … no separate `src/pwa` dir."*

**Reality:** Repo root `src/` is the **backend** (Fastify gateway + MCP engine + utils). `src/pwa/` is the (older) vanilla-JS PWA the gateway serves at `/pwa/*`. The rewritten Vite PWA (`src/types.ts`, `src/api.ts`, …) described in the handoff is a **separate frontend repo** — it is **not** in this backend repo. Mounting repo root `src` as the PWA would serve backend `.ts` as static files and destroy the running system.

**DECIDED (2026-07-11):** Keep `src/pwa/` as the served location and drop the rebuilt Vite build in there. **Do not** mount repo root `src` as the PWA. Keep `./src/pwa:/usr/src/app/pwa:ro` (and the dev `./src/pwa:/usr/src/app/pwa`) mounts exactly as they are. The handoff's "no separate `src/pwa` dir" instruction is rejected.

### FLAG 2 — Don't rename DB columns; add a DTO/serializer layer instead
The handoff's `Mission`/`Schedule`/`BudgetPool` schemas are **camelCase** (`missionId`, `cronExpr`, `totalTokens`, `reserveTokens`…). The DB + several endpoints currently return **snake_case** (`mission_id`, `cron_expr`, `total_allocated_tokens`…).

**DECIDED (2026-07-11):** Add a DTO/serializer layer at the API boundary. Keep DB columns snake_case; transform to camelCase in `server.ts` responses. Do **not** rename columns or change `updateTaskSchedule`/`createTaskSchedule` signatures. Existing `database_helper`/`scheduler`/tests remain valid.

### FLAG 3 — Keep explicit `priority` as a fallback; don't force attributes-only
Handoff §3.1 says the frontend *"does not send a raw priority integer."* But the existing `POST /api/v1/missions/start` already accepts `priority`/`budgetTokens`, and other clients may too.

**DECIDED (2026-07-11):** Support both — compute canonical priority **from `attributes`** when present (the upgrade), but fall back to an explicit `priority` integer when `attributes` is absent (preserves backward compat). Do not drop the `priority` field.

> Everything below assumes these three flags are resolved as recommended. Nothing here requires deleting working code.

---

## Decisions from architecture-plan review (2026-07-12, `.kilo/plans/1783723407820-complete-architecture-upgrade.md`)

The architecture plan returned 3 conformance questions. Rational resolutions (not blindly conforming to the plan where its premises are wrong):

### Q1 — `POST /api/v1/jobs/resume` rename to `/intervention/respond` → **REJECT rename**
- The shipped PWA, `BACKEND_CONTRACT.md`, and the handoff memo all call `/api/v1/jobs/resume` with `{sessionId, approved?, choice?, answer?}`.
- Renaming breaks every CAPTCHA/clarification resolution. **Keep the path.** Extend the body with `approved`/`choice`/`answer` and keep `sessionId→taskId` mapping (Phase H).
- If semantic clarity is later desired, add `/intervention/respond` as an **alias** (accept both) — never remove `/jobs/resume`.

### Q2 — Emit 5 extra WS frame types (mission_update/budget_update/checkpoint/interrupt/interruption/alert) → **YES**
- These drive the live Fleet board, Budget bar, Timeline, and AlertCenter per handoff §4.1.
- Add them to `ipc_frame_schema.ts` (+ `FrameSchema` union) and broadcast on the intervention socket in `server.ts` (Phase G). Unknown types are ignored by the frontend, so this is safe and incremental.

### Q3 — "React/Vite PWA in repo-root `src/` built to `dist/`" → **PREMISE FALSE; DO NOT build repo-root src**
- Verified: repo-root `src/` is the **backend** (Fastify gateway + MCP engine + utils). No `vite.config.*`, no React imports, no Vite in `package.json`. `src/pwa/` is the (vanilla) PWA the gateway serves at `/pwa/*`.
- The rebuilt Vite PWA is a **separate frontend repo** not present in this checkout.
- "Build `src/` → `dist/` and serve it" would serve the backend as the PWA — a worse version. **Rejected.**
- Resolution (matches Flag 1): keep serving from `src/pwa/`; drop the rebuilt Vite build into `src/pwa/` (or mount it via `./pwa-dist:/usr/src/app/pwa:ro`). The architecture plan's Phase 8 description must be corrected to reflect that `src/pwa` is the served PWA location and repo-root `src` is the backend.

### Q1 (round 2) — "This repo is the React/Vite PWA; build dist/ and serve" → **PREMISE FALSE; reaffirm keep `src/pwa`**
- A second question set reasserted the same false premise ("this repo is the React/Vite PWA; backend is separate"). Contradicts the verified repo state above AND the user's Flag 1 decision ("Keep src/pwa, new build dropped in").
- This checkout is the backend. Building repo-root `src/` to `dist/` produces `dist/index.js`/`dist/server.js` (backend). Serving that as a PWA is the worse-version trap. **Rejected.**
- Decision: gateway keeps serving the PWA from `src/pwa/` (rebuilt Vite build dropped in, or mounted). A separate static host for the *external* PWA repo is also acceptable, but repo-root `src/` is never the PWA.

### Q2 (round 2) — Stale docs → **UPDATE BOTH, corrected**
- `BACKEND_CONTRACT.md` is stale (describes old single-mission viewer) → update to the fleet/multi-mission contract. **Yes.**
- Architecture plan Phase 8 currently claims "Vite PWA in repo-root `src/`" → **correct it** to: repo-root `src/` is the backend; PWA served from `src/pwa/` (or external build mounted). Do NOT amend Phase 8 to say repo-root `src/` is the Vite app.
- Net: update both docs, but with the facts fixed (not the false premise).

---

## Current state vs. handoff (what already works)

| Handoff requirement | Status in repo |
|---|---|
| `GET /api/v1/telemetry` (+`burnRate`) | ✅ implemented (`server.ts:96`) |
| `POST /api/v1/telemetry/budget` (global brake) | ✅ implemented (`server.ts:131`) |
| `GET /api/v1/auth/verify` | ✅ implemented (`server.ts:228`) |
| `GET /api/v1/decisions` | ⚠️ implemented but **hardcodes `missionId:"001"`**, ignores `?missionId=` |
| `GET /api/v1/processes` | ✅ implemented (`server.ts:171`) |
| `GET /api/v1/captcha/active` | ✅ implemented (`server.ts:454`) |
| `POST /api/v1/jobs/resume` | ⚠️ accepts `sessionId`+`approved`; **ignores `choice`/`answer`**, no reject handling |
| `GET /api/v1/missions/:id/artifacts` | ✅ implemented (`server.ts:297`) |
| `GET /api/v1/artifacts/download/:id` | ✅ implemented (`server.ts:279`) |
| `WS /stream/cognition` (w/ `session_id`) | ✅ already routes by `session_id` (`server.ts:505`) |
| `WS /stream/intervention` | ✅ forwards `intervention_request`/`state_change`/`artifact_manifest` |
| `POST /api/v1/missions/start` | ⚠️ accepts raw `priority`/`budgetTokens`, stores no `attributes` |
| `POST /api/v1/missions/:id/pause` | ✅ (`server.ts:257`) |
| `POST /api/v1/missions/:id/resume` | ✅ (`server.ts:268`) |
| `GET /api/v1/missions` | ⚠️ returns raw `mission_queue` rows (snake_case, no `attributes`/`tasksTotal`/`lastCognition`/`latestCheckpointIteration`/`preemptedBy`) |
| `POST /api/v1/budget/refill` | ✅ (`server.ts:138`) |
| `GET /api/v1/budget/status` | ✅ (`server.ts:145`) — but **not** `GET /api/v1/budget` (full pool schema) |
| `GET /api/v1/schedules` | ⚠️ returns raw rows (snake_case, no `attributes`/`maxConcurrentRuns` mapping) |
| `POST /api/v1/schedules` | ⚠️ accepts `budgetTokens` (handoff uses `budgetAllocatedTokens`) |
| `POST /api/v1/schedules/:id/toggle` | ✅ exists (handoff wants `PATCH` + `DELETE`) |
| `human_interventions.resolved_at` | ✅ already in schema |
| `mission_checkpoints` / `interruption_logs` tables | ✅ exist, but **not exposed via REST** |

---

## Phase A — DB hardening (handoff §5 Phase 1, §6 #3)

**File:** `src/utils/database_helper.ts` (`ensureSchema`, additive only — keep `PRAGMA table_info` guards).

1. `missions` table: add `attributes TEXT` (JSON) column + `latest_checkpoint_iteration INTEGER` column. (§3.2, §6 #3)
2. `mission_queue` table: add `attributes TEXT`, `latest_checkpoint_iteration INTEGER`, `tasks_total INTEGER`, `tasks_done INTEGER`, `last_cognition TEXT` columns so `GET /api/v1/missions` can serialize the full `Mission` schema without joins.
3. `task_schedules` table: add `attributes TEXT` column (§3.4).
4. `human_interventions`: confirm `resolved_at` present (it is) — no change.
5. Add `schema_version` bump row (already has the table).

No column renames. Additive `ALTER TABLE … ADD COLUMN IF NOT …` style (use existing `PRAGMA table_info` guard pattern).

## Phase B — Semantic priority from attributes (handoff §3, headline contract, §6 #1)

**New file:** `src/utils/priority_policy.ts` — pure function:
```
computePriority(attributes, policy) -> number
```
Weights from `GET /api/v1/policy`: `{weightUrgency, weightImportance, categoryBias, reservePct}`.
- `priority = wu*urgency + wi*importance + categoryBias[category]`.
- `free-time` + `urgency:0` ⇒ opportunistic flag (lowest band).
- `paused`/`interrupted` ordering for preemption (free-time → Q3 → Q2; Q1/`preemptible:false` protected) — reuse `priority_queue.checkPreemption`.

**Edit `src/utils/ipc_frame_schema.ts`:**
- `PromptSubmitSchema.payload`: add optional `attributes` (loose `z.record(z.unknown())` / nested object). Keep `priority` optional as fallback (FLAG 3).

**Edit `src/server.ts` `POST /api/v1/missions/start`:**
- Parse `body.attributes`. If present → `computePriority(attributes, loadPolicy())`; else use `body.priority` fallback.
- Persist `attributes` JSON to `missions` + `mission_queue` rows (new helpers in `database_helper`).
- If `attributes.recurrence` present → create/link a `task_schedules` entry (reuse `createTaskSchedule`).

**New endpoint `GET /api/v1/policy`** → returns the canonical weights (§6 #1). Hardcode sensible defaults now; the weights are the single source of truth so frontend preview stops drifting.

## Phase C — New mission lifecycle verbs (handoff §2.2, §6 #2)

Add to `src/server.ts` (each forwards an IPC frame; add frame types to `ipc_frame_schema.ts`):

| Endpoint | IPC frame (new) | Notes |
|---|---|---|
| `POST /api/v1/missions/:id/cancel` | `mission_cancel` | **§6 #2 — NEW verb**; sets queue status `CANCELLED`/`FAILED`, emits `state_change`. Engine must honor (stop loop). |
| `POST /api/v1/missions/:id/interrupt` | `mission_interrupt` (`{force?}`) | graceful interruption (§4) → `interruption_logs` + `interruption` WS frame |
| `POST /api/v1/missions/:id/priority` | `mission_priority` (`{priority}`) | re-prioritize in `mission_queue` |
| `POST /api/v1/missions/:id/budget` | `mission_budget` (`{tokens}`) | re-allocate in `BudgetPool` |

`mission_queue` currently uses statuses `QUEUED|RUNNING|PAUSED|COMPLETED`; add `CANCELLED|INTERRUPTED|AWAITING_HUMAN|CHECKPOINTING` to match §3.2 (extend `updateMissionQueueStatus` allowed values + IPC handlers).

## Phase D — Full `GET /api/v1/budget` + BudgetPool shape (handoff §3.3)

**Edit `src/utils/budget_pool.ts`:** expose
```
toDto() -> { totalTokens, consumedTokens, reserveTokens, allocations:[{missionId,allocated,consumed}], burnRatePerMin, ceilActive }
```
- `reserveTokens = totalAllocated * MINIMUM_RESERVE_RATIO` (0.1 already constant).
- `allocations` from `consumedByMission` + `mission_queue.budget_allocated_tokens`.
- `burnRatePerMin` from telemetry (`input+output tokens / elapsedMin`) — reuse existing calc in `server.ts:telemetry`.
- `ceilActive` from `loadBudgetState().ceilActive`.

**New endpoint `GET /api/v1/budget`** returning `toDto()`. Keep `GET /api/v1/budget/status` + `POST /api/v1/budget/refill` for compat.

**Wire `budget_update` WS frame:** on refill/consume, broadcast `{type:"budget_update", payload:{pool}}` on `interventionClients` (§4.1).

## Phase E — Schedules CRUD completeness (handoff §2.2, §3.4)

1. `GET /api/v1/schedules`: serialize rows → `Schedule` schema (camelCase: `cronExpr`, `intervalMinutes`, `priorityOverride`, `budgetAllocatedTokens`, `maxConcurrentRuns`, `lastStatus`, `nextTriggerAt`, `enabled`, + `attributes`). (FLAG 2)
2. `POST /api/v1/schedules`: accept `budgetAllocatedTokens` (currently `budgetTokens`); map both.
3. **New `PATCH /api/v1/schedules/:id`** → partial update (`updateTaskSchedule` already supports partial; add route).
4. **New `DELETE /api/v1/schedules/:id`** → new `deleteTaskSchedule(id)` helper in `database_helper`.
5. **`SKIPPED` status (§3.5, §6 #3):** in `scheduler.ts`, before triggering, check `budgetPool.exhausted(sched.budget_allocated_tokens)`; if so set `lastStatus:"SKIPPED"` and **skip** the `prompt_submit`. This is the amber "skipped (budget)" pill the UI renders distinctly.

## Phase F — Mission detail endpoints (handoff §2.2, timeline)

1. **New `GET /api/v1/missions/:id/checkpoints`** → `dbHelper.getCheckpointsByMission(missionId)` → `CheckpointRecord[]`.
2. **New `GET /api/v1/missions/:id/interruptions`** → `dbHelper` query over `interruption_logs` → `InterruptionRecord[]`.
3. **`GET /api/v1/missions` serializer:** map `mission_queue` (+ new columns) → `Mission` schema (§3.2) including `attributes`, `tasksTotal`, `tasksDone`, `preemptedBy`, `lastCognition`, `latestCheckpointIteration`, `queuedAt`, `startedAt`, `completedAt`. (FLAG 2)
4. **`GET /api/v1/decisions?missionId=`** → honor the query param instead of hardcoding `"001"` (`server.ts:153`).

## Phase G — WS frame fan-out (handoff §4.1)

In `server.ts` IPC `data` handler, additionally forward/broadcast on the **intervention** socket (and cogni­tion where relevant):
- `checkpoint` → from `mission_checkpoint` IPC frame (add type).
- `interruption` → from `interruption_logs` insert.
- `tool_execution` → already parsed for telemetry; also broadcast to intervention clients.
- `alert` → new IPC type `{severity, message, mission_id?}` → broadcast to intervention clients.
- `budget_update` → Phase D.
- `mission_update` → on queue status change, broadcast `{type:"mission_update", payload:{missions:[...]}}` so the Fleet tab updates live.

Unknown `type`s already ignored by frontend — safe to add incrementally.

## Phase H — `jobs/resume` reject + free-text (handoff §4.3, plan open Q#1)

**Edit `src/server.ts` `POST /api/v1/jobs/resume` + `ipc_frame_schema.ts` `HumanDirectiveSchema`:**
- Accept `approved:false` ⇒ reject path (close captcha, set `human_interventions` `resolution:"REJECTED"`, broadcast `state_change`/`alert`).
- Thread `choice` (clarification selection) and `answer` (free-text) into the `human_directive` payload so the engine directive includes them.
- Create/resolve a `human_interventions` row (`resolved_at` set) for audit.

## Phase I — `GET /api/v1/tags` (handoff §2.2 [NEW])

New endpoint returning distinct tag strings. Source: scrape `missions.attributes->tags` (and `task_schedules.attributes->tags`) — add a `dbHelper.getDistinctTags()` helper. Used only for autocomplete; degrades to `[]`.

---

## Phase J — Doc corrections (decided via architecture-plan review)

Not code, but required to stop the false "repo-root `src/` is the PWA" premise propagating:

1. **`.kilo/plans/1783723407820-complete-architecture-upgrade.md`:**
   - §4.7: drop the `POST /api/v1/jobs/resume` → `/intervention/respond` rename. State the path is kept; body extended with `approved`/`choice`/`answer`.
   - Phase 8: replace "Vite PWA in repo-root `src/` built to `dist/`" with: repo-root `src/` is the **backend** (gateway + MCP engine); the PWA is served from `src/pwa/` (rebuilt Vite build dropped in or mounted). Keep the `./src/pwa:/usr/src/app/pwa` mount.
2. **`BACKEND_CONTRACT.md`:** rewrite from the stale single-mission viewer to the fleet/multi-mission contract — add the multi-mission endpoints, the camelCase `Mission`/`Schedule`/`BudgetPool` shapes, the `jobs/resume` `choice`/`answer`/`approved:false` semantics, and the 5 extra WS frame types. Keep `GET /api/v1/auth/verify` bounce + 401 handling notes.

---

1. `npm run build` + `tsc --noEmit` must stay green after each phase.
2. `npm test` (existing `tests/**`) must pass — especially `budget_pool`, `priority_queue`, `scheduler`, `ipc_frame_schema`, `migrations` suites (don't break their expectations).
3. Manual: start gateway (`npm run dev:gateway`), hit each new/changed endpoint with `curl` + `X-Kore-Core-Token`, confirm camelCase `Mission`/`Schedule`/`BudgetPool` shapes.
4. WS: connect both sockets, trigger a schedule SKIP (exhaust pool) and a captcha, confirm `budget_update`/`checkpoint`/`interruption`/`alert` frames arrive.
5. Confirm `GET /api/v1/missions` now shows computed `priority` + `attributes` for a mission launched with the attribute editor.

## Suggested order
A → B → F (so Fleet + detail tabs light up) → D → E → C → G → H → I. Each phase is independently shippable and degrades gracefully on the frontend side.
