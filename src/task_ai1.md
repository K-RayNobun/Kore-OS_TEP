# Task Spec: Update #7 — Core SQLite Executive Ledger & Task Management System

## 1. Architecture Overview

Update #7 implements the "Executive Ledger"—the persistent memory layer for the AI Admin. This system ensures that all mission-critical tasks are tracked, prioritized, and auditable within a relational SQLite database.

1. **Structured Task Ledger:** Every mission is decomposed into `tasks` stored in `KORE_OS_DB`. Each row holds state, mission context, and metadata, providing a "single source of truth" for the orchestrator.
2. **State Transactionality:** By using atomic database updates, we ensure that an AI task cannot exist in a "ghost" state. If a system failure occurs, the database preserves the last known state (`PENDING` or `RUNNING`) for recovery on restart.
3. **Analytics Isolation:** A dedicated `metrics_ledger` manages a separate database for high-frequency telemetry, preventing system task clutter from interfering with marketing analytics.

```
[Orchestrator Logic] ──► [DatabaseHelper] ──► [SQLite Ledger (tasks.db)]
                                     │
                                     └──────► [Analytics Ledger (marketing_metrics.db)]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Initializing Ledger & Task Injection

```txt
[DB_INIT]        [2026-07-02T16:10:00Z] SQLite connection established to /home/elo/data/tasks.db
[DB_INIT]        [2026-07-02T16:10:00Z] Verified table 'tasks' schema via PRAGMA table_info.
[ORCHESTRATOR]   [2026-07-02T16:10:05Z] New Mission ID [M-99] received.
[DB_LOG]         [2026-07-02T16:10:05Z] Created Task ID [T-100] (Name: "Initialize Browser Session").
[DB_LOG]         [2026-07-02T16:10:05Z] Status set: PENDING | Dependency: None.

```

---

## 3. Exact File Targets & Placements

### Target 1: Implementing `src/utils/database_helper.ts`

This module provides the interface for the AI Admin to interact with its memory.

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';

export class DatabaseHelper {
    private db: Database.Database;

    constructor(dbPath: string = '/home/elo/data/tasks.db') {
        this.db = new Database(dbPath);
        this.initSchema();
    }

    private initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'PENDING',
                dependency_id INTEGER,
                priority INTEGER DEFAULT 0,
                logic_branch TEXT,
                mission_id TEXT,
                technical_report_path TEXT,
                executive_report_path TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    public createTask(task: { name: string, missionId: string, dependencyId?: number }) {
        const stmt = this.db.prepare(`
            INSERT INTO tasks (name, mission_id, dependency_id) VALUES (?, ?, ?)
        `);
        return stmt.run(task.name, task.missionId, task.dependencyId || null);
    }

    public updateTaskStatus(id: number, status: string) {
        const stmt = this.db.prepare(`UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        return stmt.run(status, id);
    }
    
    public getAvailableTasks() {
        return this.db.prepare(`SELECT * FROM tasks WHERE status = 'PENDING' ORDER BY priority DESC`).all();
    }
}

```

### Target 2: Implementing `src/tools/metrics_ledger.ts`

This tool manages the secondary analytics database, isolating business data from core OS tasks.

```typescript
import Database from 'better-sqlite3';

export class MetricsLedger {
    private db: Database.Database;

    constructor() {
        this.db = new Database('/home/elo/data/marketing_metrics.db');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                performance_score REAL,
                last_git_milestone TEXT
            )
        `);
    }

    public logCampaignMetric(id: string, score: number) {
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO campaigns (id, performance_score) VALUES (?, ?)`);
        return stmt.run(id, score);
    }
}

export function registerMetricsLedgerTool(server: any) {
    const ledger = new MetricsLedger();
    // Register tool with MCP server instance
}

```

---

## 4. Assumptions Section

* **Environment:** Assumes `better-sqlite3` is added to `package.json`.
* **Atomic Operations:** SQLite's file-level locking is sufficient for the current single-process AI Admin instance (MCP server).
* **Migration:** If `tasks` schema changes, the `PRAGMA` check will catch mismatches; implementation of migration logic is deferred to a future Update.

---

## 5. Definition of Done Checklist

* [ ] **Schema Initialization:** Confirm `tasks.db` and `marketing_metrics.db` are created in `/home/elo/data/` with correct tables on startup.
* [ ] **Task Creation Logic:** Verify `createTask` successfully inserts rows and returns IDs.
* [ ] **Status Workflow:** Confirm `updateTaskStatus` correctly transitions tasks between `PENDING` and `DONE`.
* [ ] **Isolation:** Ensure `MetricsLedger` interacts exclusively with the marketing database, keeping the task ledger "clean."