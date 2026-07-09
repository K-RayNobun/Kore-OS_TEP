Here is how we must redesign the backend architecture to make these features work together seamlessly.
1. The Big Backend Structural Shift: From "Streamer" to "State Machine"
Previously, your Unix Socket and WebSockets were mostly a one-way street: the engine did work, and it broadcasted logs to your phone.
To allow prompts, artifact viewing, and CAPTCHA solving, the backend must transition into a State Machine. The gateway server needs to know exactly what state the engine is in (IDLE, RUNNING, AWAITING_HUMAN, or COMPLETED).
2. Component-by-Component Backend Changes
A. The IPC Pipe Upgrade (/tmp/kore-os.sock)
Instead of just streaming random thinking lines, the Unix socket must now support a strict, two-way JSON protocol. We need to introduce specific Message Types:
PROMPT_SUBMIT (Phone ➔ Engine): Sends the initial goal/mission script down to the engine.
INTERVENTION_REQUEST (Engine ➔ Phone): The engine pauses its loop, generates a unique challenge ID, hooks up the live browser viewport, and demands help.
INTERVENTION_RESPONSE (Phone ➔ Engine): Sends the solved CAPTCHA token or extra text details back into the engine so it can resume.
ARTIFACT_MANIFEST (Engine ➔ Phone): Signals that a mission file (PDF, scraped data table, image) has been generated and where it is saved.
B. SQLite Database Schema Expansion (database_helper.ts)
To make artifacts persistent and manage human interventions safely, we need to add new relational tables or columns to your WAL-mode SQLite database:
SQL
-- Track the specific intervention requests
CREATE TABLE IF NOT EXISTS human_interventions (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    type TEXT, -- 'CAPTCHA' or 'CLARIFICATION'
    status TEXT DEFAULT 'PENDING', -- 'PENDING', 'RESOLVED'
    payload TEXT, -- Holds the iframe URL, base64 image, or question text
    resolution TEXT, -- Holds the user's response data
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Track generated mission artifacts
CREATE TABLE IF NOT EXISTS mission_artifacts (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    file_name TEXT,
    file_path TEXT, -- Path on the VPS disk where Nginx can serve it
    file_size INTEGER,
    mime_type TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
C. Fastify Gateway Service Extensions (server.ts)
The Fastify server needs three vital additions to its API/WebSocket router:
The Interactive Canvas WebSocket Room: We must create a dedicated WebSocket namespace (/api/v1/stream/intervention). When the engine flags an INTERVENTION_REQUEST, Fastify immediately pushes this block to your phone, triggering the PWA to pop up the CAPTCHA interface and freezing the rest of the UI until resolved.
The Prompt Ingestion Endpoint: A new secure POST /api/v1/missions/start route that takes your written prompt, saves it to the SQLite database to generate a task_id, and immediately pipes it down the Unix socket to wake up the engine loop.
Static Artifact Server: We need to register fastify-static to securely serve the physical files created during the mission. When you click an artifact on your PWA, it will fetch it via a secure URL like /api/v1/artifacts/download/:id, protected by your X-Kore-Core-Token.
3. How the 3 Features Flow Together on the Backend
When you orchestrate a mission from your phone, this is the exact sequence that happens under the hood:
[ Your Phone PWA ]                 [ Fastify Gateway ]                 [ Core Agent Engine ]
        │                                  │                                     │
        │ 1. POST /api/v1/missions/start  │                                     │
        ├─────────────────────────────────>│ 2. Writes Task to DB                │
        │    (Sends your Prompt)           │ 3. Pipes JSON across Unix Socket    │
        │                                  ├────────────────────────────────────>│
        │                                  │                                     │ (Runs scraping...)
        │                                  │ <───────────────────────────────────┤
        │                                  │ 4. "Hey, I hit a CAPTCHA barrier!"  │ (Engine Freezes)
        │ 5. WebSocket Push Event          │    (Sends INTERVENTION_REQUEST)     │
        │<─────────────────────────────────┤                                     │
        │                                  │                                     │
        │ 6. User solves CAPTCHA in App    │                                     │
        ├─────────────────────────────────>│ 7. Pipes RESOLUTION JSON back       │
        │    (POST /api/v1/jobs/resume)    ├────────────────────────────────────>│
        │                                  │                                     │ (Engine Resumes)
        │                                  │                                     │ (Finishes Mission)
        │                                  │ <───────────────────────────────────┤
        │ 9. WebSocket: "Mission Done!"   │ 8. Saves final file path to DB      │
        │    (Shows Artifact Download link)│    (Sends ARTIFACT_MANIFEST)        │
        │<─────────────────────────────────┤                                     │