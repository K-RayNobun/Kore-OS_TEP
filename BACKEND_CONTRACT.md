# Kore OS Control Center — Backend Contract (Fleet / Multi-Mission)

> **Purpose:** Authoritative contract between the PWA frontend and the Core Engine gateway
> (`src/server.ts`). Derived from the actual gateway implementation and the PWA handoff memo
> (`1783723407821-PWA-HANDOFF-TO-BACKEND.md`). Endpoints that fail degrade to `null`/`[]` on the
> client, so new endpoints can ship incrementally.
>
> Legend: **[IMPLEMENTED]** — the gateway returns this today. **[NEW]** — added by the backend
> upgrade to satisfy the fleet PWA. All REST calls send `X-Kore-Core-Token`.

---

## 0. Connection model

- **Gateway base URL** (`baseUrl`): user-entered in login, stored in `localStorage["kore_url"]`,
  default `https://vps-ip:3000`. All REST calls are rooted here.
- **WebSocket URL**: `baseUrl.replace(/^http/, 'ws') + "/api/v1/stream/cognition?token=" + token`
  (and `/stream/intervention`). `https→wss`, `http→ws`.
- **CORS**: gateway allows `KORE_CORS_ORIGIN` (default `http://localhost:5173`) + `http://localhost:3000`
  and the `X-Kore-Core-Token` header.
- **Auth**: `X-Kore-Core-Token` on every REST request; same token as `?token=` on WS. Invalid/missing
  token → `401` on every route. `GET /api/v1/auth/verify` returns `200` when valid; the PWA bounces to
  login on `401`.
- **Repo layout**: repo-root `src/` is the **backend** (gateway + MCP engine + utils + tools). The PWA
  is served from `src/pwa/` (or an external build mounted there). The backend is NOT built into the PWA.

---

## 1. REST endpoints

### 1.1 Already-present fleet endpoints

| Method & path | Use | Success response |
|------|------|------------------|
| `GET /api/v1/telemetry` | 3s poll → gauges | `{cpu, ramUsed, ramTotal, inputTokens, outputTokens, burnRate, ceilActive, budgetRemaining, budgetTotal}` |
| `POST /api/v1/telemetry/budget` | toggle global brake | `{status, ceilActive}` |
| `GET /api/v1/auth/verify` | login gate | `200` |
| `GET /api/v1/decisions?missionId=` | journal (per mission) | `DecisionRecord[]` |
| `GET /api/v1/processes` | process list | `ProcessRecord[]` |
| `GET /api/v1/captcha/active` | poll fallback | `{id, url}` or `null`/204 |
| `POST /api/v1/jobs/resume` | resolve intervention | `{status, taskId, approved}` (see §4) |
| `GET /api/v1/missions/:id/artifacts` | gallery | `{mission_id, artifacts:[...]}` |
| `GET /api/v1/artifacts/download/:id` | download | binary + headers |
| `WS /api/v1/stream/cognition` | cognition frames | `{intent, rationale, session_id?}` |
| `WS /api/v1/stream/intervention` | state/intervention frames | `{type, payload, session_id?}` (see §3) |

### 1.2 NEW endpoints (degrade to `null`/`[]` if absent)

| Method & path | Body / query | Success | Maps to |
|------|------|----------|---------|
| `GET /api/v1/missions` | — | `Mission[]` (§2.1) | fleet board |
| `POST /api/v1/missions/start` | `{prompt, missionId?, attributes}` | `{status, mission_id}` | launch sheet |
| `POST /api/v1/missions/:id/pause` | `{}` | `{status, mission_id}` | |
| `POST /api/v1/missions/:id/resume` | `{}` | `{status, mission_id}` | |
| `POST /api/v1/missions/:id/cancel` | `{}` | `{status, mission_id}` | [NEW verb] |
| `POST /api/v1/missions/:id/interrupt` | `{force?}` | `{status, mission_id}` | graceful interrupt |
| `POST /api/v1/missions/:id/priority` | `{priority}` | `{status, mission_id, priority}` | |
| `POST /api/v1/missions/:id/budget` | `{tokens}` | `{status, mission_id, tokens}` | |
| `GET /api/v1/missions/:id/checkpoints` | — | `CheckpointRecord[]` | timeline |
| `GET /api/v1/missions/:id/interruptions` | — | `InterruptionRecord[]` | timeline |
| `GET /api/v1/missions/:id/state` | — | legacy state snapshot | |
| `GET /api/v1/budget` | — | `BudgetPool` (§2.3) | budget bar |
| `POST /api/v1/budget/refill` | `{tokens}` | `{status, remaining, totalAllocated}` | pool refill |
| `GET /api/v1/budget/status` | — | `{remaining, totalAllocated}` | legacy |
| `GET /api/v1/schedules` | — | `Schedule[]` (§2.4) | scheduler |
| `POST /api/v1/schedules` | `Partial<Schedule>` | `{status, id}` | create |
| `PATCH /api/v1/schedules/:id` | `Partial<Schedule>` | `{status, id}` | edit |
| `DELETE /api/v1/schedules/:id` | — | `{status, id}` | remove |
| `POST /api/v1/schedules/:id/toggle` | `{enabled}` | `{status, id, enabled}` | legacy toggle |
| `GET /api/v1/policy` | — | `{weightUrgency, weightImportance, categoryBias, reservePct}` | priority preview |
| `GET /api/v1/tags` | — | `string[]` | tag autocomplete |

> The PWA sends **semantic mission attributes** on `POST /missions/start` and the engine **owns the
> canonical priority** (computed from `urgency`/`importance`/`category`, see `GET /policy`). A raw
> `priority` integer is still accepted as a fallback. Recurring attributes create a linked schedule.

---

## 2. Response shapes (camelCase — serialized at the API boundary)

### 2.1 `Mission` (from `GET /api/v1/missions`)
```jsonc
{
  "missionId": "mission-1699",
  "prompt": "…",
  "status": "RUNNING",            // QUEUED|RUNNING|PAUSED|AWAITING_HUMAN|INTERRUPTED|CANCELLED|COMPLETED|FAILED|CHECKPOINTING
  "priority": 42,
  "attributes": { "urgency": 0, "importance": 0, "category": "standard", "tags": [], "recurrence": {"kind":"none"} },
  "budgetAllocated": 80000,
  "budgetConsumed": 1234,
  "tasksTotal": 12,
  "tasksDone": 3,
  "preemptedBy": null,
  "lastCognition": "INTENT: …",
  "latestCheckpointIteration": 42,
  "queuedAt": "…", "startedAt": "…", "completedAt": "…"
}
```

### 2.2 `CheckpointRecord` / `InterruptionRecord`
```jsonc
// checkpoints
{ "id": 1, "missionId": "m1", "taskId": null, "loopIteration": 42, "createdAt": "…" }
// interruptions
{ "id": 1, "missionId": "m1", "taskId": null, "reason": "…", "toolPid": null, "cleanupStatus": "PENDING", "createdAt": "…" }
```

### 2.3 `BudgetPool` (from `GET /api/v1/budget`)
```jsonc
{
  "totalTokens": 500000,
  "consumedTokens": 120000,
  "reserveTokens": 50000,
  "allocations": [{ "missionId": "m1", "allocated": 80000, "consumed": 12000 }],
  "burnRatePerMin": 1500,
  "ceilActive": false
}
```

### 2.4 `Schedule` (from `GET /api/v1/schedules`)
```jsonc
{
  "id": 1,
  "name": "Daily health audit",
  "prompt": null,
  "cronExpr": "0 6 * * *",
  "intervalMinutes": null,
  "nextTriggerAt": "…",
  "enabled": true,
  "priorityOverride": 30,
  "budgetAllocatedTokens": 10000,
  "maxConcurrentRuns": 1,
  "lastStatus": "SUCCESS",   // SUCCESS|FAILED|SKIPPED  ← SKIPPED = budget-exhausted, rendered amber
  "lastRunAt": "…",
  "attributes": null
}
```

---

## 3. WebSocket — intervention socket (`/stream/intervention`)

Frames carry a `type` discriminator + optional `session_id`. Unknown types are ignored.

| `type` | `payload` | Meaning |
|--------|-----------|---------|
| `state_change` | `{state, mission_id, task_id?}` | mission status changed |
| `intervention_request` | `{intervention_type:'captcha'|'clarification', task_id?, url?, question?, choices?:string[]}` | enqueue intervention |
| `artifact_manifest` | `{artifacts:[...]}` | new artifacts |
| `mission_update` | `{missions: Mission[]}` | full fleet upsert (live board) |
| `budget_update` | `{pool: BudgetPool}` | pool changed |
| `checkpoint` | `{mission_id, loop_iteration?}` | timeline entry |
| `interruption` | `{mission_id, reason?, tool?, cleanup_ok?}` | timeline + alert |
| `tool_execution` | `{mission_id, tool, status}` | timeline |
| `alert` | `{severity:'info'|'warning'|'critical', message, mission_id?}` | notification center |

The **cognition socket** (`/stream/cognition`) accepts both `{intent, rationale}` (routed to
`missionId:'global'`) and `{intent, rationale, session_id}` (routed to that mission). `session_id`
is emitted where available; otherwise frames land in the global stream.

---

## 4. `POST /api/v1/jobs/resume` (intervention resolution)

Body is one of:
```jsonc
{ "sessionId": "42", "approved": true }                       // approve (legacy)
{ "sessionId": "42", "approved": false }                      // reject / give up
{ "sessionId": "42", "approved": true, "choice": "Link B" }  // clarification choice
{ "sessionId": "42", "approved": true, "answer": "use v2" }  // free-text answer
```
The gateway maps `sessionId→taskId`, forwards a `human_directive` IPC frame (with `choice`/`answer`
threaded in), and on `approved:false` records a `REJECTED` `human_interventions` row. **The path is
kept** (`/jobs/resume`), not renamed to `/intervention/respond`.

---

## 5. Field-type invariants

- Telemetry numbers are JSON numbers; `ramTotal > 0`.
- `id` fields are strings; arrays are JSON arrays (empty `[]` allowed).
- `captcha/active` pending = `{id, url}`; idle = `null` (200) or 204.
- `Schedule.lastStatus: "SKIPPED"` is an operational signal (budget exhausted), not a failure.
- `Mission.status` accepts the extended set above (incl. `CANCELLED`, `INTERRUPTED`, `AWAITING_HUMAN`).

---

*Supersedes the earlier single-mission `BACKEND_CONTRACT.md`. The backend is the source of truth; the
PWA degrades gracefully for any endpoint not yet returned.*
