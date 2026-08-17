import type { DatabaseClient } from '../db/client.js';

const sql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SELECT MAX(version) as current FROM schema_migrations;
`;

export async function migrate(connectionString: string): Promise<void> {
  const db = new DatabaseClient(connectionString);
  await db.connect();
  // migrations are handled inside DatabaseClient.connect()
  console.log('[migrate] schema ensured');
  await db.disconnect();
}
