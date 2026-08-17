import { DatabaseClient } from '../db/client.js';

export interface JournalEntry {
  id?: number;
  user_id: string;
  session_id: string;
  period_start: Date;
  period_end: Date;
  summary: string;
  created_at?: Date;
}

export class JournalStore {
  constructor(private db: DatabaseClient) {}

  async createJournal(entry: JournalEntry): Promise<number> {
    await this.db.query(
      `INSERT INTO journals (user_id, session_id, period_start, period_end, summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.user_id,
        entry.session_id,
        entry.period_start.toISOString(),
        entry.period_end.toISOString(),
        entry.summary,
      ]
    );
    const res = await this.db.query('SELECT last_insert_rowid() as id', []);
    return res.rows[0].id;
  }

  async getRecentJournals(userId: string, limit = 10): Promise<JournalEntry[]> {
    const res = await this.db.query(
      'SELECT * FROM journals WHERE user_id = $1 ORDER BY period_end DESC LIMIT $2',
      [userId, limit]
    );
    return res.rows;
  }
}
