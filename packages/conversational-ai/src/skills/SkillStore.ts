import type { DatabaseClient } from '../db/client.js';

export interface SkillDefinition {
  id?: number;
  user_id: string;
  name: string;
  description?: string;
  definition: Record<string, unknown>;
  state?: 'active' | 'archived';
  use_count?: number;
  pinned?: boolean;
  created_at?: Date;
  archived_at?: Date;
}

export class SkillStore {
  constructor(private db: DatabaseClient) {}

  async create(skill: SkillDefinition): Promise<number> {
    const existing = await this.listForUser(skill.user_id);
    const found = existing.find((s) => s.name === skill.name);
    if (found) return found.id;

    await this.db.query(
      `INSERT INTO skills (user_id, name, description, definition)
       VALUES ($1, $2, $3, $4)`,
      [skill.user_id, skill.name, skill.description ?? null, JSON.stringify(skill.definition)]
    );
    const res = await this.db.query('SELECT last_insert_rowid() as id', []);
    return res.rows[0].id;
  }

  async getById(id: number): Promise<SkillDefinition | null> {
    const res = await this.db.query('SELECT * FROM skills WHERE id = $1', [id]);
    return res.rows[0] ?? null;
  }

  async listForUser(userId: string, includeArchived = false): Promise<SkillDefinition[]> {
    const res = includeArchived
      ? await this.db.query('SELECT * FROM skills WHERE user_id = $1 ORDER BY created_at DESC', [userId])
      : await this.db.query("SELECT * FROM skills WHERE user_id = $1 AND state = 'active' ORDER BY created_at DESC", [userId]);
    return res.rows.map((r) => ({ ...r, definition: typeof r.definition === 'string' ? JSON.parse(r.definition) : r.definition }));
  }

  async incrementUse(id: number): Promise<void> {
    await this.db.query('UPDATE skills SET use_count = use_count + 1 WHERE id = $1', [id]);
  }

  async archive(id: number): Promise<void> {
    await this.db.query(
      "UPDATE skills SET state = 'archived', archived_at = now() WHERE id = $1 AND state = 'active'",
      [id]
    );
  }

  async restore(id: number): Promise<void> {
    await this.db.query(
      "UPDATE skills SET state = 'active', archived_at = null WHERE id = $1 AND state = 'archived'",
      [id]
    );
  }

  async pin(id: number, pinned: boolean): Promise<void> {
    await this.db.query('UPDATE skills SET pinned = $1 WHERE id = $2', [pinned, id]);
  }
}
