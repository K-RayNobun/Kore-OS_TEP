Architectural Blueprint: Kore OS Control Center Integration Plan
1. System Topology Overview
The architecture splits responsibilities cleanly between the autonomous engine and the user interface, isolating the web footprint from the agent logic.
       +────────────────────────────────────────────────────────┐
       │                 KORE CONTROL CENTER PWA                │
       │              (Next.js Static / Phone OS)               │
       └───────────────────────────▲────────────────────────────┘
                                   │ HTTPS / WebSockets
                                   │ (Protected by X-Kore-Core-Token)
+──────────────────────────────────▼──────────────────────────────────┐
│              SERVER.TS (Fastify Edge Gateway Daemon)                │
│  - Exposes REST API Endpoints       - Serves Dashboard Telemetry    │
│  - Manages WS Client Connections     - Reads SQLite DB (WAL Mode)    │
└──────────────────────────────────▲──────────────────────────────────┘
                                   │ Unix Domain Socket
                                   │ Pipe: /tmp/kore-os.sock
+──────────────────────────────────▼──────────────────────────────────┐
│               INDEX.TS (Core Agentic Engine / MCP)                 │
│  - Runs Autonomous Mission Loops    - Writes Audit Trails to SQLite  │
│  - Manages Task Queue Pools         - Spawns Isolated Tool Runtimes │
└─────────────────────────────────────────────────────────────────────┘
2. Shared Communication Layer Specification
2.1 The IPC Pipe (Unix Domain Sockets)
Location: /tmp/kore-os.sock
Protocol: Line-delimited JSON streams (\n).
Directional Flow:
index.ts (Server): Creates and binds to the socket file on initialization. It broadcasts telemetry, thinking frames, and human-intervention exceptions.
server.ts (Client): Connects to the socket file on boot. It reads the system frames and maps them to public WebSocket rooms, and writes human command payloads back into the pipe.
2.2 Database Concurrent Mode
To ensure the Fastify server reads data instantly while the agent is writing massive data trails, the SQLite engine initialization within src/utils/database_helper.ts will explicitly execute:
SQL
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
This enables lock-free concurrent execution, preventing API slow-downs on your phone during heavy scraping missions.
3. Fastify Gateway Service Architecture (src/server.ts)
This standalone daemon runs under Node 20 on your Alpine environment, exposing the interfaces required by the mobile PWA client.
3.1 Route Layout & Controller Matrix
Security Interceptor (onRequest): A global hook scans incoming headers or query strings for the exact match of X-Kore-Core-Token. Mismatches are rejected instantly with an HTTP 401 Unauthorized without invoking execution code.
Route	Method	Transport	Component / Feature Map	Description
/api/v1/stream/cognition	GET	WebSocket	Thinking Feed	Streams real-time raw thinking frames and target intents consumed from the IPC socket directly to the phone screen.
/api/v1/processes	GET	REST	Process Monitor	Queries local process tables, daemon run-levels via OpenRC hooks, and returns instantaneous statuses.
/api/v1/decisions	GET	REST	Dual-Journal Viewer	Returns relational rows from the decisions and tasks tables, highlighting errors side-by-side.
/api/v1/telemetry	GET	REST/WS	Telemetry Gauges	Returns multi-core CPU, RAM usage, and token budget metrics tracked via api_guard_middleware.ts.
/api/v1/telemetry/budget	POST	REST	Hard-Ceiling Toggle	Toggles the hardware/token emergency kill-switch in the API manager.
/api/v1/jobs/resume	POST	REST	Interactive Canvas	Forwards user CAPTCHA resolutions to the engine by calling receiveHumanReconciliationDirective.
/api/v1/wallet/cookies	POST	REST	Profile Wallet	Accepts raw JSON cookie blocks and writes them via session_manager.ts to /home/elo/.local/share/browser-context.
/api/v1/wallet/vault	POST	REST	Credential Vault	Encrypts and saves sensitive access data cleanly into the isolated storage wrapper.
4. Control Center PWA Application Layout (/pwa)
An independent web project deployed as a static-compiled Progressive Web App configured on your phone's home screen.
Stack: Next.js Static Export (output: 'export') or pure Vite + React. Compiled assets are tiny, completely static, and can be served over Nginx from the VPS or hosted externally.
Service Worker (public/sw.js): Listens to native Web Push protocol events triggered by the server. When a browser exception freezes the engine, the phone triggers an active native notification banner even when the app is completely closed.
pwa/
├── package.json
├── next.config.js               # Enforces static compilation builds
├── public/
│   ├── manifest.json            # Configures native mobile app installation
│   └── sw.js                    # Handles background push notifications
├── components/
│   ├── TerminalStream.tsx       # WebSocket Terminal UI ("Thinking Feed")
│   ├── DualJournalViewer.tsx    # Split-screen process & decision viewer
│   ├── TelemetryGauges.tsx      # Real-time SVG/CSS visual tracking wheels
│   └── InteractiveCanvas.tsx    # Iframe container for live manual CAPTCHA bypass
└── pages/
    └── index.tsx                # Main dashboard wrapper interface
5. Incremental Implementation Rollout Plan
To safely integrate these components without mutating stable operational tooling, we will stick to a 4-stage implementation track:
Stage 1: The Core Channel. Implement the WAL database mode upgrade inside database_helper.ts and construct the native IPC pipe manager.
Stage 2: The Gateway Daemon. Build src/server.ts with Fastify, including its WebSocket router and security token validation wrappers. Update docker-compose.yml to spin up this service on a public port.
Stage 3: The PWA Client. Spin up the independent React frontend application with service-worker notification wiring.
Stage 4: Engine Event Binding. Hook the streaming output loops inside agent_loop.ts and execution telemetry into the IPC broadcaster.
P.S.: Final Clarifying Questions
Which Encryption Strategy do you want to implement for the Credential Vault? Would you prefer Strategy A (using a static KORE_WALLET_SECRET in your .env for complete automation) or Strategy B (requiring you to enter a Master Password on your phone to unlock features when the server boots)?
Relational Log Capture Setup: Your existing reporter tool successfully intercepts most standard outputs. To display the exact exit codes, stdout, and stderr next to a chosen execution row in the PWA's Dual-Journal Relational Viewer, do you want us to add an explicit execution_logs text/blob column to your decisions or tasks database table, or should we have the reporter write these outputs as separate text files (e.g., reports/missions/logs/{decision_id}.log) that the server reads on-demand?