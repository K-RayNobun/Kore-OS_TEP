# Hermes Agent Architecture Overview

## Overview
Hermes is a personal AI agent framework that runs across multiple interfaces:
- **CLI** (classic prompt_toolkit TUI)
- **TUI** (Ink/React terminal UI - `hermes --tui`)
- **Messaging Gateway** (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, ~20+ platforms)
- **ACP Adapter** (VS Code, Zed, JetBrains integration via Agent Communication Protocol)
- **MCP Server** (exposes Hermes as MCP tools for other agents)
- **Electron Desktop App** (standalone chat surface)

## Core Architecture

### Entry Points
1. **`cli.py`** (~11k LOC) - Interactive CLI orchestrator with Rich/prompt_toolkit
2. **`run_agent.py`** (~6k LOC) - `AIAgent` class - core conversation loop
3. **`acp_adapter/entry.py`** - ACP stdio server entry point
4. **`mcp_serve.py`** - MCP stdio server
5. **`gateway/run.py`** - Messaging gateway
6. **`tui_gateway/server.py`** - JSON-RPC backend for Ink TUI

### Key Components

#### AIAgent (run_agent.py)
- **Synchronous conversation loop** with tool calling
- Manages message history, tool schemas, iteration budget
- Supports: chat_completions, codex_responses, anthropic, bedrock, gemini transports
- Handles: context compression, memory providers, delegation, checkpoints
- ~60 constructor parameters (credentials, routing, callbacks, session context, budget)

#### Tool System (`tools/`, `model_tools.py`, `toolsets.py`)
- **Auto-discovery**: `tools/registry.py` + `registry.register()` at import time
- **Toolsets**: Defined in `toolsets.py` (e.g., `browser`, `terminal`, `search`, `memory`, `delegation`, `skills`, `cronjob`, `kanban`, `web`, `vision`, `image_gen`, `video`, `tts`, `code_execution`, `debugging`, `moa`, `rl`, `discord`, `feishu_doc`, `yuanbao`, `spotify`, `homeassistant`)
- **Core tools**: `_HERMES_CORE_TOOLS` list in `toolsets.py` - default bundle
- **Handler signature**: `handler(args, task_id) -> JSON string`

#### Browser Automation (`tools/browser_tool.py` + `plugins/browser/`)
- **Multiple backends**: local (agent-browser/Playwright), Browserbase, Browser Use, Firecrawl, Camofox
- **Auto-detection** from config + credentials
- **Session isolation** per task_id
- **Tools**: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_close`, `browser_console`, `browser_vision`, `browser_record`, `browser_pdf`, `browser_download`, `browser_upload`
- **Security**: SSRF protection, credential stripping for subprocesses

#### ACP Adapter (`acp_adapter/`)
- Implements `acp.Agent` interface
- Session management with provenance tracking
- History replay for editors (Zed, VS Code)
- MCP server registration per session
- Usage updates for context indicators

#### Skills System (`skills/`, `optional-skills/`, `tools/skills_hub.py`)
- **Built-in skills** (`skills/`) - shipped and loadable by default
- **Optional skills** (`optional-skills/`) - heavier/niche, installed via `hermes skills install official/<cat>/<skill>`
- **Skill format**: `SKILL.md` with frontmatter + markdown body + `scripts/`/`references/`/`templates/`
- **Slash commands**: Skills inject slash commands as user messages (preserves prompt caching)

#### Plugin System (`plugins/`, `hermes_cli/plugins.py`)
- **General plugins**: `~/.hermes/plugins/`, `./.hermes/plugins/`, pip entry points
- **Memory providers**: `plugins/memory/<name>/` implementing `MemoryProvider` ABC
- **Model providers**: `plugins/model-providers/<name>/` registering `ProviderProfile`
- **Context engines**: `plugins/context_engine/<name>/`
- **Image gen**: `plugins/image_gen/<name>/`
- **Rule**: Plugins MUST NOT modify core files

#### Configuration
- **`config.yaml`** (behavioral settings): `model`, `agent`, `terminal`, `compression`, `display`, `memory`, `security`, `delegation`, `skills`, `gateway`, `logging`, `cron`, `profiles`, `plugins`, `browser`, `curator`, `auxiliary`
- **`.env`** (secrets only): API keys, tokens, passwords
- **Profiles**: Multiple isolated `HERMES_HOME` directories via `hermes -p <profile>`

#### Session/State (`hermes_state.py`)
- **SessionDB** - SQLite with FTS5 search
- Stores: messages, tool calls, trajectories, checkpoints, memory
- Profile-aware via `get_hermes_home()` / `display_hermes_home()`

#### Delegation (`tools/delegate_tool.py`)
- Spawns subagents with isolated context + terminal session
- Roles: `leaf` (default, no delegate_task) vs `orchestrator` (can spawn children)
- Background mode returns delegation ID immediately
- Config: `max_concurrent_children`, `max_spawn_depth`, `child_timeout_seconds`

#### Cron (`cron/`)
- Job store + scheduler tick loop
- Schedule formats: duration, "every" phrases, cron expressions, ISO timestamps
- Job fields: skills, model/provider overrides, script (pre-run data collection), context_from (chaining), workdir
- Hard 3-min interrupt, catchup window, file lock

#### Kanban (`plugins/kanban/`, `tools/kanban_tools.py`)
- SQLite-backed multi-agent work queue
- Dispatcher reclaims stale claims, promotes ready tasks, spawns assigned profiles
- Worker toolset: `kanban_show`, `kanban_complete`, `kanban_block`, `kanban_heartbeat`, etc.
- Board/tenant isolation via `HERMES_KANBAN_BOARD` env

#### Curator (`agent/curator.py`)
- Background skill lifecycle management
- Tracks agent-created skills usage, auto-archives stale ones
- Never deletes, only archives to `~/.hermes/skills/.archive/`

## Data Flow

```
User Input (CLI/Gateway/ACP/Deskptop)
         │
         ▼
    AIAgent.run_conversation()
         │
         ▼
  Build system prompt + tools (from toolsets)
         │
         ▼
  LLM API call (provider transport)
         │
         ▼
  Tool calls? ──Yes──▶ handle_function_call() ──▶ Tool handler ──▶ Result ──▶ Loop
         │
         No
         ▼
  Return final response
```

## Key Design Principles (from AGENTS.md)

1. **Per-conversation prompt caching is sacred** - Never mutate past context, swap toolsets, or rebuild system prompt mid-conversation (except context compression)
2. **Core is narrow waist; capability at edges** - New model tools = expensive (sent every API call). Prefer: extend existing → CLI command + skill → service-gated tool → plugin → MCP server → new core tool (last resort)
3. **Extend, don't duplicate** - Check existing infrastructure before adding modules/managers/hooks
4. **Behavior contracts over snapshots** - Tests assert invariants, not frozen values
5. **E2E validation** - Exercise real paths with real imports against temp `HERMES_HOME`
6. **Cache/alternation/invariant safe** - Preserve prompt caching, strict message role alternation, byte-stable system prompt

## Integration Points for KORE-OS-TEP

### What Hermes Provides
- **Browser automation** (local + cloud backends, session isolation, security)
- **ACP server** for IDE integration
- **MCP server** exposing Hermes tools to other agents
- **Skills system** for extensible capabilities
- **Plugin architecture** for memory/providers/context engines
- **Session management** with SQLite + FTS5
- **Delegation** for subagent orchestration
- **Cron/Kanban** for scheduled/queued work

### What KORE-OS-TEP Has
- **TypeScript MCP server** (`src/index.ts`) with tools: `telemetry`, `search`, `sandbox`, `patch`, `service_manager`, `network_audit`, `backup`, `binary_inspector`, `asset_optimizer`, `playbook_compiler`, `browser_automator`, `metrics_ledger`, `agent_loop`
- **AgentLoop** (`src/utils/agent_loop.ts`) - mission-based task execution with LLM calls
- **ToolDispatcher** (`src/utils/tool_dispatcher.ts`) - Zod-validated tool execution
- **IPC system** (`src/utils/ipc_pipe.ts`, `src/utils/ipc_frame_schema.ts`)
- **Database** (`src/utils/database_helper.ts`) - SQLite for missions/tasks
- **BrowserAutomator** (Playwright-based, simpler than Hermes)

### Integration Strategy Options

| Approach | Pros | Cons |
|----------|------|------|
| **Replace KORE browser_automator with Hermes browser tools** | Full Hermes browser capabilities | Need to bridge TS ↔ Python |
| **Run Hermes as MCP server, call from KORE** | Clean separation, uses MCP protocol | Extra process, latency |
| **Run Hermes ACP server, integrate via ACP** | IDE integration ready | More complex |
| **Embed Hermes AIAgent in KORE via Python subprocess** | Direct access to Hermes core | Process management complexity |
| **Port Hermes browser tools to TypeScript** | Native TS, no bridge | Massive effort, lose Hermes ecosystem |

### Recommended: Hermes as MCP Server
- KORE already uses MCP (`@modelcontextprotocol/sdk`)
- Hermes `mcp_serve.py` exposes conversations as MCP tools
- Can also expose browser tools via `hermes-tools` MCP server (`agent.transports.hermes_tools_mcp_server`)
- KORE's `ToolDispatcher` can call Hermes MCP tools
- Keeps both systems independent but interoperable