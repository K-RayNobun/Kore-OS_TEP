# Frontend Implementation Guide — Kore OS Control Center

> **Purpose:** Tell you exactly what to build, what backend terms mean, and how to wire the new features into the existing PWA.  
> **Audience:** Frontend developer who knows React/Vite but is new to the backend architecture.

---

## Table of Contents

1. [Big Picture: How the 3 Layers Talk](#1-big-picture)
2. [Glossary: Backend Terms You Will Hear](#2-glossary)
3. [What You Already Have vs What Is New](#3-existing-vs-new)
4. [Feature 1: Write and Send a Prompt](#4-prompt-console)
5. [Feature 2: Render Mission Artifacts](#5-artifacts-gallery)
6. [Feature 3: Live Human Interventions (CAPTCHA / Clarification)](#6-interventions)
7. [WebSocket Topology: Two Sockets, Not One](#7-websocket-topology)
8. [Testing Guide](#8-testing-guide)

---

## 1. Big Picture <a name="1-big-picture"></a>

The Kore OS system has **three running parts**:

```
[ Your PWA (React/Vite) ]  <--->  [ Fastify Gateway (Node.js, port 3000) ]  <--->  [ Core Engine (Node.js, MCP server) ]
         |                               |                                          |
     Browser HTTP/WS                 HTTP REST + WS                            Unix Socket IPC
     (localhost:5173)                (vps-ip:3000)                             (/tmp/kore-os.sock)
```

### What each part does

| Part | Responsibility | Runs on |
|------|----------------|---------|
| **PWA** | UI, user input, display logs/artifacts, show CAPTCHA overlay | Your phone / browser |
| **Gateway** | Auth, REST API, WebSocket server, file downloads, SQLite reads | VPS |
| **Engine** | Mission execution, LLM calls, browser automation, report writing | VPS |

### Why this matters to you

- **You do NOT talk to the engine directly.** Every request goes through the gateway.
- **The gateway is the only thing that serves files.** If you want to download an artifact, you call the gateway URL.
- **WebSockets are how the backend pushes real-time events to you.** There are two independent sockets.

---

## 2. Glossary <a name="2-glossary"></a>

| Term | Plain English | Why it matters to you |
|------|---------------|----------------------|
| **Gateway** | The Fastify HTTP + WebSocket server running on port 3000. It is the API boundary between your PWA and the engine. | All your `fetch()` calls and WebSocket connections go here. Base URL is user-configurable (default `https://vps-ip:3000`). |
| **Engine** | The autonomous agent loop (`src/index.ts`). It receives prompts, calls the LLM, runs Playwright, writes reports, and asks for human help. | You never call it directly. You send it a prompt via `POST /api/v1/missions/start`, and it talks back through the gateway. |
| **IPC Pipe / Unix Socket** | A local file at `/tmp/kore-os.sock` that the engine and gateway use to talk to each other on the same machine. It is **not** reachable from your browser. | This is internal plumbing. You do not touch it. It lets the gateway forward engine events to your WebSocket in real time. |
| **IPC Frame** | A JSON object with a `type` string and a `payload` object, sent over the Unix socket. Examples: `PROMPT_SUBMIT`, `ARTIFACT_MANIFEST`, `INTERVENTION_REQUEST`, `STATE_CHANGE`. | The gateway reads these and either pushes them to your WebSocket or persists them to SQLite. |
| **Mission** | A single AI execution run triggered by one user prompt. It has a unique `mission_id` (string), a prompt, a status, and multiple tasks. | You launch missions from the PromptConsole. You list artifacts per mission. |
| **Task** | A single step inside a mission. A mission can have many tasks. Tasks have integer IDs (`task_id`). | Interventions (CAPTCHA) are tied to a `task_id`. |
| **Artifact** | A file produced by the engine during a mission: Markdown report, CSV, reflection log, etc. | You download these via `GET /api/v1/artifacts/download/:id`. |
| **Intervention** | Any moment the engine needs human input. Two types: `captcha` (solve a puzzle) and `clarification` (answer a question). | Shown to the user as a fullscreen overlay (`InteractiveCanvas`). |
| **State Machine** | A tiny engine-side module that tracks whether the global system or a specific mission is `IDLE`, `RUNNING`, `AWAITING_HUMAN`, or `COMPLETED`. | You see it as status text and as WebSocket `state_change` frames on the intervention socket. |
| **CaptchaInterceptor** | In-memory registry on the gateway that remembers which task is currently waiting for a CAPTCHA. | Polled by `GET /api/v1/captcha/active` every 3 seconds. Cleared when the user resolves it. |
| **MCP Server** | The engine exposes tools via the Model Context Protocol on stdio. This is how an external AI client could drive the engine. | Not needed for the PWA. The PWA talks to the gateway, not MCP. |

---

## 3. Existing vs New <a name="3-existing-vs-new"></a>

### You already have (do not change unless fixing bugs)

| Feature | Implementation |
|---------|----------------|
| Login screen, token storage | `localStorage["kore_token"]`, `localStorage["kore_url"]` |
| Telemetry gauges | Poll `GET /api/v1/telemetry` every 3000 ms |
| Hard ceiling toggle | `POST /api/v1/telemetry/budget` |
| Dual journal (decisions + processes) | `GET /api/v1/decisions`, `GET /api/v1/processes` once on mount |
| Cognition stream terminal | `WS /api/v1/stream/cognition?token=...` — receives `{ intent, rationale }` frames |
| CAPTCHA polling | `GET /api/v1/captcha/active` every 3000 ms |
| CAPTCHA iframe | `/interactive?taskId=...` served from gateway, posts `resume` to parent |
| Worker release | `POST /api/v1/jobs/resume` with `{ sessionId }` |

### You need to add or change

| New Feature | What to Build |
|-------------|---------------|
| **Prompt Console** | New component + fetch to `POST /api/v1/missions/start` |
| **Artifacts Gallery** | New component + polling `GET /api/v1/missions/:id/artifacts` + download handler |
| **JournalViewer artifact links** | Optional polish: link a task row to its artifacts |
| **Intervention WS listener** | Second WebSocket to `/stream/intervention` for push-based CAPTCHA/clarification |
| **State-aware overlay** | `InteractiveCanvas` activates on `intervention_request` or `state_change: AWAITING_HUMAN` |
| **Auth verify on login** | Call `POST /api/v1/auth/verify` before entering the shell |
| **401 bounce** | Global fetch interceptor → clear storage → login screen |
| **WS reconnect** | Reconnect both sockets on drop with backoff |

---

## 4. Feature 1: Prompt Console <a name="4-prompt-console"></a>

### What it does
Lets the user type a mission goal (e.g. *"Scrape top 50 real estate listings in Douala and output a PDF"*) and launch it.

### API call

**Request**
```http
POST /api/v1/missions/start
Headers:
  X-Kore-Core-Token: <token>
  Content-Type: application/json

Body:
{
  "prompt": "Scrape the top 50 real estate listings in Douala and output a PDF",
  "missionId": "optional-string-if-you-want"
}
```

**Response (success)**
```json
{ "status": "queued", "mission_id": "mission-1699..." }
```

**Response (error)**
```json
{ "status": "error", "message": "prompt is required" }
```

**Response (gateway cannot reach engine)**
```json
{ "status": "error", "message": "IPC pipe unavailable" }
```

### Frontend behavior

1. User types prompt → clicks **Launch Mission**.
2. `fetch()` the endpoint above.
3. On success:
   - Save `mission_id` into global state (e.g. `activeMissionId`).
   - Switch the UI to show the `TerminalStream` + `ArtifactsGallery`.
   - Clear the textarea.
4. On error: show the error message inline. Do **not** bounce to login.
5. The backend returns immediately (`queued`). It does **not** wait for the mission to finish. You discover completion via:
   - `WS /stream/intervention` receiving a `state_change: COMPLETED` frame, OR
   - Polling `GET /api/v1/missions/:id/artifacts` and seeing new items appear.

### Glossary reminder
- **Mission**: the overall AI job. Has one `mission_id`.
- **Task**: a subtask inside the mission. You do not create tasks manually; the engine decomposes the prompt internally.

---

## 5. Feature 2: Artifacts Gallery <a name="5-artifacts-gallery"></a>

### What it does
Shows every file the engine produced during a mission, lets the user preview or download it.

### API calls

**List artifacts for a mission**
```http
GET /api/v1/missions/:missionId/artifacts
Headers:
  X-Kore-Core-Token: <token>

Response:
{
  "mission_id": "mission-1699...",
  "artifacts": [
    {
      "id": "artifact-1719...",
      "mission_id": "mission-1699...",
      "task_id": 42,
      "file_name": "mission_m1_technical.md",
      "file_path": "/home/elo/reports/missions/technical/mission_m1_technical.md",
      "file_size": 4096,
      "mime_type": "text/markdown",
      "created_at": "2026-07-07T02:50:00.000Z"
    }
  ]
}
```

**Download a single artifact**
```http
GET /api/v1/artifacts/download/:id
Headers:
  X-Kore-Core-Token: <token>

Response: binary file stream
  Content-Type: <mime_type from artifact record>
  Content-Disposition: attachment; filename="<file_name>"
```

### Frontend behavior

1. **Polling:** While a mission is active, poll `GET /api/v1/missions/:missionId/artifacts` every 3–5 seconds.
2. **Gallery UI:** Render each artifact as a card with:
   - File name
   - MIME type icon (📄 for PDF, 📊 for CSV, 📝 for text/markdown, 🖼️ for images)
   - File size (human-readable)
   - Created timestamp
   - **Preview** if MIME is `text/*`, `image/*`, or `application/pdf` (iframe or `<img>`).
   - **Download button** for everything else. On click, open `<a href="<baseUrl>/api/v1/artifacts/download/<id>" download>` or fetch as blob and trigger save.
3. **Real-time updates:** You can also listen to `WS /stream/intervention` for `artifact_manifest` frames and append cards immediately without waiting for the next poll.
4. **Empty state:** Show *"No artifacts yet. The mission is still running."* when the array is empty.

### Glossary reminder
- **Artifact**: a file on the VPS disk under `/home/elo/reports/missions/`. You never write to this path yourself; the engine does.
- **MIME type**: tells the browser what kind of file it is (`text/markdown`, `application/pdf`, `image/png`, etc.).
- **download URL**: `<baseUrl>/api/v1/artifacts/download/<artifact.id>`.

---

## 6. Feature 3: Live Human Interventions <a name="6-interventions"></a>

### What it does
When the engine gets stuck on a CAPTCHA or needs a business decision, the PWA immediately shows a fullscreen overlay demanding your attention.

### Two signaling channels (use both)

| Channel | Purpose | When it fires |
|---------|---------|---------------|
| `GET /api/v1/captcha/active` | Polling fallback | Returns `{ id, url }` when a CAPTCHA is pending, `null` when none. Poll every 3 s. |
| `WS /stream/intervention` | Push accelerator | Fires `intervention_request` and `state_change` frames in real time. |

**Recommended:** Open the intervention WS immediately after login. When you receive a frame, act on it. Keep the 3 s poll as a **fallback** in case the WS drops or the PWA was backgrounded.

### WebSocket frames you will receive

**State change**
```json
{
  "type": "state_change",
  "payload": {
    "state": "AWAITING_HUMAN",
    "mission_id": "mission-1699...",
    "task_id": 42
  }
}
```

**Intervention request — CAPTCHA**
```json
{
  "type": "intervention_request",
  "payload": {
    "intervention_type": "captcha",
    "task_id": 42,
    "url": "http://vps-ip:3000/interactive?taskId=42&interactive=true&showControls=true"
  }
}
```

**Intervention request — Clarification (future)**
```json
{
  "type": "intervention_request",
  "payload": {
    "intervention_type": "clarification",
    "question": "Engine found 3 identical download links. Which one should I select?",
    "choices": ["Link A", "Link B", "Link C"]
  }
}
```

### Frontend behavior

1. **On `state_change: AWAITING_HUMAN`:**
   - Immediately show the `InteractiveCanvas` overlay.
   - If an `intervention_request` arrives shortly after with a `url`, load it in the sandboxed iframe.
   - If a `clarification` arrives instead, render the question text and choice buttons.

2. **On `intervention_request` with `intervention_type: "captcha"`:**
   - Set `activeCaptcha = { id: payload.task_id.toString(), url: payload.url }`.
   - Render the overlay with `<iframe src={url} sandbox="allow-scripts allow-same-origin allow-forms">`.
   - The `/interactive` page posts `window.parent.postMessage({ type: "resume", taskId, approved }, "*")`.
   - Your listener validates `event.origin === baseUrl.origin`, then calls:
     ```http
     POST /api/v1/jobs/resume
     {
       "sessionId": "42",
       "approved": true
     }
     ```
   - On success, hide the overlay. On failure, keep it open and re-enable the button.

3. **On `intervention_request` with `intervention_type: "clarification":**
   - Render `payload.question` as text.
   - Render `payload.choices` as buttons.
   - On button click, POST to `/api/v1/jobs/resume` with `{ sessionId: String(payload.task_id), approved: true }` (or map the choice into the payload if the backend later supports it).

4. **Manual fallback button:**
   - The *"Puzzle Resolved - Release Worker"* button still works. It calls `resumeWorker(activeCaptcha.id)` with the same endpoint.

5. **Closing guarantee:**
   - After the backend accepts `jobs/resume`, it emits `intercept_end`, which clears the `CaptchaInterceptor`.
   - The next `GET /api/v1/captcha/active` poll returns `null`.
   - Your overlay should close **only** via `onResolved`, not by the poll.

### Glossary reminder
- **CAPTCHA / 2FA intercept**: a task that needs human eyes. The engine pauses the task, not the whole mission.
- **Clarification**: a text question from the engine asking the user to pick between options.
- **InteractiveCanvas**: your existing overlay component. It is being upgraded from a simple iframe into a dynamic modal that handles both CAPTCHA and clarification payloads.
- **Sandboxed iframe**: an `<iframe>` with restricted permissions (`sandbox="allow-scripts allow-same-origin allow-forms"`). The `/interactive` page is served by the gateway and posts messages to the parent window.

---

## 7. WebSocket Topology <a name="7-websocket-topology"></a>

You will manage **two** WebSocket connections. Do **not** merge them.

### Socket A: Cognition stream

| Property | Value |
|----------|-------|
| URL | `<baseUrl>/api/v1/stream/cognition?token=<urlencoded token>` |
| Auth | Query param `token` |
| Messages | **Always** `{ "intent": string, "rationale": string }` |
| Initial frame | `{ "intent": "Idle", "rationale": "" }` sent immediately on connect |
| Behavior | Latest frame **replaces** previous. No history buffer. |
| Reconnect | Yes, with backoff |

### Socket B: Intervention / state stream

| Property | Value |
|----------|-------|
| URL | `<baseUrl>/api/v1/stream/intervention?token=<urlencoded token>` |
| Auth | Query param `token` |
| Messages | **Always** objects with a `type` discriminator: `state_change`, `intervention_request` |
| Initial frame | None. Stay silent until a frame arrives. |
| Reconnect | Yes, with backoff |

### Why two sockets?

The cognition socket is **dumb**: it only ever sends `{ intent, rationale }`. The intervention socket is **typed**: it sends structured frames with a `type` field. Keeping them separate means:
- Your cognition terminal never has to check `event.data.type` before rendering.
- Your intervention handler never has to guess whether a frame is a thought or a state change.

---

## 8. Testing Guide <a name="8-testing-guide"></a>

### Prerequisites

1. **Gateway running** on port 3000 with `KORE_CORE_TOKEN` set.
2. **Engine running** on the same host so `/tmp/kore-os.sock` works.
3. **Reports directory exists:** `/home/elo/reports/missions/` (engine and gateway need write/read access).
4. **SQLite DB exists:** `/home/elo/data/tasks.db` with the new tables (`human_interventions`, `mission_artifacts`). Run `npm run build` after the latest backend changes.

### Quick smoke test (no frontend needed)

```bash
# Terminal 1: Start engine
KORE_DB_PATH="$(pwd)/home/elo/data/tasks.db" node dist/index.js

# Terminal 2: Start gateway
KORE_DB_PATH="$(pwd)/home/elo/data/tasks.db" KORE_CORE_TOKEN=testtoken node dist/server.js

# Terminal 3: Launch a mission
curl -X POST http://localhost:3000/api/v1/missions/start \
  -H "X-Kore-Core-Token: testtoken" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a short hello world report","missionId":"smoke-test"}'

# Wait ~10-30 seconds for engine to finish, then:
curl http://localhost:3000/api/v1/missions/smoke-test/artifacts \
  -H "X-Kore-Core-Token: testtoken"
```

**Expected result:** The artifacts endpoint returns an array with at least one Markdown report file. Pick its `id` and download:

```bash
curl http://localhost:3000/api/v1/artifacts/download/<that-id> \
  -H "X-Kore-Core-Token: testtoken" \
  -o /tmp/artifact.md
```

### Frontend implementation checklist

- [ ] `PromptConsole.tsx` created and wired to `POST /api/v1/missions/start`
- [ ] `pages/index.tsx` switches to mission view after launch
- [ ] `ArtifactsGallery.tsx` created and polls `GET /api/v1/missions/:id/artifacts`
- [ ] Download handler wired to `GET /api/v1/artifacts/download/:id`
- [ ] `InteractiveCanvas.tsx` upgraded to handle `captcha` and `clarification` payloads from intervention WS
- [ ] Second WebSocket opened to `/stream/intervention?token=...`
- [ ] `POST /api/v1/auth/verify` called on login
- [ ] Global 401 handler bounces to login
- [ ] Both sockets reconnect on drop with backoff
- [ ] `localStorage` keys: `kore_url`, `kore_token`

### Known gotchas

- **Do NOT** append `&interactive=true&showControls=true` to the CAPTCHA `url`. The backend already includes them.
- **Do NOT** assume the cognition socket sends anything other than `{ intent, rationale }`. If you see a message that does not have those keys, ignore it (it is a bug if it happens; the backend filters this already).
- **Do NOT** close the overlay based on the poll alone. Close it only after `POST /api/v1/jobs/resume` succeeds. The poll returning `null` is a **confirmation**, not a trigger.
- **Artifact paths can be long.** Use `encodeURIComponent` when building download URLs.
- **Engine may take 20-60 seconds** to finish a simple mission depending on LLM latency. Show a loading state.

---

*End of guide. If anything here conflicts with existing frontend code, the backend contract in `BACKEND_CONTRACT.md` is the source of truth.*
