# Task Spec: Update #12 — Git-Driven Declarative State Engine

## 1. Architecture Overview

Update #12 implements the **State Versioning Core**. Because Kore OS requires absolute determinism, we treat the entire workspace as a Git-versioned repository. Every time the AI Admin completes a mission step, the system commits the resulting state. This allows for instant "time travel" (rollbacks) if a modification breaks the system.

1. **Declarative State Tracking:** Every system property change (configs, database entries, scripts) is auto-committed.
2. **Forensic Auditability:** Every commit message is linked directly to a `DecisionID` from our SQLite journal, allowing us to trace exactly which "thought" led to a specific code or config change.
3. **Atomic Rollback:** Providing the ability to execute `git reset --hard` to return to a previous known-good state if an autonomous process causes a runtime crash.

```
[System Mutation] ──► [Database Update] ──► [GitAutomationHelper] ──► [Commit (ID: DecisionID)]
                                                                               │
                                                                               ▼
                                                                     [Local Repo: /workspace]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Automatic State Snapshot

```txt
[ORCHESTRATOR]   [2026-07-02T16:30:00Z] Task T-205 completed: Patching config/services.json
[GIT_HELPER]     [2026-07-02T16:30:00Z] Staging workspace changes...
[GIT_HELPER]     [2026-07-02T16:30:01Z] Committing: "Sync State | Decision: T-205"
[GIT_HELPER]     [2026-07-02T16:30:01Z] Commit successful. SHA: 8a2f3b9c...

```

---

## 3. Exact File Targets & Placements

### Target 1: Implementing `src/utils/git_automation_helper.ts`

This helper manages the Git-lifecycle of the `/home/elo/workspace` environment.

```typescript
import { execSync } from 'node:child_process';
import * as path from 'node:path';

export class GitAutomationHelper {
    private workDir = '/home/elo/workspace';

    constructor() {
        this.initRepo();
    }

    private initRepo() {
        try {
            execSync('git init', { cwd: this.workDir });
        } catch {}
    }

    public commitState(taskId: number, message: string) {
        try {
            execSync('git add .', { cwd: this.workDir });
            execSync(`git commit -m "Sync State | Decision: ${taskId} | ${message}"`, { cwd: this.workDir });
            return execSync('git rev-parse HEAD', { cwd: this.workDir }).toString().trim();
        } catch (error) {
            console.error('[GIT_ERROR] Failed to commit state:', error);
            return null;
        }
    }

    public rollbackTo(sha: string) {
        execSync(`git reset --hard ${sha}`, { cwd: this.workDir });
    }
}

```

---

## 4. Assumptions Section

* **Git Configuration:** Assumes `git` is installed in the container image and `user.email`/`user.name` are configured at container initialization (or via local Git config).
* **Workspace:** The folder `/home/elo/workspace` is already initialized as the primary AI modification zone.

---

## 5. Definition of Done Checklist

* [ ] **Auto-Initialization:** Confirm `git init` runs on the workspace folder on the first instantiation.
* [ ] **Commit Integration:** Verify that `commitState` successfully uses the `taskId` in the commit message for forensic tracking.
* [ ] **Rollback Safety:** Confirm that `rollbackTo` successfully reverts the filesystem to a target SHA, matching the expected file states.
