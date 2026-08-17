import Database from 'better-sqlite3';
import type { QueryResult } from 'pg';

export interface Row {
  [key: string]: unknown;
}

export class SQLiteClient {
  private db: Database.Database;

  constructor(private path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async connect(): Promise<void> {
    // no-op for sqlite
  }

  async disconnect(): Promise<void> {
    this.db.close();
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResult> {
    // very basic sql parser to determine if it's a SELECT or not
    const trimmed = text.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('WITH');
    const stmt = this.db.prepare(text);

    if (isSelect) {
      const rows = stmt.all(...params) as Row[];
      return { rows, command: 'SELECT', rowCount: rows.length, oid: 0, fields: [] } as QueryResult;
    }

    const info = stmt.run(...params);
    return { rows: [], command: text.split(' ')[0], rowCount: info.changes, oid: 0, fields: [] } as QueryResult;
  }
}
