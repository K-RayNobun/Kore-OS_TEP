-- Conversational AI Layer — PostgreSQL Schema
-- Run via: npm run migrate

-- Agent memory: what the agent learns about the world / its own behavior
CREATE TABLE IF NOT EXISTS agent_memories (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    entry         TEXT NOT NULL,
    confidence    NUMERIC(3,2) NOT NULL DEFAULT 0.80,
    source        TEXT NOT NULL DEFAULT 'background_review',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User profile: preferences, tone, availability, expertise
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id       TEXT PRIMARY KEY,
    tone          TEXT NOT NULL DEFAULT 'professional',
    tone_score    JSONB NOT NULL DEFAULT '{"formal":0.50,"casual":0.50}',
    availability  JSONB NOT NULL DEFAULT '{}',
    attention     JSONB NOT NULL DEFAULT '{}',
    expertise     JSONB NOT NULL DEFAULT '[]',
    style_notes   TEXT NOT NULL DEFAULT '',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Conversation history (full transcript)
CREATE TABLE IF NOT EXISTS conversations (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
    content       TEXT NOT NULL,
    tool_calls    JSONB,
    tool_name     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_conversations_content_fts
    ON conversations USING GIN (to_tsvector('english', content));

-- Skills / procedures
CREATE TABLE IF NOT EXISTS skills (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    definition    JSONB NOT NULL,
    state         TEXT NOT NULL DEFAULT 'active',
    use_count     INTEGER NOT NULL DEFAULT 0,
    pinned        BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at   TIMESTAMPTZ
);

-- Expertise graph (optional, Phase 4)
CREATE TABLE IF NOT EXISTS expertise_graph (
    user_id       TEXT NOT NULL,
    subject       TEXT NOT NULL,
    proficiency   NUMERIC(3,2) NOT NULL DEFAULT 0.50,
    last_used     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, subject)
);

-- Journals (compressed sessions)
CREATE TABLE IF NOT EXISTS journals (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    period_start  TIMESTAMPTZ NOT NULL,
    period_end    TIMESTAMPTZ NOT NULL,
    summary       TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Migration ledger
CREATE TABLE IF NOT EXISTS schema_version (
    version       INTEGER PRIMARY KEY,
    applied_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
