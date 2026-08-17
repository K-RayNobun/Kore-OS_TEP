import type { DatabaseClient } from '../db/client.js';

export interface ConversationMessage {
  id?: number;
  user_id: string;
  session_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: unknown;
  tool_name?: string;
  created_at?: Date;
}

export class ConversationStore {
  constructor(private db: DatabaseClient) {}

  async append(message: ConversationMessage): Promise<number> {
    await this.db.query(
      `INSERT INTO conversations (user_id, session_id, role, content, tool_calls, tool_name)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        message.user_id,
        message.session_id,
        message.role,
        message.content,
        message.tool_calls ?? null,
        message.tool_name ?? null,
      ]
    );
    const res = await this.db.query('SELECT last_insert_rowid() as id', []);
    return res.rows[0].id;
  }

  async getSession(userId: string, sessionId: string, limit = 50): Promise<ConversationMessage[]> {
    const res = await this.db.query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND session_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [userId, sessionId, limit]
    );
    return res.rows;
  }

  async search(userId: string, query: string, limit = 10): Promise<ConversationMessage[]> {
    const likeQuery = `%${query.replace(/'/g, "''")}%`;
    const res = await this.db.query(
      `SELECT * FROM conversations
       WHERE user_id = $1 AND content LIKE $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [userId, likeQuery, limit]
    );
    return res.rows;
  }

  async getRecentSessions(userId: string, limit = 20): Promise<string[]> {
    const res = await this.db.query(
      `SELECT DISTINCT session_id FROM conversations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows.map((r) => r.session_id);
  }
}
