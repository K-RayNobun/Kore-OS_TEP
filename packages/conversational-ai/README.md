# Conversational AI Layer

Detachable, standalone conversational AI module for Kore OS. Implements Level 2 personalization (tone, availability, expertise, memory) with PostgreSQL persistence, background self-review, and long-term recall.

## Features

- **Dual-store memory** — `agent_memories` + `user_profiles` in PostgreSQL
- **Frozen snapshot injection** — system prompt built once per session, mid-session writes don't invalidate it
- **Background self-review** — daemon thread after each turn writes memory/skill updates without blocking
- **Long-term recall** — PostgreSQL FTS-backed `conversation_search` (DISCOVERY / SCROLL / BROWSE)
- **Skills system** — JSON-defined procedures with lifecycle commands and Curator auto-archival
- **Multi-user isolation** — row-level `user_id` enforcement
- **Mock LLM included** — deterministic simulation without API keys
- **Z AI GLM-4-Flash ready** — generous free tier, switch with one env var

## Quick Start

```bash
cd packages/conversational-ai

# 1. Start PostgreSQL
docker compose --profile conversational-ai up -d

# 2. Install dependencies
npm install

# 3. Run schema migration
npm run migrate

# 4. Run the 120-message simulation (mock LLM, no API key needed)
npm run simulate

# 5. Or run with real Z AI GLM-4-Flash
export ZAI_API_KEY=your_key
npm run dev
```

## Architecture

```
packages/conversational-ai/
├── src/
│   ├── db/
│   │   ├── schema.sql          # PostgreSQL tables + FTS index
│   │   ├── client.ts           # Connection pool + migration runner
│   │   └── migrate.ts          # CLI migration entrypoint
│   ├── memory/
│   │   ├── MemoryStore.ts      # agent_memories + user_profiles CRUD
│   │   ├── ConversationStore.ts # conversations + FTS search
│   │   └── DriftDetector.ts    # Checksum validation (placeholder)
│   ├── skills/
│   │   ├── SkillStore.ts       # skills table CRUD + usage tracking
│   │   └── Curator.ts          # Auto-archive daemon for stale skills
│   ├── agent/
│   │   ├── SystemPrompt.ts     # Frozen snapshot builder
│   │   ├── ConversationLoop.ts # Main chat loop with tool dispatch
│   │   └── BackgroundReview.ts # Post-turn daemon for memory/skill writes
│   ├── tools/
│   │   └── index.ts            # memory_add, profile_update, conversation_search, skill_create, skill_execute
│   ├── llm/
│   │   ├── client.ts           # Real Z AI GLM-4-Flash client
│   │   └── mock_client.ts      # Deterministic mock for simulation
│   ├── simulation/
│   │   └── runner.ts           # 120-message simulation with repetitive patterns
│   └── index.ts                # Entrypoint, wires everything together
├── docker-compose.yml          # PostgreSQL companion
├── package.json
├── tsconfig.json
└── .env.example
```

## How It Works

1. **Session start**: `SystemPromptBuilder` reads the user profile + recent memories + active skills, serializes them into a frozen `USER_CONTEXT` block, and injects it into the system prompt exactly once.
2. **Turn processing**: `ConversationLoop.processUserMessage()` appends the user message to PostgreSQL, calls the LLM with the frozen prompt + conversation history, intercepts `[TOOL_CALL]` markers, dispatches tools, and returns the final response.
3. **Background review**: After each turn, `BackgroundReview.review()` runs in a fire-and-forget pattern. It calls the LLM to analyze the exchange and decide if any memory, profile, or skill should be updated. Writes go straight to PostgreSQL.
4. **Recall**: The model can invoke `conversation_search` to retrieve past messages via PostgreSQL FTS without an extra LLM call.

## Simulation

The bundled simulation runs 120 messages covering:

- Greetings and status checks
- Weekly report generation (triggers `skill_execute`)
- Preference declarations (triggers `memory_add`)
- Tone adjustments (triggers `profile_update`)
- Cross-session search (triggers `conversation_search`)
- Skill creation (triggers `skill_create`)
- Help and meta-questions

Every 10 turns it prints a checkpoint with memory count, profile tone, and installed skills.

## Detachable Design

This module has **zero imports from Kore OS source**. It can be:

- Copied into any TypeScript project
- Published as `@kore-os/conversational-ai`
- Deleted without affecting the parent repo
- Replaced with an alternative implementation behind the same `ConversationLoop` interface

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `PGHOST` | PostgreSQL host | `localhost` |
| `PGPORT` | PostgreSQL port | `5432` |
| `PGDATABASE` | Database name | `kore_conversational` |
| `PGUSER` | Database user | `kore` |
| `PGPASSWORD` | Database password | `kore_local_dev` |
| `ZAI_API_KEY` | Z AI API key (omit for mock) | — |
| `ZAI_BASE_URL` | Z AI base URL | `https://api.z.ai/api/paas/v4` |
| `ZAI_MODEL` | Model name | `glm-4-flash` |
| `CONVERSATIONAL_AI_USER_ID` | Current user id | `default-user` |
| `CONVERSATIONAL_AI_SESSION_ID` | Current session id | generated |

## License

MIT
