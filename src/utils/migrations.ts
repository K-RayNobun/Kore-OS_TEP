import * as dbHelper from "./database_helper.js";

export interface Migration {
  version: number;
  name: string;
  up: () => void | Promise<void>;
}

const MIGRATIONS: Migration[] = [];

function register(m: Migration): void {
  MIGRATIONS.push(m);
  MIGRATIONS.sort((a, b) => a.version - b.version);
}

export function addMigration(m: Migration): void {
  register(m);
}

export class MigrationRunner {
  constructor(private readonly db: ReturnType<typeof import("better-sqlite3")>) {}

  public async run(): Promise<void> {
    await this.ensureTable();
    const pending = this.getPending();
    for (const migration of pending) {
      console.error(`[MIGRATIONS] Applying ${migration.name} (v${migration.version})`);
      await migration.up();
      this.db.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES (?)").run(migration.version);
    }
    console.error(`[MIGRATIONS] Applied ${pending.length} migrations`);
  }

  private ensureTable(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  }

  private getPending(): Migration[] {
    const applied = new Set(
      (this.db.prepare("SELECT version FROM schema_version").all() as { version: number }[]).map((r) => r.version)
    );
    return MIGRATIONS.filter((m) => !applied.has(m.version));
  }
}

register({
  version: 1,
  name: "initial_schema",
  up: () => {
    dbHelper.ensureSchema();
  }
});
