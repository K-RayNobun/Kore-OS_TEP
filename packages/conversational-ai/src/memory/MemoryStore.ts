import type { DatabaseClient } from '../db/client.ts';

export interface AgentMemory {
  id?: number;
  user_id: string;
  entry: string;
  confidence?: number;
  source?: string;
  created_at?: Date;
  updated_at?: Date;
}

export interface UserProfile {
  user_id: string;
  tone?: string;
  tone_score?: Record<string, number>;
  availability?: Record<string, unknown>;
  attention?: Record<string, unknown>;
  expertise?: unknown[];
  style_notes?: string;
  updated_at?: Date;
}

export class MemoryStore {
  constructor(private db: DatabaseClient) {}

  async addMemory(memory: AgentMemory): Promise<number> {
    await this.db.query(
      `INSERT INTO agent_memories (user_id, entry, confidence, source)
       VALUES ($1, $2, $3, $4)`,
      [
        memory.user_id,
        memory.entry,
        memory.confidence ?? 0.80,
        memory.source ?? 'background_review',
      ]
    );
    const res = await this.db.query('SELECT last_insert_rowid() as id', []);
    return res.rows[0].id;
  }

  async getMemories(userId: string, limit = 100): Promise<AgentMemory[]> {
    const res = await this.db.query(
      `SELECT * FROM agent_memories
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }

  async getRecentMemories(userId: string, limit = 20): Promise<AgentMemory[]> {
    const res = await this.db.query(
      `SELECT * FROM agent_memories
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows.reverse(); // oldest first for prompt injection
  }

  async getOrCreateProfile(userId: string): Promise<UserProfile> {
    const res = await this.db.query(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [userId]
    );
    if (res.rows.length > 0) return res.rows[0];

    await this.db.query(
      `INSERT INTO user_profiles (user_id) VALUES ($1)`,
      [userId]
    );
    const fresh = await this.db.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
    return fresh.rows[0];
  }

  async updateProfile(userId: string, patch: Partial<UserProfile>): Promise<UserProfile> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const key of Object.keys(patch)) {
      if (key === 'user_id') continue;
      const col = key as keyof UserProfile;
      fields.push(`${col} = $${idx}`);
      values.push((patch as Record<string, unknown>)[key]);
      idx++;
    }

    if (fields.length === 0) {
      return this.getOrCreateProfile(userId);
    }

    fields.push(`updated_at = $${idx}`);
    values.push(new Date().toISOString());
    idx++;

    values.push(userId);

    const sql = `UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = $${idx} RETURNING *`;
    const stringified = values.map(v => typeof v === 'object' ? JSON.stringify(v) : v);
    const res = await this.db.query(sql, stringified);
    return res.rows[0];
  }

  async deleteMemory(userId: string, memoryId: number): Promise<void> {
    await this.db.query(
      'DELETE FROM agent_memories WHERE id = $1 AND user_id = $2',
      [memoryId, userId]
    );
  }

  async decayConfidence(userId: string, maxAgeDays = 30, decayPerWeek = 0.05): Promise<number> {
    const res = await this.db.query(
      `UPDATE agent_memories
       SET confidence = MAX(0, confidence - $1)
       WHERE user_id = $2
         AND created_at < datetime('now', '-' || $3 || ' days')
         AND confidence > 0.10
       RETURNING id, confidence`,
      [decayPerWeek, userId, maxAgeDays]
    );
    return res.rows.length;
  }

  async pruneLowConfidence(userId: string, threshold = 0.30): Promise<number> {
    const res = await this.db.query(
      `DELETE FROM agent_memories
       WHERE user_id = $1 AND confidence < $2
       RETURNING id`,
      [userId, threshold]
    );
    return res.rows.length;
  }
}
