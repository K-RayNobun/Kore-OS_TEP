# Backend Contract Validation — BACKEND_CONTRACT.md

> **Purpose:** Map every item in `BACKEND_CONTRACT.md` to the *actual* backend implementation, then grade each difference by modifiability.  
> **Date:** 2026-07-07

---

## Summary Scorecard

| Category | Status |
|----------|--------|
| Connection model | ✅ Match |
| Authentication | ✅ Match |
| `GET /api/v1/telemetry` | ⚠️ Partial — shape matches, WS message routing needs filter |
| `POST /api/v1/telemetry/budget` | ✅ Match |
| `GET /api/v1/decisions` | ✅ Match |
| `GET /api/v1/processes` | ✅ Match |
| `POST /api/v1/jobs/resume` | ⚠️ Partial — endpoint shape matches, but `approved` flag not forwarded yet |
| `GET /api/v1/captcha/active` | ✅ Match |
| `GET /interactive` | ✅ Match |
| WS `/api/v1/stream/cognition` | ⚠️ Partial — auth + initial frame match, but backend currently forwards **all** IPC frame types instead of only CognitionFrame shapes |
| `POST /api/v1/auth/verify` | ✅ Match (exists, unused by FE — frontend gap) |
| Field-type invariants | ✅ Match |

---

## Detailed Diff & Modifiability

### 0. Connection model
- **Base URL + WS derivation:** Backend does not hardcode any base URL; WS path is `/api/v1/stream/cognition?token=...` exactly as frontend derives.  
  **Modifiability:** N/A — already matches.

### 1. Authentication
- **REST header + WS query param:** Implemented in `server.ts` global `onRequest` hook.  
- **401 rejection:** 401 returned when `KORE_CORE_TOKEN` is set and token mismatches.  
- **`/api/v1/auth/verify`:** Exists, returns `{ status: "ok" }` when token passes hook.  
  **Modifiability:** None needed.  
  **Note for frontend:** Frontend does not call this on login. This is a **frontend gap**, not a backend one.

### 2.1 `GET /api/v1/telemetry`
- **Shape:** Returns `cpu` (0–100 %), `ramUsed`, `ramTotal`, `inputTokens`, `outputTokens`, `burnRate`, `ceilActive`. All numbers are JSON numbers.  
- **Token counters:** Cumulative counters live in `AgentLoop` and flow to the gateway via the IPC pipe. The gateway updates `lastTelemetryResponse` on every `thinking`, `tool_execution`, and `mission_complete` frame.  
- **Fallback if IPC unavailable:** Gateway reads `lastTelemetryResponse` sync; if engine is down, counters stay at `0`. Frontend keeps previous metrics per its own assumption.  
  **Modifiability:** None needed for shape.  
  **Risk:** Low. If the engine is not running, `burnRate` will be `0` and token counts will be stale. Frontend already handles this per its assumed error behavior.

### 2.2 `POST /api/v1/telemetry/budget`
- **Toggles `ceilActive`** and persists to `/home/elo/data/kore-vault/budget.json`.  
- **Request body:** Optional. Frontend sends none.  
  **Modifiability:** None needed.

### 2.3 `GET /api/v1/decisions`
- **Shape:** `[{ id: string, thought: string, action: string | null, execution_logs: string | null }]`.  
- `execution_logs` is assembled from the new `execution_logs` table joined on `task_id`.  
- **Fetched once on mount:** Frontend concern, not backend.  
  **Modifiability:** None needed.

### 2.4 `GET /api/v1/processes`
- **Shape:** `[{ name: string, status: "RUNNING" | "STOPPED" | string }]`.  
- Uses `ps -eo pid,comm,stat` and maps exit-state zombies to `STOPPED`.  
  **Modifiability:** None needed.

### 2.5 `POST /api/v1/jobs/resume`
- **Frontend contract:** `{ "sessionId": "<string>" }`.  
- **Current backend:** Accepts `sessionId`, validates it, forwards `human_directive` via IPC.  
- **Gap:** Currently hardcodes `approved: true` in the IPC frame. The `/interactive` iframe already sends `approved` in `postMessage`, but the gateway does not forward it.  
  **Modifiability:** **Easy backend change.**  
  **Impact:** If the frontend later sends `{ sessionId, approved: false }` (or is updated to do so), the backend can simply read `body.approved` and forward it. `receiveHumanReconciliationDirective` already accepts the boolean. No schema or endpoint changes required.  
  **Recommendation:** Accept `approved` opt-in now so rejection handling is available the moment the frontend wires it up.

### 2.6 `GET /api/v1/captcha/active`
- **Shape when pending:** `{ id: string, url: string }`.  
- **Shape when idle:** HTTP 200 with JSON `null` (frontend also tolerates 204).  
- **`id` value:** Plain task number string (e.g. `"42"`), directly usable as `sessionId`.  
- **`url` value:** Absolute URL built from request host + `/interactive?taskId=...` + `&interactive=true&showControls=true`.  
- **Clear-after-resume guarantee:** Backend emits `intercept_end` from `receiveHumanReconciliationDirective`, which clears `CaptchaInterceptor.active`. Gateway ingests this via its IPC client. Next poll returns `null`.  
  **Modifiability:** None needed.

### 3. WS `/api/v1/stream/cognition?token=...`
- **Auth:** 401 if token missing/invalid. ✅  
- **Initial frame:** Sends `{ "intent": "Idle", "rationale": "" }` on connect. ✅  
- **CRITICAL GAP — message shape contract:**  
  The frontend **assumes every message is a `CognitionFrame`** (`{ intent, rationale }`) with **no `type` discriminator**.  
  **Current backend behavior:** The gateway's IPC client forwards **every** IPC frame straight to all WS clients, including `mission_start`, `task_start`, `thinking`, `tool_execution`, `mission_complete`, `intercept_start`, `intercept_end`, and `telemetry_response`. None of these except `thinking` have `{ intent, rationale }` shape.  
  **Impact:**  
  - Non-thinking frames will either blank the terminal or render garbage if the frontend tries `event.data.intent` / `event.data.rationale`.  
  - The frontend will mis-render every non-cognition frame as a blank or malformed entry.  
  **Modifiability:** **Medium — requires a WS-side adapter.**  
  **Fix path:**  
  1. In `server.ts`'s IPC `data` handler, filter frames before broadcasting to `cognitionClients`.  
  2. Only forward `thinking` frames (and maybe map `mission_start` / `mission_complete` to special cognition frames if desired).  
  3. Transform `thinking` payload: `{ intent: payload.action || "thinking", rationale: payload.thought }`.  
  4. Keep all other frame types on the IPC bus for the gateway's REST routes, but **do not** push them to the cognition socket.  
  **Breaking-risk:** Low. This is a backend-only change. Frontend continues to receive `CognitionFrame`-shaped messages only.

### 4. CAPTCHA / 2FA intercept flow
- **Sequence:** `intercept_start` → `captcha/active` returns truthy → frontend opens overlay → `/interactive` iframe → human approves/rejects → `postMessage` → frontend calls `jobs/resume` → backend clears intercept → `captcha/active` returns `null`.  
- **`/interactive` auth exemption:** Implemented. Public page reachable without token.  
- **postMessage payload:** Includes `taskId` and `approved`.  
  **Modifiability:** Already matches the confirmed path.

### 5. PWA shell / push
- **Web Push / VAPID:** Not implemented. Contract marks this as a `[GAP]`.  
  **Modifiability:** Out of scope for this backend pass; requires new subscription endpoint + frontend push wiring.

### 6. Field-type invariants
- All numbers are JSON numbers.  
- `ramTotal > 0`.  
- `id` fields are strings.  
- Arrays are JSON arrays (empty `[]` allowed).  
- `captcha/active` pending = `{ id, url }`, idle = `null`/204.  
  **Modifiability:** None needed. Verified by manual `curl` tests.

### 7. Open questions from contract

| # | Question | Backend State | Modifiability |
|---|----------|---------------|---------------|
| 1 | Rejection path (`approved: false`) | `/interactive` iframe sends `approved: false` in `postMessage`, but gateway currently hardcodes `approved: true` in the IPC frame. `receiveHumanReconciliationDirective` already supports boolean. | **Easy.** Read `body.approved` in `/jobs/resume` and forward it. No schema change needed. |
| 2 | Intercept lifetime / expiry | `CaptchaInterceptor` holds the active intercept indefinitely until `intercept_end`. No auto-clear timeout. | **Easy backend change** if desired: add a TTL (e.g. 1 h) and auto-return `null` after expiry. |
| 3 | 401 UX (bounce to login) | Backend returns 401 correctly. Does not implement frontend redirects. | Frontend change required. |
| 4 | WS resilience (reconnect) | Backend does not need to change; reconnect is purely a frontend concern. | Frontend change required. |
| 5 | Mixed message types on cognition socket | **This is the breaking mismatch.** Backend forwards *all* IPC frame types; frontend expects *only* `CognitionFrame`. | **Medium** — WS adapter filter needed (see §3). |

---

## Overall Verdict

- **Backend is ~90% aligned** with the frontend contract.  
- **One breaking mismatch:** the cognition WebSocket forwards every IPC frame instead of only `{ intent, rationale }` frames. This **must** be fixed before the PWA connects, or the terminal will blank/misrender whenever the engine emits non-thinking frames.  
- **One easy improvement:** forward the `approved` boolean through `/jobs/resume` so the frontend's future rejection path works without a schema change.  
- **Everything else is either a frontend gap or non-breaking.**
