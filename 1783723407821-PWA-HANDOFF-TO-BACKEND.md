# TO: Backend IDE — PWA Frontend Implementation & Required Backend Accommodation

**From:** PWA Control Center (frontend) implementation
**Date:** 2026-07-11
**Companion docs:** `1783723407820-complete-architecture-upgrade.md` (your plan) · `FRONTEND_SELF_REFLECTION_PLAN.md` (frontend strategy) · `1783712346079-long-mission-engine.md` (mission engine upgrade)
**Status of frontend:** Implemented & building cleanly (`npm run build` ✓, `tsc --noEmit` ✓, Vite dev serves all modules ✓).

---

## 0. TL;DR for the backend

The frontend has been **rewritten from a single-mission viewer into a multi-mission fleet command center**. It is built **gracefully-degrading**: every endpoint it expects is called with a typed client that treats a missing/404/error response as "feature not ready yet" (resolves to `null` or `[]`), so you can land your backend phases in any order and the UI lights up feature-by-feature.

**The single most important contract change:** the frontend now sends **semantic mission attributes** (urgency, importance, recurrence, duration, tags) on mission creation and expects the engine to **own the canonical priority**. It does *not* send a raw priority integer. See §3.

Everything below is a checklist of what the PWA already calls, with the exact request/response shape and the phase in your plan that should satisfy it. If your plan already covers an endpoint, this is confirmation + the precise wire format. Where the frontend needs something **not** in your plan, it's flagged **[NEW]**.

---

## 1. What changed in the frontend (high level)

| Area | Before | After |
|------|--------|-------|
| Mental model | One active mission, single WS | Fleet of concurrent missions, two WS sockets routed by `session_id` |
| Store | Scattered `useState` + prop drilling | One normalized `useSyncExternalStore` store, keyed by `missionId` |
| Launch | Bare textarea → `POST /missions/start {prompt}` | **Attribute editor**: presets (urgent/important/free-time/periodic/long), urgency×importance steppers, live Eisenhower preview, recurrence/duration/tags, budget cap, deadline |
| Budget | Global boolean "Hard Ceiling" | **Budget pool**: total/consumed/reserve, per-mission allocations, refill, exhaustion projection; global brake demoted to emergency-only |
| Interventions | One fullscreen overlay | **Intervention queue**: captcha + clarification (choices **and free-text**) + **reject** path |
| Monitoring | Latest cognition frame only | Per-mission **cognition history** + **timeline** (state/checkpoint/tool/interruption/budget/artifact) |
| Scheduler | None | Full `task_schedules` **CRUD** UI with taxonomy attributes |
| Navigation | write/monitor toggle | Mobile **bottom-nav**: Fleet / Monitor / Schedules / Budget / Settings |
| Resilience | WS no reconnect | Reconnect w/ backoff + **REST rehydrate on reconnect** (WS has no replay) |

New/rewritten files: `src/types.ts`, `src/policy.ts`, `src/api.ts`, `src/store.ts`, `src/ws.ts`, `src/App.tsx`, and `src/components/{LaunchSheet,FleetBoard,MissionCard,MissionDetail,BudgetPanel,SchedulesPanel,HealthHeader,InterventionQueue,AlertCenter,JournalViewer}.tsx`. Removed legacy `TelemetryGauges/ThinkingFeed/ArtifactsGallery/InteractiveCanvas/PromptConsole` (replaced). No backend files touched.

---

## 2. Endpoint contract the frontend currently calls

All REST calls send `X-Kore-Core-Token` and read `401` → bounce-to-login. `GET`s that fail degrade to `null`/`[]`.

### 2.1 Already in your plan / existing — must keep working
| Method & path | Frontend use | Expected response |
|------|--------------|--------------------|
| `GET /api/v1/telemetry` | every 3s → sparklines + gauges | `{cpu, ramUsed, ramTotal, inputTokens, outputTokens, burnRate, ceilActive}` (numbers) |
| `POST /api/v1/telemetry/budget` | toggle global brake | 200 |
| `GET /api/v1/auth/verify` | login gate | 200/401 |
| `GET /api/v1/decisions` (opt `?missionId=`) | JournalViewer | `DecisionRecord[]` `{id, thought, action?, execution_logs?}` |
| `GET /api/v1/processes` | JournalViewer | `ProcessRecord[]` `{name, status}` |
| `GET /api/v1/captcha/active` | poll fallback (3s) | `{id, url}` or `null`/204 |
| `POST /api/v1/jobs/resume` | resolve intervention | 200; body extended (see §4) |
| `GET /api/v1/missions/:id/artifacts` | MissionDetail + gallery | `{mission_id, artifacts:[{id, mission_id, task_id?, file_name, file_path?, file_size, mime_type, created_at?}]}` |
| `GET /api/v1/artifacts/download/:id` | download/preview | binary w/ `Content-Type` + `Content-Disposition` |
| `WS /api/v1/stream/cognition?token=` | cognition frames | JSON `{intent, rationale}` (optionally `{session_id, intent, rationale}`) |
| `WS /api/v1/stream/intervention?token=` | intervention/state/artifact frames | `{type, payload}` (see §4) |

### 2.2 **[NEW]** Endpoints the frontend now expects (degrade to `null`/`[]` if absent)
| Method & path | Body / query | Success response | Maps to your plan |
|------|--------------|--------------------|--------------------|
| `GET /api/v1/missions` | — | `Mission[]` (schema §3.1) | Layer 6 gateway + `mission_queue` |
| `POST /api/v1/missions/start` | `{prompt, missionId?, attributes}` | `{status:'queued', mission_id, message?}` | Mission engine + taxonomy |
| `POST /api/v1/missions/:id/pause` | `{}` | 200 | Long-mission Phase 2/5 |
| `POST /api/v1/missions/:id/resume` | `{}` | 200 | Phase 2/5 |
| `POST /api/v1/missions/:id/cancel` | `{}` | 200 | **[NEW]** — not in your plan; add a cancel verb |
| `POST /api/v1/missions/:id/interrupt` | `{force?}` | 200 | Graceful interruption Phase 4 |
| `POST /api/v1/missions/:id/priority` | `{priority}` | 200 | Priority queue Phase 5 |
| `POST /api/v1/missions/:id/budget` | `{tokens}` | 200 | Budget pool Phase 3 |
| `GET /api/v1/budget` | — | `BudgetPool` (schema §3.2) | Budget pool Phase 3 |
| `POST /api/v1/budget/refill` | `{tokens}` | 200 | Phase 3 |
| `GET /api/v1/schedules` | — | `Schedule[]` (schema §3.3) | Scheduler Phase 6 |
| `POST /api/v1/schedules` | `Partial<Schedule>` | 200 | Phase 6 |
| `PATCH /api/v1/schedules/:id` | `Partial<Schedule>` | 200 | Phase 6 |
| `DELETE /api/v1/schedules/:id` | — | 200 | Phase 6 |
| `GET /api/v1/missions/:id/checkpoints` | — | `CheckpointRecord[]` | Checkpoint manager Phase 2 |
| `GET /api/v1/missions/:id/interruptions` | — | `InterruptionRecord[]` | Interruption handler Phase 4 |
| `GET /api/v1/policy` | — | `PolicyConfig` (schema §3.4) | **[NEW]** — publish priority weights |
| `GET /api/v1/tags` | — | `string[]` | **[NEW]** — autocomplete existing tags |

> **Graceful degradation note:** `getJson()` returns the fallback when status ≠ 2xx or the endpoint 404s. So these can be shipped incrementally; the UI shows "not reported by gateway yet" until each lands.

---

## 3. Mission taxonomy — the headline contract (§11 of self-reflection plan)

### 3.1 `POST /api/v1/missions/start` body
```jsonc
{
  "prompt": "Scrape top 50 listings and PDF them",
  "missionId": "optional-string",
  "attributes": {
    "urgency": 0,        // 0–4
    "importance": 0,     // 0–4
    "durationClass": "normal", // "quick" | "normal" | "long"
    "estimateMinutes": 120,   // optional
    "recurrence": { "kind": "none", "intervalMinutes": 1440, "cron": "0 6 * * *", "nextAt": "…" },
    "tags": ["security", "marketing"],
    "category": "standard",   // optional: urgent|important|free-time|periodic|long|standard
    "deadline": "2026-07-12T06:00:00Z", // optional
    "quietHours": { "start": "22:00", "end": "07:00" }, // optional
    "budgetCap": 80000,      // optional suggested cap
    "alertPolicy": "push",    // optional override: silent|in-app|push
    "preemptible": true        // optional override
  }
}
```
**Backend must:** compute canonical `priority` from `urgency`/`importance`/`category` (the frontend only *previews* it via `GET /api/v1/policy`). Persist `attributes` on the mission row. Honor `recurrence` by creating/linking a `task_schedules` entry. Treat `free-time`+`urgency:0` as **opportunistic** (run only when no higher-band work is runnable and pool > reserve).

### 3.2 `Mission` (from `GET /api/v1/missions`)
```jsonc
{
  "missionId": "mission-1699",
  "prompt": "…",
  "status": "RUNNING",          // QUEUED|RUNNING|PAUSED|AWAITING_HUMAN|INTERRUPTED|COMPLETED|FAILED|CHECKPOINTING
  "priority": 42,
  "attributes": { /* as 3.1 */ },
  "budgetAllocated": 80000,
  "budgetConsumed": 1234,
  "tasksTotal": 12,
  "tasksDone": 3,
  "preemptedBy": null,          // mission_id that preempted, if any
  "lastCognition": "INTENT: …",
  "latestCheckpointIteration": 42, // enables "resume from checkpoint" button
  "queuedAt": "…", "startedAt": "…", "completedAt": "…"
}
```

### 3.3 `BudgetPool` (from `GET /api/v1/budget`)
```jsonc
{
  "totalTokens": 500000,
  "consumedTokens": 120000,
  "reserveTokens": 50000,   // fenced minimum (frontend suggests 10%)
  "allocations": [{ "missionId": "m1", "allocated": 80000, "consumed": 12000 }],
  "burnRatePerMin": 1500,    // used for exhaustion projection
  "ceilActive": false         // legacy global brake only
}
```

### 3.4 `Schedule` (from `GET /api/v1/schedules`)
```jsonc
{
  "id": "sched-1",
  "name": "Daily health audit",
  "prompt": "Audit system health",
  "cronExpr": "0 6 * * *",     // or intervalMinutes
  "intervalMinutes": 1440,
  "nextTriggerAt": "…", "enabled": true,
  "priorityOverride": 30, "budgetAllocatedTokens": 10000,
  "maxConcurrentRuns": 1,
  "lastStatus": "SUCCESS",       // SUCCESS|FAILED|SKIPPED  ← SKIPPED matters (see 3.5)
  "lastRunAt": "…",
  "attributes": { /* same taxonomy as 3.1, minus prompt */ }
}
```

### 3.5 Behavior the frontend *depends on*
- **`SKIPPED` status** for schedules whose budget was exhausted — the UI renders it as a distinct amber "skipped (budget)" pill, an operational signal, not a failure. Please emit it.
- **Preemption semantics:** free-time paused first, then Q3, then Q2; Q1/`preemptible:false` protected. The frontend shows `preemptedBy` so the causal chain is visible.
- **Reserve fencing:** when `consumedTokens` approaches `totalTokens - reserveTokens`, the pool bar turns red and projection shows "~Xm left".

---

## 4. WebSocket frame contract (Layer 6 / Phase 2 of your plan)

Frontend `WsManager` reads `type` discriminator + optional `session_id`. Unknown types are ignored.

### 4.1 Intervention socket (`/stream/intervention`)
| `type` | `payload` | Frontend action |
|--------|------------|-----------------|
| `state_change` | `{state, mission_id, task_id?}` | update mission status; if `AWAITING_HUMAN` → enqueue intervention + alert |
| `intervention_request` | `{intervention_type:'captcha'\|'clarification', task_id?, url?, question?, choices?:string[]}` | enqueue intervention (captcha → iframe; clarification → choices **and** free-text box) |
| `artifact_manifest` | `{artifacts:[{id, mission_id, filename?, …}]}` | append to timeline + artifacts |
| `mission_update` | `{missions:[Mission]}` or partial mission fields | upsert into store |
| `budget_update` | `{pool:BudgetPool}` | replace budget |
| `checkpoint` | `{mission_id, loop_iteration?}` | timeline entry |
| `interruption` | `{mission_id, reason?, tool?, cleanupOk?}` | timeline + alert |
| `tool_execution` | `{mission_id, tool, status}` | timeline |
| `alert` | `{severity:'info'\|'warning'\|'critical', message, mission_id?}` | notification center |

### 4.2 Cognition socket (`/stream/cognition`)
Frontend accepts **both** shapes so this is non-breaking:
- legacy: `{intent, rationale}` → routed to `missionId:'global'`
- new (preferred): `{session_id, intent, rationale}` → routed to that mission's cognition history

**Ask:** emit `session_id` on cognition frames where possible (your Phase 2 "Session ID Multiplexing" — `IpcPipe` already planned to add it). Until then, frames land in the global stream, which is fine.

### 4.3 Reject + free-text on `POST /api/v1/jobs/resume` **[NEW]**
Frontend now sends one of:
```jsonc
{ "sessionId": "42", "approved": true }                       // legacy approve
{ "sessionId": "42", "approved": false }                      // NEW: reject / give up
{ "sessionId": "42", "approved": true, "choice": "Link B" } // clarification choice
{ "sessionId": "42", "approved": true, "answer": "use v2 filename" } // NEW: free-text answer
```
Backend should act on `approved:false` (your plan's open question #1) and thread `choice`/`answer` into the directive.

---

## 5. Mapping to your architecture-upgrade phases

| Your phase | Layer | Frontend expectation it must satisfy |
|-----------|-------|----------------------------------------|
| **Phase 1** | DB hardening | `human_interventions` needs `resolved_at`; missions need an `attributes` JSON column + `latest_checkpoint_iteration`; `budget_pool`/`task_schedules` tables |
| **Phase 2** | IPC hardening | `ipc_frame_schema.ts` should cover the `type` discriminator + `session_id` used in §4. `SessionManager` binding `session_id→missionId` is exactly what the frontend's `session_id` routing expects |
| **Phase 3** | Safety fixes | no frontend impact (keep `/interactive` iframe contract: absolute URL already containing `&interactive=true&showControls=true`) |
| **Phase 4** | Context economy | no frontend impact |
| **Phase 5** | Sandbox | no frontend impact |
| **Phase 6** | Telemetry/heartbeat | ensure `/telemetry` includes `burnRate`; **add** `/budget` + `/missions` + `/policy` + `/tags` as the pool comes online |
| **Phase 8** | PWA | **This memo supersedes the old `src/pwa/*` outline** in your plan. The implementation lives in the repo root `src/` (Vite app), not `src/pwa/`. Please adjust the Phase 8 file manifest and the `docker-compose` PWA mount accordingly (mount repo root `src` → `/usr/src/app/src`, serve via the existing gateway; no separate `src/pwa` dir). |

---

## 6. Three concrete asks (please confirm or push back)

1. **Publish priority weights** via `GET /api/v1/policy` returning `{weightUrgency, weightImportance, categoryBias, reservePct}`. The frontend previews priority from these so the number the operator sees *always* matches the engine's. Until you ship it, the frontend uses a hardcoded default (`{wu:12, wi:10, free-time bias:-20, reservePct:0.1}`) — but that's a guess and will drift.
2. **Add `cancel` as a mission verb** (`POST /missions/:id/cancel`). The plan only has pause/resume; the UI has a confirm-to-cancel control that currently 404s.
3. **`SKIPPED` schedule status + `resolved_at`** are the two small schema bits the UI specifically renders. Everything else degrades silently.

---

## 7. What the frontend does *not* need you to do
- Web Push / VAPID: deferred (your plan's out-of-scope). The in-app **AlertCenter** is the fallback and is already wired to `alert` WS frames.
- Replay/history on the WS: handled client-side via the **REST rehydrate on reconnect**; the WS only needs to push live deltas.
- Auth refresh / JWT: single bearer token is fine; 401 → bounce is implemented.

---

## 8. How to validate the integration (when your backend is ready)
1. `npm run dev` (PWA) against your gateway.
2. Login → Fleet tab → launch with each **preset** (urgent/important/free-time/periodic/long). Confirm `GET /missions` shows them with computed priority + attributes.
3. Open a mission → pause/resume/cancel/interrupt → confirm status + timeline update.
4. Budget tab → confirm pool bar, reserve fencing, refill.
5. Schedules tab → create a cron + interval schedule → confirm it appears and `nextTriggerAt` computes.
6. Trigger a captcha + a clarification → confirm queue, iframe, choices, **free-text**, and **reject** all work.
7. Kill the gateway → confirm WS reconnect + REST rehydrate repopulates the fleet.

The frontend is ready to consume all of the above the moment the endpoints return. No frontend change is required for steps 2–7 beyond what's already shipped.
