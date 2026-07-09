# Kore OS — AI Admin Agent Architecture Plan

## 1. Core Concept

The system is an **autonomous AI agent server** (not a deterministic task queue). A human operator sends a high-level mission prompt via the MCP interface. The AI Admin reasons step-by-step, emits structured JSON decisions, and a deterministic interpreter/executor/reporter pipeline carries them out. Every action and observation is persisted for audit and fed back into the AI's next reasoning step via a **task state file**.

---

## 2. High-Level Flow

```
Human operator sends initial mission prompt via MCP interface
         ↓
[Agent Loop wakes up — runs until mission is fully DONE]
  │
  ├─ Evaluate prompt depth
  │   ├─ Long/complex → decompose into explicit tasks using project state + DB context
  │   └─ Short/simple  → clarify into single explicit task
  │
  ├─ For each task, repeat until task is DONE:
  │   ├─ Load task state file (contains all prior observations for this task)
  │   ├─ ONE reasoning step: AI reads task state file, reasons, emits decision JSON
  │   ├─ Interpreter routes:
  │   │   - action present → ToolDispatcher → tool execution → observation
  │   │   - action null     → reflection/planning → log only
  │   ├─ Reporter persists:
  │   │   - AI thought      → DB decisions
  │   │   - tool result     → DB observations
  │   │   - updates task state file with new observation
  │   └─ AI loop continues internally (NO new prompt from operator between steps)
  │
  ├─ All tasks DONE → emit final executive summary/report
  └─ System waits for operator's next prompt
```

**Key design points:**
- The AI loop runs continuously after the initial prompt. There is no re-prompting between steps.
- The task state file is the only feedback mechanism. No "Feedback Pump."
- `action: null` is a reflection/planning step, not a termination signal.
- Termination only happens when all tasks in a mission are `DONE`.

---

## 3. What Already Exists

| Component | Location | Role |
|-----------|----------|------|
| `McpServer` + `StdioServerTransport` | `src/index.ts` | MCP server entry point |
| 12 registered MCP tools | `src/tools/*.ts` | Capabilities (browser, service mgr, patch, backup, etc.) |
| `ApiGuardMiddleware` | `src/utils/api_guard_middleware.ts` | LLM call wrapper with key rotation, retry, context optimization |
| `DatabaseHelper` | `src/utils/database_helper.ts` | SQLite `tasks` table CRUD |
| `PlaybookCompiler` | `src/tools/playbook_compiler.ts` | Technical/executive report file generation |
| `GitAutomationHelper` | `src/utils/git_automation_helper.ts` | Git commit/rollback |
| `MetricsLedger` | `src/tools/metrics_ledger.ts` | Secondary analytics DB for campaigns/Git telemetry |
| `EphemeralContentPurgeEngine` | `src/utils/purge_cleaner_engine.ts` | Cleanup of temporary artifacts |

**Gap:** No agent loop, no interpreter, no structured I/O with the LLM, no new DB tables for missions/decisions/observations, no task state files, no internal tool dispatcher.

---

## 4. What Must Be Built

### 4.1 New Database Tables

| Table | Purpose |
|-------|---------|
| `missions` | High-level goals from the human operator |
| `decisions` | Every AI output (tool call or reflection) |
| `observations` | Tool execution results |

Existing `tasks` table remains for backward compatibility.

### 4.2 AI Agent Loop (`src/utils/agent_loop.ts`)

Responsibilities:
- Accept mission prompt from operator via MCP
- Evaluate depth (mission vs simple task)
- Decompose mission into tasks if needed
- Construct LLM system prompt with available actions
- Call LLM via `ApiGuardMiddleware`
- Parse structured JSON decision
- Coordinate interpreter, reporter, and state file updates
- Detect termination
- Emit final executive summary/report when all tasks DONE

### 4.3 Interpreter (`src/utils/interpreter.ts`)

Responsibilities:
- Receive `{ thought, action, parameters }` from Agent Loop
- Route to `ToolDispatcher` if `action` present
- Log as reflection if `action: null`
- Capture observation

### 4.4 ToolDispatcher (`src/utils/tool_dispatcher.ts`)

Responsibilities:
- Map `action` enum values to tool implementations
- Validate parameters against tool schemas (Zod)
- Execute tools programmatically inside the server process
- Return raw observation

### 4.5 Reporter

Responsibilities:
- Write AI `thought` → `decisions` table
- Write tool `observation` → `observations` table + task state file
- Update task status in DB
- Create/update task state files in `reports/missions/tasks/{task_id}.json`
- Emit final executive summary/report when mission DONE

### 4.6 MCP Entry Tool (`src/tools/agent_loop_tool.ts`)

New MCP tool registration (e.g., `"start_mission"`) that receives the operator's initial prompt and kicks off the autonomous cycle.

### 4.7 System Prompt Template (`src/prompts/agent_system_prompt.ts`)

Instructs the LLM to:
- Emit only valid JSON (no markdown, no prose)
- Use exact `action` enum values
- Fill `parameters` according to tool schemas
- Emit `action: null` for reflections or when done

---

## 5. Structured Decision Format

### Tool call (minimalist)

```json
{
  "thought": "Why I'm doing this",
  "action": "MANAGE_BACKGROUND_SERVICE",
  "parameters": {
    "target": "marketing_bot",
    "action": "restart",
    "isSystemDaemon": true
  }
}
```

### Reflection / planning / big picture

```json
{
  "thought": "Service restarted and is stable. Next I need to verify the LinkedIn content calendar.",
  "action": null
}
```

### Done signal (per-task)

```json
{
  "thought": "TASK_COMPLETE: Marketing bot restarted and health-check passed.",
  "action": null
}
```

**No enriched metadata from the AI.** All derived data (which tool, which DB table, command string, execution branch) is computed by deterministic interpreter/tool/reporter layers.

---

## 6. State Management

### Task State File (`reports/missions/tasks/{task_id}.json`)

Contains the complete execution history for a single task:

```json
{
  "task_id": 105,
  "mission_id": "mission-server-health-01",
  "status": "RUNNING",
  "created_at": "2026-07-02T16:35:00Z",
  "steps": [
    {
      "step": 1,
      "decision": {
        "thought": "Marketing bot is down. Need to restart the daemon.",
        "action": "MANAGE_BACKGROUND_SERVICE",
        "parameters": { "target": "marketing_bot", "action": "restart", "isSystemDaemon": true }
      },
      "observation": {
        "status": "LIFECYCLE_ACTION_EXECUTED",
        "system_output": "* Starting marketing_bot ... [ok]",
        "warnings": "None",
        "execution_time_ms": 342
      },
      "timestamp": "2026-07-02T16:35:11Z"
    }
  ],
  "current_file_states": {
    "/home/elo/workspace/src/server.ts": { "size": 1024, "last_modified": "..." }
  }
}
```

The AI reads this file at the start of each reasoning step. It contains:
- All prior decisions and their observations
- Current file states (snapshot or live)
- Task status

No "Feedback Pump" is needed — the task state file *is* the feedback.

---

## 7. Implementation Sequence

1. **Database schema** — Add `missions`, `decisions`, `observations` tables
2. **Task state file protocol** — Define format + read/write helpers
3. **Interpreter** — Map action → tool, validate, execute
4. **ToolDispatcher** — Central registry of actions + tool functions
5. **Agent Loop** — LLM orchestration with structured output parsing
6. **Reporter** — DB persistence + task state file updates + final executive summary
7. **MCP entry tool** — `start_mission` registration in `src/index.ts`
8. **System prompt template** — Constrain LLM to emit valid JSON
9. **Termination logic** — Done signal per task, mission-level completion, final report emission

---

## 8. Open Design Decisions (To Resolve During Implementation)

| Decision | Options | Recommendation |
|----------|---------|----------------|
| LLM structured output | JSON mode (if provider supports) vs prompt engineering with strict format | Gemini JSON mode + fallback prompt constraints |
| ToolDispatcher design | Refactor tools to export plain functions vs wrap MCP handlers internally | Wrap internally first; refactor later if needed |
| File state snapshot | Poll before each step vs maintain live watcher | Poll at start of each reasoning step |
| Mission decomposition | AI decomposes ad-hoc vs deterministic splitter | AI decomposes using system prompt guidance |
| Max steps safety | Hard stop (e.g., 50) vs model-enforced limit | Hard stop as safety net, model instructed to minimize |

---

Saved to: .kilo/plans/agent_architecture_plan.md
