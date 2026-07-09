# Task Spec: Update #5 — Metrics Ledger (The Git Pipeline Update)

## 1. Architecture Overview

Update #5 creates a tight tracking integration between the **Metrics Ledger** and the automated Git version control pipeline. Every time the execution loop finishes a successful task transformation or a recursive test-and-patch iteration, the system must not only execute a local Git commit but also register that exact development milestone directly into the secondary tracking database (`/home/elo/data/marketing_metrics.db`) for long-term telemetry and diagnostic recording.

By anchoring Git commit hashes directly to database rows alongside resource utilization parameters, the system can audit historical developer iteration metrics and programmatically verify code integrity records from a centralized point.

```
       [ Successful Recursive Loop Iteration Complete ]
                               │
                               ▼
               ┌───────────────────────────────┐
               │    git_automation_helper.ts   │
               └───────────────┬───────────────┘
                               │ (Generates Commit & Captures Hash)
                               ▼
               ┌───────────────────────────────┐
               │     metrics_ledger.ts         │
               └───────────────┬───────────────┘
                               │ (Executes Transactional SQL Insert)
                               ▼
     📂 /home/elo/data/marketing_metrics.db [git_pipeline_telemetry]

```

---

## 2. Concrete Terminal & Control Flow

### A. Database Migration Schema (Target: `marketing_metrics.db`)

Execute this initialization query against the analytics database instance to capture Git milestone metrics cleanly:

```sql
CREATE TABLE IF NOT EXISTS git_pipeline_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    branch_name TEXT NOT NULL,
    commit_hash TEXT NOT NULL UNIQUE,
    commit_message TEXT NOT NULL,
    lines_added INTEGER DEFAULT 0,
    lines_deleted INTEGER DEFAULT 0,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

```

### B. Sample Production Commit Log Target

```txt
commit 4e5a6f7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f
Author: Kore OS Admin <admin@kore-os.internal>
Date:   Thu Jul 2 15:45:10 2026 +0000

    chore(task-15): optimized asset rendering pipelines
    
    METADATA_SNAPSHOT:
    - Target Subtask ID: 15
    - Run State: PRODUCTION_REALIZATION
    - Active Branch: main
    - Loop Counter Trace: 3/10
    - Technical Execution Status: STABLE_BUILD

```

---

## 3. Exact File Targets & Placements

### Target 1: Refactoring `src/tools/metrics_ledger.ts`

Upgrade your existing tool structure to export the `MetricsLedger` engine class alongside its required MCP tool registration hooks.

```typescript
import Database from 'better-sqlite3';
import * as path from 'node:path';

export interface GitTelemetryPayload {
    taskId: number;
    branchName: string;
    commitHash: string;
    commitMessage: string;
    linesAdded: number;
    linesDeleted: number;
}

export class MetricsLedger {
    private db: any;

    constructor() {
        const dbPath = process.env.KORE_MARKETING_METRICS_DB_PATH || '/home/elo/data/marketing_metrics.db';
        this.db = new Database(dbPath);
        this.initializeSchema();
    }

    private initializeSchema() {
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS git_pipeline_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                branch_name TEXT NOT NULL,
                commit_hash TEXT NOT NULL UNIQUE,
                commit_message TEXT NOT NULL,
                lines_added INTEGER DEFAULT 0,
                lines_deleted INTEGER DEFAULT 0,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `).run();
    }

    /**
     * Commits a granular Git development milestone record into the analytics telemetry db.
     */
    public logGitMilestone(payload: GitTelemetryPayload): void {
        const stmt = this.db.prepare(`
            INSERT INTO git_pipeline_telemetry 
            (task_id, branch_name, commit_hash, commit_message, lines_added, lines_deleted)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            payload.taskId,
            payload.branchName,
            payload.commitHash,
            payload.commitMessage,
            payload.linesAdded,
            payload.linesDeleted
        );
        console.log(`[METRICS_LEDGER] Successfully logged commit pipeline telemetry for hash: ${payload.commitHash}`);
    }
}

// Keep core hook integration fully intact for your MCP registration loops
export function registerMetricsLedgerTool(server: any) {
    const ledger = new MetricsLedger();
    // Wrap existing MCP tools mapping functionality tightly here
}

```

### Target 2: Integrating Git Diff Parsing within `src/utils/git_automation_helper.ts`

Update your existing `GitAutomationHelper` utility to automatically harvest lines changed metrics directly via low-level `git show` plumbing metrics.

```typescript
// Add these signatures and extraction utilities inside your GitAutomationHelper class
export interface CommitStats {
    hash: string;
    linesAdded: number;
    linesDeleted: number;
}

public getLatestCommitStats(): CommitStats {
    try {
        const hash = this.executeGitCommand('rev-parse HEAD');
        // Extract raw insertions/deletions tracking digits (e.g., "1 file changed, 5 insertions(+), 2 deletions(-)")
        const numstat = this.executeGitCommand('show --numstat --oneline HEAD');
        
        let linesAdded = 0;
        let linesDeleted = 0;
        
        const lines = numstat.split('\n').slice(1); // Drop the commit message header row
        for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
                const added = parseInt(parts[0] || '0', 10);
                const deleted = parseInt(parts[1] || '0', 10);
                if (!isNaN(added)) linesAdded += added;
                if (!isNaN(deleted)) linesDeleted += deleted;
            }
        }
        
        return { hash, linesAdded, linesDeleted };
    } catch (error) {
        return { hash: 'UNKNOWN', linesAdded: 0, linesDeleted: 0 };
    }
}

```

### Target 3: Execution Hook Placement inside `src/index.ts`

Update the runtime execution container thread within `src/index.ts` to seamlessly capture and bind data records across both layers post-iteration cycle:

```typescript
import { GitAutomationHelper } from './utils/git_automation_helper';
import { MetricsLedger } from './tools/metrics_ledger';

const gitHelper = new GitAutomationHelper();
const metricsLedger = new MetricsLedger();

async function commitAndLogIterationProgress(taskId: number, stateMsg: string) {
    const currentBranch = gitHelper.getCurrentBranch();
    const commitMsg = `chore(task-${taskId}): ${stateMsg}\n\nMETADATA_SNAPSHOT:\n- Target Subtask ID: ${taskId}\n- Active Branch: ${currentBranch}`;
    
    // 1. Force the git workspace capture pass
    const generatedHash = gitHelper.commitWorkspace(commitMsg);
    
    // 2. Extract precise file transformation tracking telemetry
    const stats = gitHelper.getLatestCommitStats();
    
    // 3. Log data payload completely down into the analytical database layer
    metricsLedger.logGitMilestone({
        taskId: taskId,
        branchName: currentBranch,
        commitHash: generatedHash,
        commitMessage: commitMsg,
        linesAdded: stats.linesAdded,
        linesDeleted: stats.linesDeleted
    });
}

```

---

## 4. Assumptions Section

* **Isolation of Database States:** The `marketing_metrics.db` and its core transaction routines are entirely detached from operations running inside `kore.db`. A transaction lock or corruption inside analytics logging will never halt or block the critical `tasks` task execution engine state paths.
* **Diff Parsing Robustness:** If a commit introduces zero code modifications or purely includes binary payload binary assets, the parse logic defaults gracefully to `0` lines changed without passing un-parseable string patterns down into SQLite.

---

## 5. Definition of Done Checklist

* [ ] **Atomic Hash Correlation Validation:** Making a workspace modification successfully logs a row inside `git_pipeline_telemetry` that matches the identical system hash reported by `git rev-parse HEAD`.
* [ ] **Numstat Extraction Integrity Check:** Committing a patch with exactly 5 file updates, 12 lines added, and 4 lines removed correctly parses numbers without throwing NaN errors into the ledger parameters.
* [ ] **MCP Server Layer Preservation:** Validates that refactoring `metrics_ledger.ts` to expose the class does not disrupt or damage the standard tool instantiation wrappers running when `src/index.ts` starts up.
* [ ] **Divergent Branch Continuity:** Assert that commits running on speculative branches (`speculative-exploratory-*`) are safely tracked inside the database ledger alongside the actual runtime branch identifier.