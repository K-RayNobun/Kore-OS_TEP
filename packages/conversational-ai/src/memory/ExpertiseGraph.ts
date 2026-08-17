import { DatabaseClient } from '../db/client.js';

export interface ExpertiseNode {
  user_id: string;
  subject: string;
  proficiency: number;
  last_used: Date;
  evidence_count: number;
}

export class ExpertiseGraph {
  constructor(private db: DatabaseClient) {}

  async recordEvidence(userId: string, subject: string, delta = 0.05): Promise<void> {
    const res = await this.db.query(
      `INSERT INTO expertise_graph (user_id, subject, proficiency, last_used, evidence_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, subject) DO UPDATE
       SET proficiency = MIN(1.0, GREATEST(0.0, expertise_graph.proficiency + $5)),
           last_used = $4,
           evidence_count = expertise_graph.evidence_count + 1`,
      [userId, subject, 0.50 + delta, new Date().toISOString(), delta]
    );
  }

  async getProficiency(userId: string, subject: string): Promise<number> {
    const res = await this.db.query(
      'SELECT proficiency FROM expertise_graph WHERE user_id = $1 AND subject = $2',
      [userId, subject]
    );
    return res.rows[0]?.proficiency ?? 0.50;
  }

  async listForUser(userId: string): Promise<ExpertiseNode[]> {
    const res = await this.db.query(
      'SELECT * FROM expertise_graph WHERE user_id = $1 ORDER BY proficiency DESC',
      [userId]
    );
    return res.rows;
  }

  async decayStale(userId: string, maxAgeDays = 30, decay = 0.05): Promise<number> {
    const res = await this.db.query(
      `UPDATE expertise_graph
       SET proficiency = MAX(0, proficiency - $1)
       WHERE user_id = $2
         AND last_used < datetime('now', '-' || $3 || ' days')
         AND proficiency > 0.10
       RETURNING subject`,
      [decay, userId, maxAgeDays]
    );
    return res.rows.length;
  }
}
