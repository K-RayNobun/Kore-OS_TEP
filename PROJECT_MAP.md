# Kore OS TEP — Project Map & Integration Contract

## Project Tree

```
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── PROJECT_MAP.md
├── .env
├── .env.example
├── .dockerignore
├── .gitignore
├── admin_identity_v2.md
├── config/
│   └── api_pool.json
├── tests/
│   ├── list_mission_tests.js
│   ├── run_mission_tests.js
│   └── mission-prompts/
│       ├── README.md
│       ├── 01-social-media-content.json
│       ├── 02-service-restart.json
│       ├── 03-code-implementation.json
│       ├── 04-browser-scraping.json
│       ├── 05-backup-then-patch.json
│       ├── 06-path-traversal-blocker.json
│       ├── 07-missing-info-blocker.json
│       ├── 08-ssrf-blocker.json
│       ├── 09-campaign-metrics.json
│       └── 10-multi-step-mission.json
├── src/
│   ├── index.ts
│   ├── task.md
│   ├── task2.md
│   ├── task3.md
│   ├── task4.md
│   ├── task5.md
│   ├── task6.md
│   ├── task7.md
│   ├── task8.md
│   ├── tools/
│   │   ├── agent_loop_tool.ts
│   │   ├── asset_optimizer.ts
│   │   ├── backup.ts
│   │   ├── binary_inspector.ts
│   │   ├── browser_automator.ts
│   │   ├── marketing_policy.ts
│   │   ├── metrics_ledger.ts
│   │   ├── network_audit.ts
│   │   ├── patch.ts
│   │   ├── playbook_compiler.ts
│   │   ├── sandbox.ts
│   │   ├── search.ts
│   │   ├── service_manager.ts
│   │   └── telemetry.ts
│   ├── utils/
│   │   ├── agent_loop.ts
│   │   ├── api_guard_middleware.ts
│   │   ├── command_validator.ts
│   │   ├── database_helper.ts
│   │   ├── git_automation_helper.ts
│   │   ├── interpreter.ts
│   │   ├── llm_client.ts
│   │   ├── network_guard.ts
│   │   ├── purge_cleaner_engine.ts
│   │   ├── realization_engine.ts
│   │   ├── reporter.ts
│   │   ├── security_guard.ts
│   │   ├── session_manager.ts
│   │   ├── task_queue.ts
│   │   ├── task_state_manager.ts
│   │   ├── tool_dispatcher.ts
│   │   └── trait_registry.ts
│   └── prompts/
│       └── agent_system_prompt.ts
```

## Runtime entry

- `src/index.ts`: MCP server bootstrap via `McpServer` + `StdioServerTransport`.
- Instantiates: `ServiceManager`, `PlaybookCompiler`, `ApiGuardMiddleware`, `GitAutomationHelper`, `MetricsLedger`, `RecursiveRealizationEngine`, `EphemeralContentPurgeEngine`.
- `serviceManager.on("taskCompleted", ...)` triggers `executeTask` for unblocked tasks.
- `executeTask(task)`: hooks reporting, commit/logging, and standard completion.
- `handleRealizationLifecycleStep(task)`: routes Code/Implement tasks through the recursive sandbox loop before completion.
- Exported hooks: `receiveHumanReconciliationDirective(taskId, approved)`, `finalizeMacroMissionState(missionId)`.

## Database layer

- SQLite via `src/utils/database_helper.ts`.
- Main table `tasks` columns: `id`, `name`, `status`, `dependency_id`, `priority`, `logic_branch`, `updated_at`, `mission_id`, `technical_report_path`, `executive_report_path`.
- Statuses used: `PENDING`, `RUNNING`, `DONE`, `SUSPENDED`, `FAILED`.
- Helpers: `createTask`, `updateTaskStatus`, `getAvailableTasks`, `getTaskById`, `setTaskReportPaths`, `setTaskLogicBranch`.
- Secondary analytics DB: `/home/elo/data/marketing_metrics.db` managed by `metrics_ledger.ts` (`campaigns` + `git_pipeline_telemetry` tables).
- Agent/mission tables: `missions`, `decisions`, `observations` managed by `agent_loop.ts` / `reporter.ts` for full audit trail.

## MCP Tools (registered in `src/index.ts`)

- `registerTelemetryTool` — OS/hardware telemetry (`/proc/meminfo` fallback to `node:os`).
- `registerSearchTool` — filesystem search with in-memory TTL cache and domain routing.
- `registerMarketingPolicyTool` — platform constraint rules for social copy.
- `registerSandboxTool` — secure isolated binary execution via `SecureSandbox` with timeout kill.
- `registerPatchTool` — surgical file text replacement.
- `registerServiceManagerTool` — OpenRC/process lifecycle (`status`, `start`, `stop`, `restart`, `kill`).
- `registerNetworkAuditTool` — `netstat` scanner for TCP/UDP sockets.
- `registerBackupTool` — transactional `.tar.gz` snapshot to `/var/backups/elo-tep`.
- `registerBinaryInspectorTool` — `file`/`ldd`/`strings` inspection with threat-string rejection via `BinaryInspector`.
- `registerAssetOptimizerTool` — FFmpeg optimization via validated profile args.
- `registerPlaybookCompilerTool` — legacy MCP wrapper around `PlaybookCompiler` class.
- `registerBrowserAutomatorTool` — Playwright Chromium automation with isolated session profiles.
- `registerMetricsLedgerTool` — campaign performance inserts + Git milestone telemetry into analytics SQLite.
- `registerAgentLoopTool` — entry point for autonomous mission execution (`start_mission`), delegates to `AgentLoop`.

## AI Admin Agent Layer

- `src/prompts/agent_system_prompt.ts`: builds the system prompt injected into the LLM. Constrains output to exact JSON schema: `{ thought, action, parameters }` or `{ thought, action: null }`.
- `src/utils/agent_loop.ts`: `AgentLoop` class orchestrates mission lifecycle: prompt decomposition via LLM, per-task reasoning loop, termination detection, final executive summary emission.
- `src/utils/interpreter.ts`: `Interpreter` class routes structured decisions to `ToolDispatcher` when `action` is present, otherwise treats as reflection.
- `src/utils/tool_dispatcher.ts`: `ToolDispatcher` maps approved `action` strings to tool implementations, validates parameters against Zod schemas, executes tools programmatically, returns `ToolResult`.
- `src/utils/reporter.ts`: `Reporter` persists AI decisions to `decisions` table, tool observations to `observations` table, and updates task state files.
- `src/utils/task_state_manager.ts`: helpers for `reports/missions/tasks/{task_id}.json` — load/save/create/append step.
- `src/tools/agent_loop_tool.ts`: registers `start_mission` MCP tool that bootstraps the autonomous loop.
- Structured decision contract is the AI’s only interface to the execution layer. No markdown, no code fences, no invented actions.

## Reporting artifacts

- `src/tools/playbook_compiler.ts`: exports `PlaybookCompiler` class AND `registerPlaybookCompilerTool(server)` MCP wrapper.
- `PlaybookCompiler.compileTechnicalReport`: appends into `reports/missions/technical/mission_{missionId}_technical.md`.
- `PlaybookCompiler.updateExecutiveReport`: overwrites `reports/missions/executive/mission_{missionId}_executive.md`.
- `PlaybookCompiler.writeReflection`: writes `reports/missions/reflection/reflection_{taskId}.md`.
- `PlaybookCompiler` base dir resolution: `process.env.KORE_REPORTS_PATH` > `path.join(process.cwd(), 'reports/missions')`.
- After compilation, `executeTask` / `Reporter` updates DB paths via `dbHelper.setTaskReportPaths(task.id, technicalPath, executivePath)`.
- `reports/missions/scraped/`: temporary scraping artifacts; eligible for purge after mission finalization.
- Reflection artifacts: `reports/missions/reflection/reflection_{taskId}.md` written by safe-brake logic and reporter.

## LLM / API layer

- `src/utils/llm_client.ts`: lightweight HTTP clients for Gemini and Zhipu using `fetch`. No external SDK dependency.
- `src/utils/api_guard_middleware.ts`: `ApiGuardMiddleware` wraps outbound LLM calls.
- Config: `process.env.KORE_API_POOL_PATH` or `config/api_pool.json` at project root.
- JSON shape: `{ providers: { <provider>: [ { id, key } ] }, default_cooldown_ms }`.
- Supported provider strings in pool: `"gemini"`, `"zhipu"`.
- Public API: `getActiveKey(provider)`, `rotateKey(provider)`, `optimizePayloadContext(rawInput, maxTokenConstraint)`, `executeWithRetry(provider, fn, retries?)`.
- Model names: Gemini uses `gemini-2.5-flash-lite`; Zhipu uses `glm-4.5-flash` via `https://api.z.ai/api/paas/v4/chat/completions`.

## Utilities

- `src/utils/security_guard.ts`: exports `SecurityGuard` class (`validateAndResolvePath`, `scanContentRisk`), plus legacy helpers `validateAndResolvePath(untrustedPath, allowedRoot)`, `sanitizeIngestedText(rawText)`, and `ALLOWED_ROOTS`.
- `src/utils/session_manager.ts`: isolated browser session directories under `/home/elo/.local/share/browser-context` with `chmod 700`.
- `src/utils/task_queue.ts`: `ConcurrencyLimiter` queue used by browser automation/asset pipelines.
- `src/utils/command_validator.ts`: hardcoded FFmpeg arg profiles; blocks arbitrary filter injection.
- `src/utils/network_guard.ts`: SSRF guard enforcing HTTP/HTTPS only and blocking private/loopback IPs.
- `src/utils/git_automation_helper.ts`: `GitAutomationHelper` for commit/branch/reset operations from `/home/elo/workspace`.
- `src/utils/trait_registry.ts`: `TraitRegistry` compiles system prompts for behavioral modes (`REALIZATION`, `CONCEPTION`).
- `src/utils/realization_engine.ts`: `RecursiveRealizationEngine` runs the 10-iteration test-and-patch loop with safe-brake reflection.
- `src/utils/purge_cleaner_engine.ts`: `EphemeralContentPurgeEngine` recursively clears staging/temporary directories on mission finalization.

## Task execution behavior

- Legacy `executeTask` flow in `src/index.ts` remains for backward compatibility.
- New autonomous path: `start_mission` → `AgentLoop.executeMission()` → per-task `runTaskLoop()`.
- Agent loop reads/writes `reports/missions/tasks/{task_id}.json` as task memory between LLM decisions.
- Termination signals: `TASK_COMPLETE` and `MISSION_COMPLETE` markers in structured decision `thought`.
- On mission completion, `AgentLoop` writes final executive summary and waits for next prompt.

## Container / Build

- `Dockerfile`: multi-stage build (Node 20 Alpine). Installs `ffmpeg`, `chromium`, Playwright deps. Creates non-root `elo` user. Enforces directory permissions and runtime user isolation.
- `docker-compose.yml`: two services: `kore-os-admin` (production profile) and `kore-os-admin-dev` (development profile with live source mount).
- `env_file`: `.env` loaded at runtime; secrets never baked into image.
- `tsconfig.json`: ESM (`module: nodenext`, `moduleResolution: nodeNext`), `target: ES2022`, `strict: true`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- Source layout: `./src` → `./dist`. Uses `node:`-prefixed imports.

## File system conventions

- Workspace root: `/home/elo/workspace`.
- Data root: `/home/elo/data`.
- Browser contexts: `/home/elo/.local/share/browser-context`.
- Reports: `reports/missions/technical/`, `reports/missions/executive/`, `reports/missions/reflection/`, `reports/missions/scraped/`.
- Task state files: `reports/missions/tasks/task_{id}.json`.
- Configs: `config/*.json` at project root. Helpers handle absence gracefully.
- Temp downloads: `/tmp/downloads`.

## Extension points for future tasks

- Hook 1: `executeTask` in `src/index.ts` — before `serviceManager.completeTask(task.id)`.
- Hook 2: `AgentLoop` in `src/utils/agent_loop.ts` — refine decomposition, termination, and retry behavior.
- Hook 3: `ToolDispatcher` in `src/utils/tool_dispatcher.ts` — add new actions and Zod schemas without breaking existing tools.
- Hook 4: `database_helper.ts` — additive columns only; prefer idempotent `PRAGMA table_info` guards.
- Hook 5: Tool files in `src/tools/*.ts` — each exports a `register*Tool(server)` function called from `index.ts`.
- Hook 6: `agent_system_prompt.ts` — tighten output contract, add few-shot examples, trim surface area.
- Hook 7: `reporter.ts` / `task_state_manager.ts` — extend state file schema or add new persistence targets.
