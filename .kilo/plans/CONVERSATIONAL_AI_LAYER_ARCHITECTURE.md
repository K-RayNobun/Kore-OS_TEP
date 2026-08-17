# Conversational AI Layer — Architecture & Roadmap

> **Scope:** A Level 2 personalized conversational layer for Kore OS.  
> **Status:** Proposed architecture. Implementation follows the ordered task list in the master plan.  
> **Audience:** Engineering review.

---

## 1. Executive Summary

Kore OS already has an autonomous agent loop (`AgentLoop`), a strict output contract, a tool registry, and a SQLite-backed audit trail. What it lacks is a **conversational interface that remembers who is talking to it, adapts its tone, and learns preferences over time**.

This document proposes a **Conversational AI Layer** that sits on top of the existing engine — not beside it, not replacing it. It reuses Kore OS's gateway, IPC pipe, and security posture, while adding:

- **Dual-store memory** (agent notes + user profile) persisted in PostgreSQL
- **Background self-review** that writes memory/skill updates without blocking the turn
- **Long-term recall** via full-text search across conversation history
- **Level 2 personalization** (tone, availability hours, subject expertise, workflow habits)
- **Multi-user isolation** enforced at the database row level

The reference patterns come from Hermes Agent, but the implementation is native to Kore OS's TypeScript stack and its existing runtime topology.

---

## 2. Where It Lives in Kore OS

### 2.1 Not a separate Python service

The original plan proposed Python "best for AI/ML ecosystem." That is true for prototyping, but Kore OS already ships:

- A Fastify gateway (`src/server.ts`)
- An MCP stdio engine (`src/index.ts`)
- A tool dispatcher with Zod schemas (`src/utils/tool_dispatcher.ts`)
- Container hardening, key-pool rotation, and budget governance

Adding a Python sidecar introduces a second runtime, a second container, a second attack surface, and a second database client. For a text-based chat layer, **TypeScript is sufficient** and preserves a single deployable unit.

### 2.2 Integration points

```
┌──────────────────────────────────────────────────────────────┐
│                   KORE OS CONTROL CENTER (PWA)                 │
│   New tab: "Conversations" — chat UI + profile settings        │
└───────────────────────────▲──────────────────────────────────┘
                            │  REST + WS (X-Kore-Core-Token)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│           SERVER.TS — Fastify Edge Gateway Daemon             │
│   + new REST routes: /conversations, /memory, /profile        │
│   + new WS room: /stream/chat                                 │
└───────────────────────────▲──────────────────────────────────┘
                            │  Line-delimited JSON over Unix socket
                            ▼
┌──────────────────────────────────────────────────────────────┐
│              INDEX.TS — Core Agentic Engine (MCP)             │
│   + new tools: chat_send, memory_add, memory_search,          │
│     profile_update, skill_install                              │
│   + ConversationLoop (new class) wrapping AgentLoop           │
└──────────────────────────────────────────────────────────────┘
```

**Decision:** The conversational layer is a new `ConversationLoop` class in `src/utils/conversation_loop.ts` and a new set of MCP tools in `src/tools/conversational/`. It runs in the same Node process as the engine. The PWA gets a new tab.

---

## 3. Memory Architecture

### 3.1 The dual-store pattern (adapted from Hermes)

Hermes uses two bounded file-backed stores: `MEMORY.md` (agent notes) and `USER.md` (user facts). For Kore OS, we map this to PostgreSQL tables so memory is queryable, transactional, and multi-user safe.

#### Tables

```sql
-- Agent memory: what the agent has learned about the world / its own behavior
CREATE TABLE agent_memories (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    entry         TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User profile: preferences, tone, availability, expertise
CREATE TABLE user_profiles (
    user_id       TEXT PRIMARY KEY,
    tone          TEXT NOT NULL DEFAULT 'professional',
    availability  JSONB NOT NULL DEFAULT '{}',
    expertise     JSONB NOT NULL DEFAULT '[]',
    style_notes   TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversation history (full transcript)
CREATE TABLE conversations (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
    content       TEXT NOT NULL,
    tool_calls    JSONB,
    tool_name     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Full-text search index (PostgreSQL built-in)
CREATE INDEX idx_conversations_content_fts
    ON conversations USING GIN (to_tsvector('english', content));
```

**Why PostgreSQL over SQLite here:**  
The existing Kore OS SQLite is optimized for mission audit trails (append-only, WAL, single-writer). A conversational layer needs:
- Concurrent reads/writes from multiple users
- JSONB for flexible profile schemas (`availability`, `expertise`)
- Native full-text search without FTS5 extension concerns
- Row-level isolation that scales beyond a single host

PostgreSQL runs as a companion container (`kore-os-postgres`) in `docker-compose.yml`. The engine connects via `pg` native client.

### 3.2 Frozen snapshot injection

At the start of every conversation session, the engine:

1. Reads the user's profile row and recent agent memories (last N entries).
2. Serializes them into a `USER_CONTEXT` block.
3. Injects the block into the system prompt **once**.
4. Never mutates the active system prompt mid-session.

This preserves prompt-caching behavior analogous to Hermes's frozen snapshot. Mid-session memory writes (from `memory_add`) update PostgreSQL immediately but do **not** touch the in-context system prompt. The new context lands on the next session start.

### 3.3 Character / token budgets

| Store | Budget | Rationale |
|-------|--------|-----------|
| `user_profiles.style_notes` | 500 tokens (~1375 chars) | Force prioritization |
| `agent_memories` per user | 100 entries / 30-day rolling window | Prevent unbounded growth |
| `conversations` | Full retention (archived after 90 days to cold storage) | Recall fidelity |

### 3.4 Drift detection & threat scanning

- **Drift:** If a profile row is updated externally (e.g., direct SQL edit), the `profile_update` tool detects the checksum mismatch and snapshots the row to `.bak` before refusing further automated writes until a human resolves it.
- **Threats:** All memory entries and user inputs are scanned for prompt-injection patterns before storage. The engine already has `sanitizeIngestedText` in `security_guard.ts`; we extend it with a conversational threat dictionary.

---

## 4. The Learning Loop

### 4.1 Background self-review (adapted from Hermes)

Hermes spawns a forked agent after every turn to ask: "Should any skill/memory be saved or updated?"

In Kore OS, we implement this as a **daemon thread** inside the engine process:

```
After every chat turn:
  1. Main thread returns the assistant message to the user.
  2. spawnBackgroundReview(sessionId, userMessage, assistantMessage)
  3. Review agent (lightweight, tool-whitelisted):
       - Did the user reveal a preference? → profile_update
       - Did the user mention a recurring topic? → agent_memories.insert
       - Did the conversation produce a reusable procedure? → skill_create
  4. Review writes go straight to PostgreSQL.
  5. Main conversation loop is never touched.
```

**Tool whitelist for review:** `memory_add`, `profile_update`, `skill_create`, `session_search`. No sandbox, no network, no file mutation outside the memory schema.

### 4.2 Skill lifecycle (Curator pattern)

Hermes tracks usage on agent-created skills and auto-archives stale ones. Kore OS adopts the same pattern:

```sql
CREATE TABLE skills (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    definition    JSONB NOT NULL,
    state         TEXT NOT NULL DEFAULT 'active',
    use_count     INTEGER NOT NULL DEFAULT 0,
    pinned        BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at   TIMESTAMPTZ
);
```

- **Pinned skills** are exempt from archival.
- **Archived skills** are soft-deleted (`state = 'archived'`), restorable via `skill_restore`.
- **Usage tracking** increments on every `skill_execute` tool call.
- **Curator daemon** runs every 6 hours: if `state = 'active'` AND `use_count = 0` AND `age > 30 days` → archive.

---

## 5. Long-Term Recall

### 5.1 Cross-session search

Hermes exposes a `session_search` tool with DISCOVERY / SCROLL / BROWSE modes backed by SQLite FTS5.

Kore OS exposes a `conversation_search` tool backed by PostgreSQL `to_tsvector`:

| Mode | Query | Returns |
|------|-------|---------|
| DISCOVERY | `query` | Top-N sessions with ±3 message windows |
| SCROLL | `session_id` + `around_message_id` | Window of messages centered on anchor |
| BROWSE | none | Recent sessions chronologically |

Results are **pure SQL** — no LLM call. The model invokes the tool, receives snippets, and decides what to surface to the user.

### 5.2 Prefetch (optional, Phase 3)

For a more proactive experience, the engine can prefetch relevant memories before each turn:

```
Before API call:
  memoryManager.prefetch(userMessage)
  → SELECT ... FROM agent_memories WHERE user_id = $1 AND entry ILIKE $2
  → Injected as <memory-context> block in system prompt
```

This is best-effort. A slow query must never block the turn.

---

## 6. Personalization Depth Levels

| Level | What the agent knows | Implementation |
|-------|---------------------|----------------|
| **L0** | Static config (model, API key) | `config.yaml` per profile |
| **L1** | Session-scoped instructions (system prompt) | `system_prompt` field in `conversations` |
| **L2** | Learned preferences, tone, availability, expertise | `user_profiles` + `agent_memories` |
| **L3** | Predictive adaptation (anticipate needs, suggest actions) | Background inference model (Phase 3) |

**Target:** L2 out of the gate. L3 requires a separate recommendation pass and is deferred.

---

## 7. Multi-User Isolation

### 7.1 Row-level enforcement

Every memory and conversation query filters on `user_id`. The user_id is derived from the Kore OS auth token (`X-Kore-Core-Token`) mapped to an operator identity.

### 7.2 Validation criteria (from the master plan)

- **Isolation:** 5 concurrent users, zero data leakage
- **Personalization:** Two users, same prompt, measure response divergence >40%
- **Stress:** 50 rapid profile switches, no corruption

### 7.3 Profile switching

The PWA supports multiple profiles. Switching clears the in-memory conversation buffer and reloads the frozen snapshot for the new profile. PostgreSQL row ownership guarantees no leakage.

---

## 8. Context & Token Economy

Kore OS already implements TMCP (Tri-Masterclass Context Protocol) for missions. The conversational layer reuses the same primitives:

| TMCP Primitive | Conversational Adaptation |
|----------------|---------------------------|
| Structural skeleton (M1) | Compact AST of the user's skill library |
| Sliding breadcrumb buffer (M3) | Last N intent entries from conversation history |
| Just-in-time paging | `conversation_search` tool invoked by model |
| Implication deduplication | Cache `(userMessage, toolResult)` hashes to avoid redundant memory writes |

**Token gate:** The same ~1 000-token gate used by `AgentLoop` is applied to the conversational system prompt. If the user profile + recent memories exceed the budget, older entries are summarized by an LLM call before injection.

---

## 9. Skills & Procedures

### 9.1 What is a skill?

In the conversational layer, a **skill** is a named, parameterized procedure the agent can execute on request. Examples:

- `generate_weekly_report` — pulls metrics, formats markdown, emails it
- `audit_servers` — runs `GET_SYSTEM_TELEMETRY` + `AUDIT_NETWORK_SOCKETS` + writes a report
- `summarize_inbox` — reads recent emails, produces a triage list

Skills are defined as JSON:

```json
{
  "name": "generate_weekly_report",
  "description": "Compile a weekly operational report from telemetry and mission data",
  "parameters": {
    "week_start": { "type": "string", "format": "date" }
  },
  "tool_chain": ["GET_SYSTEM_TELEMETRY", "GET_MISSIONS", "WRITE_TECHNICAL_REPORT"],
  "system_prompt_suffix": "When the user asks for a weekly report, call generate_weekly_report."
}
```

### 9.2 Lifecycle

| Command | Action |
|---------|--------|
| `skill_list` | Enumerate user's active + archived skills |
| `skill_create` | Save a new skill definition |
| `skill_update` | Edit an existing skill |
| `skill_delete` | Soft-delete (archive) |
| `skill_execute` | Run the tool chain with user-provided parameters |
| `skill_pin` | Exempt from auto-archival |

---

## 10. Realistic Implementation Roadmap

| Phase | Focus | Key Deliverable |
|-------|-------|-----------------|
| **1** | Profile + Memory foundations | `user_profiles` table, `agent_memories` table, `memory_add` / `profile_update` tools, frozen snapshot injection |
| **1** | Conversation history | `conversations` table, `conversation_search` tool (DISCOVERY / SCROLL / BROWSE) |
| **2** | Background review | Daemon thread after each turn, memory/skill auto-writes, drift detection |
| **2** | Skills system | `skills` table, `skill_create` / `skill_execute` tools, curator daemon |
| **3** | Context compression | Token-budgeted summarization of middle turns, head/tail protection |
| **3** | Prefetch | Async memory recall before each turn |
| **4** | L3 personalization | Inference pass on conversation history, predictive suggestions |

**Validation gates:**
- After Phase 1: Two profiles, same prompt, verify response divergence >40%
- After Phase 2: Install a skill in Profile A, verify Profile B cannot see it
- After Phase 3: 10 rapid profile switches, measure <500 ms overhead per switch
- After Phase 4: A/B test predictive suggestions against random suggestions

---

## 11. Ideal Version — Additional Arguments

Once the core layer (Phases 1–3) is stable, the following arguments become the differentiators of a truly adaptive conversational agent:

### 11.1 Preference Confidence Scoring

Not all memories are equally reliable. Track a confidence score per memory entry:

```sql
ALTER TABLE agent_memories ADD COLUMN confidence NUMERIC(3,2) DEFAULT 0.80;
```

- Direct user statement: confidence = 0.95
- Inferred from behavior: confidence = 0.70
- Background review guess: confidence = 0.50
- Stale (>30 days without reinforcement): confidence decays by 0.05 per week

The system prompt surfaces only memories above a configurable threshold (default 0.70). This prevents low-quality inferences from polluting the context.

### 11.2 Availability & Attention Windows

Extend `user_profiles` with structured attention data:

```json
{
  "availability": {
    "timezone": "Europe/Paris",
    "windows": [
      { "days": ["Mon","Tue","Wed","Thu","Fri"], "start": "09:00", "end": "18:00" }
    ],
    "do_not_disturb": [
      { "days": ["Sat","Sun"], "start": "00:00", "end": "23:59" }
    ]
  },
  "attention": {
    "max_concurrent_threads": 3,
    "preferred_response_length": "medium",
    "urgent_keywords": ["outage", "down", "critical"]
  }
}
```

The engine respects these windows:
- Outside availability: responses are deferred or batched
- Urgent keywords bypass DND
- Attention limits cap the number of concurrent conversation threads

### 11.3 Subject Expertise Graph

Instead of a flat JSON array, model expertise as a directed graph:

```sql
CREATE TABLE expertise_graph (
    user_id       TEXT NOT NULL,
    subject       TEXT NOT NULL,
    proficiency   NUMERIC(3,2) NOT NULL DEFAULT 0.50,
    last_used     TIMESTAMPTZ NOT NULL DEFAULT now(),
    evidence_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, subject)
);
```

- Proficiency increases when the user demonstrates knowledge (asks advanced questions, corrects the agent).
- Proficiency decays when the user asks beginner questions or avoids the topic.
- The system prompt injects expertise hints: "The user is proficient in Kubernetes — avoid over-explaining basic concepts."

### 11.4 Tone Calibration Loop

Tone is not static. Use a lightweight feedback signal:

1. After each response, the user can react with a 1-click signal: `too_formal`, `too_casual`, `just_right`.
2. The signal updates a `tone_score` vector in `user_profiles`.
3. The next system prompt adjusts formality, emoji usage, sentence length, and jargon density.

This turns tone from a setting into a **trained parameter**.

### 11.5 Multi-Agent Orchestration

The current design assumes one conversational agent per user. The ideal version supports **specialist sub-agents**:

- A **research sub-agent** for deep web searches and synthesis
- A **coding sub-agent** that inherits the user's coding style preferences
- A **writing sub-agent** calibrated to the user's editorial voice

Sub-agents are spawned via `delegate_tool` (already present in the Hermes codebase, adaptable to Kore OS). The parent agent routes tasks based on the user's expertise graph and conversation intent.

### 11.6 Cross-Session Continuity with Compression

Long-running users accumulate months of history. The ideal layer:

1. Compresses sessions older than 30 days into **journals** (LLM-generated summaries per week/month).
2. Journals are stored in `agent_memories` with a `type = 'journal'` tag.
3. The model can invoke `journal_search` to retrieve high-level continuity without ingesting raw transcripts.
4. Raw transcripts are archived to cold storage (S3 / local NAS) after 90 days.

This gives the agent **lifelong memory** without infinite context cost.

### 11.7 Privacy & Sovereignty Controls

Kore OS's identity is "Sovereign Admin Engine." The conversational layer must honor that:

- **Memory export:** User can download all their memories, profiles, and conversations as JSON/Markdown.
- **Memory redaction:** User can mark specific memories as `do_not_use`; the background review respects the flag.
- **Local-only mode:** All memory stays in the user's PostgreSQL instance. No telemetry, no cloud sync, no model provider logging.
- **Forgetting:** User can invoke `memory_forget --all` to wipe the profile and start fresh.

---

## 12. Summary of Arguments

| Argument | Why it matters | Implementation |
|----------|---------------|----------------|
| Dual-store memory | Separates agent facts from user facts; prevents bleed | `agent_memories` + `user_profiles` tables |
| Frozen snapshot injection | Preserves prompt caching; mid-session writes don't invalidate | Read-once at session start |
| Background review | Learning without blocking the user | Daemon thread with tool whitelist |
| Long-term recall | Cross-session awareness | PostgreSQL FTS + `conversation_search` tool |
| Confidence scoring | Filters low-quality inferences | `confidence` column with decay |
| Availability windows | Respects user's attention | Structured JSONB in `user_profiles` |
| Expertise graph | Adaptive depth of explanation | `expertise_graph` table with proficiency decay |
| Tone calibration | Personalization that improves with use | 1-click feedback → `tone_score` vector |
| Sub-agent delegation | Specialists for complex domains | Extend `ToolDispatcher` with delegate routes |
| Journals + cold archive | Lifelong memory without context bloat | Periodic LLM summarization + S3 offload |
| Privacy controls | Aligns with Kore OS sovereignty ethos | Export, redact, forget, local-only mode |

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Memory bloat** | Hard caps on `agent_memories` rows; rolling 30-day window; journal compression |
| **Prompt injection via memory** | Threat scanning on all writes; sanitization on read; no raw memory injection without parsing |
| **Cross-user leakage** | Row-level `user_id` filter on every query; integration tests with 5 concurrent users |
| **Review thread runaway** | Timeout cap (5 s); tool whitelist; no LLM calls inside review agent |
| **Tone calibration overfitting** | Minimum evidence count before updating `tone_score`; human override always available |
| **PostgreSQL operational burden** | Ship as Docker Compose service; automated backups; fallback to SQLite for single-user dev |

---

*This document is the architectural north star. The ordered task list in `.kilo/plans/1783808656630-personalized-conversational-ai-postgres-plan.md` is the execution contract.*
