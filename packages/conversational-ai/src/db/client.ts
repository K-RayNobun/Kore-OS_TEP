import { Client } from 'pg';
import type { QueryResult } from 'pg';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface Row {
  [key: string]: unknown;
}

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_memories (
    id            INTEGER PRIMARY KEY,
    user_id       TEXT NOT NULL,
    entry         TEXT NOT NULL,
    confidence    REAL NOT NULL DEFAULT 0.80,
    source        TEXT NOT NULL DEFAULT 'background_review',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id       TEXT PRIMARY KEY,
    tone          TEXT NOT NULL DEFAULT 'professional',
    tone_score    TEXT NOT NULL DEFAULT '{"formal":0.50,"casual":0.50}',
    availability  TEXT NOT NULL DEFAULT '{}',
    attention     TEXT NOT NULL DEFAULT '{}',
    expertise     TEXT NOT NULL DEFAULT '[]',
    style_notes   TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
    id            INTEGER PRIMARY KEY,
    user_id       TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    content       TEXT NOT NULL,
    tool_calls    TEXT,
    tool_name     TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS skills (
    id            INTEGER PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    definition    TEXT NOT NULL DEFAULT '{}',
    state         TEXT NOT NULL DEFAULT 'active',
    use_count     INTEGER NOT NULL DEFAULT 0,
    pinned        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at   TEXT
);
CREATE TABLE IF NOT EXISTS expertise_graph (
    user_id       TEXT NOT NULL,
    subject       TEXT NOT NULL,
    proficiency   REAL NOT NULL DEFAULT 0.50,
    last_used     TEXT NOT NULL DEFAULT (datetime('now')),
    evidence_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, subject)
);
CREATE TABLE IF NOT EXISTS journals (
    id            INTEGER PRIMARY KEY,
    user_id       TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    period_start  TEXT NOT NULL,
    period_end    TEXT NOT NULL,
    summary       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS schema_version (
    version       INTEGER PRIMARY KEY,
    applied_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export class DatabaseClient {
  private client: Client | null = null;
  private sqlite: Database.Database | null = null;
  private connected = false;

  constructor(private connectionString?: string, private sqlitePath = ':memory:') {}

  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.connectionString && this.connectionString.includes('@')) {
      this.client = new Client({ connectionString: this.connectionString });
      await this.client.connect();
      this.connected = true;
      await this.ensureSchemaVersionTable();
      await this.runMigrations();
      return;
    }

    this.sqlite = new Database(this.sqlitePath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.connected = true;
    await this.ensureSqliteSchema();
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    if (this.client) await this.client.end();
    if (this.sqlite) this.sqlite.close();
    this.connected = false;
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    if (!this.connected) throw new Error('DatabaseClient: not connected');

    if (this.sqlite) {
      return this.querySqlite(text, params);
    }
    if (!this.client) throw new Error('No database client available');
    return this.client.query(text, params as string[]);
  }

  private async ensureSchemaVersionTable(): Promise<void> {
    if (this.client) {
      await this.client.query(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.client) return;
    const result = await this.client.query('SELECT MAX(version) as v FROM schema_version');
    const current = result.rows[0]?.v ?? 0;
    if (current < 1) {
      const sqlPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
      const sql = fs.readFileSync(sqlPath, 'utf-8');
      await this.client.query(sql);
      await this.client.query('INSERT INTO schema_version (version) VALUES ($1)', [1]);
    }
  }

  private async ensureSqliteSchema(): Promise<void> {
    if (!this.sqlite) return;
    const stmts = SQLITE_SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      try {
        this.sqlite.exec(stmt);
      } catch (e) {
        console.log('[sqlite] schema warn:', (e as Error).message);
      }
    }
    const tables = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: Row) => r.name);
    console.log('[sqlite] tables loaded:', tables.join(', '));
  }

  private querySqlite(text: string, params: unknown[]): QueryResult {
    if (!this.sqlite) throw new Error('SQLite not initialized');
    const trimmed = text.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || text.includes('RETURNING');
    const normalized = text.replace(/\$\d+/g, '?');
    const stmt = this.sqlite.prepare(normalized);
    try {
      if (isSelect) {
        const rows = stmt.all(...params) as Row[];
        return { rows, command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] } as QueryResult;
      }
      const info = stmt.run(...params);
      return { rows: [], command: trimmed.split(' ')[0], rowCount: info.changes, oid: 0, fields: [] } as QueryResult;
    } catch (err) {
      console.error('[sqlite] query failed:', normalized, err);
      throw err;
    }
  }
}
