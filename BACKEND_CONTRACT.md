# Kore OS Control Center — Backend Contract (Frontend Assumption)

> **Purpose:** This document is the frontend's *assumed* contract with the Core Engine
> gateway. It is derived verbatim from the actual frontend code (`src/App.tsx`,
> `src/components/*`, `src/types.ts`) and from the two backend hand-off prompts already
> sent. **If the backend team validates (or corrects) every section below, both sides are
> on the same page.**
>
> Legend:
> - **[ASSUMED]** — what the frontend currently expects; not yet explicitly confirmed by a backend response.
> - **[CONFIRMED]** — stated in a backend response already received.
> - **[GAP]** — a behavior that is undefined / unhandled and needs a decision.

---

## 0. Connection model

- **Gateway base URL** (`baseUrl`): user-entered in the login screen, stored in
  `localStorage["kore_url"]`, default `https://vps-ip:3000`. All REST calls are rooted here.
- **WebSocket URL**: derived in `App.tsx` as
  `vpsUrl.replace(/^http/, 'ws') + "/api/v1/stream/cognition?token=" + encodeURIComponent(token)`.
  - `https://…` → `wss://…`; `http://…` → `ws://…`. **[CONFIRMED]** backend accepts this path.
- **CORS**: the frontend is (in dev) served from a *different* origin than the gateway
  (e.g. `http://localhost:5173` vs gateway `:3000`). The frontend assumes the gateway sends
  CORS headers permitting the PWA origin **and** the `X-Kore-Core-Token` request header.
  **[CONFIRMED]** backend configures `KORE_CORS_ORIGIN` (default `http://localhost:5173`)
  and allows that header.
- **TLS / self-signed**: default URL uses `https://vps-ip:3000` (a literal placeholder). The
  frontend makes no cert pinning or insecure-override; if the gateway uses a self-signed cert
  the browser will block it and all calls fail. **[ASSUMED]** this is handled operationally.

---

## 1. Authentication

| Item | Detail |
|------|--------|
| REST auth header | `X-Kore-Core-Token: <token>` on **every** REST request. **[CONFIRMED]** |
| WS auth | same token as query param `?token=<urlencoded>`. **[CONFIRMED]** |
| Token storage | `localStorage["kore_token"]` (plaintext). **[ASSUMED]** acceptable for self-hosted panel. |
| Invalid token | backend returns **401** on every route when `KORE_CORE_TOKEN` is set. **[CONFIRMED]** |
| Login validation | **[GAP]** the "Link Core" button does **NOT** call any verify endpoint — it just stores
  the token and enters the shell. The token is only ever validated implicitly when a real API
  call returns 401. The frontend does **not** catch 401 to bounce the user back to the login
  screen. |
| `POST /api/v1/auth/verify` | **[CONFIRMED]** implemented by backend (returns 200 if token valid) but **[GAP]** currently
  **unused** by the frontend. |

---

## 2. REST endpoints

### 2.1 `GET /api/v1/telemetry`  **[CONFIRMED]**
- **Headers:** `X-Kore-Core-Token`.
- **Polling:** every **3000 ms** (`setInterval` in `TelemetryGauges`).
- **Response shape** (`TelemetryMetrics`):
  ```json
  {
    "cpu":        <number 0–100>,
    "ramUsed":    <number>,
    "ramTotal":   <number, MUST be > 0>,
    "inputTokens":  <number>,
    "outputTokens": <number>,
    "burnRate":   <number>,
    "ceilActive": <boolean>
  }
  ```
- **Frontend usage:**
  - `cpu` rendered as a `%` bar.
  - RAM bar = `round(ramUsed / ramTotal * 100)` → **`ramTotal` must be > 0 or this divides by zero.**
  - "Daily Token Burn" label = `(inputTokens + outputTokens).toLocaleString()` + `" tx"`.
  - `ceilActive` drives the toggle button text: `true` → `"Hard Ceiling ON"` (red),
    `false` → `"Ceiling OFF"` (grey).
- **Error handling:** **[ASSUMED]** on fetch failure the previous metrics are kept (no reset,
  just `console.error`). Stale values remain visible.

### 2.2 `POST /api/v1/telemetry/budget`  **[CONFIRMED]**
- **Headers:** `Content-Type: application/json`, `X-Kore-Core-Token`.
- **Request body:** **NONE** is sent by the frontend.
- **Server effect:** **[CONFIRMED]** toggles and persists `ceilActive` (to `budget.json`).
- **Frontend assumption:** after the POST, the frontend **optimistically flips** its local
  `ceilActive` (`setMetrics(m => ({...m, ceilActive: !m.ceilActive}))`) and does **not** read
  the response. The next `GET /telemetry` (≤3 s later) is expected to confirm the new value.
  - **[GAP]** if the POST fails, the UI shows the flipped (wrong) state until the next poll
    corrects it. Frontend ignores HTTP status / body entirely.

### 2.3 `GET /api/v1/decisions`  **[CONFIRMED]**
- **Headers:** `X-Kore-Core-Token`.
- **Fetch timing:** **once on mount** (no polling).
- **Response shape** (`DecisionRecord[]`):
  ```json
  [ { "id": "<string>", "thought": "<string>",
      "action": "<string|null>", "execution_logs": "<string|null>" } ]
  ```
- **Frontend usage:** left pane lists decisions (`id`, `thought`, `action`). Clicking one shows
  its `execution_logs` in the right pane. Missing `action`/`execution_logs` render as
  `"None (Reflection)"` / `"No stdout/stderr records emitted…"`.
- **[ASSUMED]** `id` is a string; array may be empty `[]`.

### 2.4 `GET /api/v1/processes`  **[CONFIRMED]**
- **Headers:** `X-Kore-Core-Token`.
- **Fetch timing:** **once on mount** (alongside decisions).
- **Response shape** (`ProcessRecord[]`):
  ```json
  [ { "name": "<string>", "status": "RUNNING" | "STOPPED" | "<string>" } ]
  ```
- **Frontend usage:** right pane (when no decision selected) lists processes; `status ===
  "RUNNING"` → green, anything else → red.

### 2.5 `POST /api/v1/jobs/resume`  **[CONFIRMED]**
- **Headers:** `Content-Type: application/json`, `X-Kore-Core-Token`.
- **Request body:** `{ "sessionId": "<string>" }`.
- **Triggers (two):**
  1. **Manual** "Release Worker" button → `sessionId = activeCaptcha.id`.
  2. **postMessage** from the `/interactive` iframe → `sessionId = message.taskId`
     (see §4).
- **Server effect:** **[CONFIRMED]** accepts `sessionId`, maps it to `taskId` internally,
  forwards the human directive via the IPC pipe.
- **Frontend on success:** calls `onResolved()` → `App` sets `activeCaptcha = null` (overlay
  closes).
- **[GAP]** on HTTP error the overlay is **not** closed (stays open, button re-enabled). No
  retry.

### 2.6 `GET /api/v1/captcha/active`  **[CONFIRMED]**
- **Headers:** `X-Kore-Core-Token`.
- **Polling:** every **3000 ms** in `App.tsx`, only while authenticated.
- **Response when an intercept is pending:**
  ```json
  { "id": "<string>", "url": "<absolute url>" }
  ```
  - **[CONFIRMED]** `id` is the plain task-number string (e.g. `"42"`), directly usable as
    `sessionId` in `jobs/resume`.
  - **[CONFIRMED]** `url` is an **absolute** URL built from the request host and **already
    includes** `&interactive=true&showControls=true`. The frontend uses it verbatim as the
    iframe `src` (it must **NOT** append those params again).
- **Response when none active:** HTTP 200 with JSON body `null`, **or** HTTP 204 with no body.
  - Frontend: `res.status === 204` → ignored; JSON `null` → ignored; only a truthy
    `{id, url}` opens the overlay.
- **[CONFIRMED critical guarantee]** after `jobs/resume` is accepted for that session, this
  endpoint **MUST** subsequently return `null` (so the overlay closes and does **not**
  immediately reopen on the next 3 s poll).
- **Frontend opening logic:** only *opens* (`setActiveCaptcha`); the poll never *closes* it.
  Closing happens only via `onResolved`.

---

## 3. WebSocket — `GET /api/v1/stream/cognition?token=…`  **[CONFIRMED]**

- **Connection:** opened in `ThinkingFeed` on mount (re-created if `wsUrl`/`token` change).
- **Auth:** 401 if no/invalid `?token=`. **[CONFIRMED]**
- **Initial frame on connect:** `{ "intent": "Idle", "rationale": "" }`. **[CONFIRMED]**
- **Subsequent frames** (`CognitionFrame`):
  ```json
  { "intent": "<string>", "rationale": "<string>" }
  ```
- **Frontend handling:** `ws.onmessage` does `JSON.parse(event.data)` and `setFeed(data)`.
  The latest frame **replaces** the previous one (no history/scrollback buffer beyond the
  current frame).
- **[ASSUMED / IMPORTANT]** **every** message on this socket is a `CognitionFrame`. There is
  **no `type` discriminator**. If the backend ever sends a different message shape here, the
  frontend will mis-render it as `{intent, rationale}`.
- **[GAP]** no reconnect logic; on `ws.onerror` it only `console.error`s. A dropped socket
  leaves the last frame on screen with no "disconnected" indicator.

---

## 4. CAPTCHA / 2FA intercept flow (end-to-end)

This is the full assumed sequence; **[CONFIRMED]** where the backend response agrees.

1. Backend detects an intercept → `GET /api/v1/captcha/active` returns `{id, url}`.
2. Frontend poll (§2.6) opens `InteractiveCanvas` overlay with `sessionId = id`,
   `debugUrl = url`.
3. Overlay renders a sandboxed `<iframe src={url}>` with
   `sandbox="allow-scripts allow-same-origin allow-forms"`.
4. The `/interactive` page (**served by backend, auth-exempt**) lets the human solve the
   puzzle. **[CONFIRMED]** `GET /interactive` is public (no `X-Kore-Core-Token` required).
5. When solved, `/interactive` calls `window.parent.postMessage({ type: "resume", taskId,
   approved }, "*")`. **[CONFIRMED]**
6. **Frontend listener** (`window.addEventListener("message")` in `InteractiveCanvas`):
   - Validates `event.origin === new URL(baseUrl).origin` (ignores messages from other
     origins). **[ASSUMED]** the iframe's origin equals the gateway origin.
   - If `data.type === "resume"` → calls `resumeWorker(data.taskId ?? sessionId)`.
7. `resumeWorker` → `POST /api/v1/jobs/resume` with `{ sessionId: String(taskId) }` → on
   success `onResolved()` closes the overlay.
8. **Manual fallback:** the "Puzzle Resolved - Release Worker" button also calls
   `resumeWorker(sessionId)` with the overlay's `id`. **[ASSUMED]** this remains valid even
   though the primary path is the postMessage.
9. After resume, `captcha/active` returns `null` (§2.6 guarantee) so the overlay stays closed.

---

## 5. PWA shell (static, not backend-served)

- `public/manifest.json` — name `Kore OS Control Center`, icons `icon-192.png` / `icon-512.png`.
- `public/sw.js` — service worker registered in `main.tsx`. Contains install/activate/push/
  notificationclick handlers.
- **[GAP]** Web Push handlers exist but there is **no** VAPID/subscription wiring on the
  frontend, and push is **not** used to trigger the captcha overlay (we use the REST poll in
  §2.6). If Web Push is desired for "intervention alerts," a subscription endpoint + frontend
  registration must still be designed.

---

## 6. Field-type invariants (must hold or UI breaks)

- All numeric telemetry fields are JSON **numbers**, not strings.
- `ramTotal > 0`.
- `id` fields are **strings** (decisions, captcha).
- Arrays (`decisions`, `processes`) are JSON arrays (empty `[]` allowed).
- `captcha/active` pending response is exactly `{ "id": string, "url": string }`; idle is
  `null` (200) or 204.

---

## 7. Open questions for the backend (need decisions)

1. **Rejection path:** when `/interactive` emits `approved: false`, what should happen?
   Frontend currently only acts on `type: "resume"`. Should a rejection (a) just close the
   overlay, (b) POST a rejection to a new endpoint (e.g. `/api/v1/jobs/reject`), or (c)
   something else?
2. **Intercept lifetime:** if the human never solves it, does `captcha/active` keep returning
   the same `id` forever? Is there an expiry/timeout after which it auto-clears?
3. **401 UX:** frontend does not currently bounce to login on 401. Should it? (Affects whether
   `auth/verify` should be called at login.)
4. **WS resilience:** no reconnect on drop — acceptable, or should the frontend attempt
   reconnect?
5. **Mixed message types on cognition socket:** confirmed the socket is cognition-only; if any
   other message type will ever be sent there, the contract needs a `type` discriminator.

---

*End of contract. Backend: validate each `[ASSUMED]`/`[GAP]` item; correct any mismatch and

the frontend will be adjusted accordingly.*