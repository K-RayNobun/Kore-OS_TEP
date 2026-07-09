# Task Spec: Update #8 — Ephemeral Content Purge Engine (The "Mission Done" Cleaner)

## 1. Architecture Overview

Update #9 implements an automated background garbage collection engine designed to enforce workspace optimization and data retention constraints. During an active macro-mission, the `BrowserAutomatorTool` and scraping workflows generate significant temporary data structures (raw downloaded source files, HTML pages, non-optimized images, untrusted staging downloads) required in case the agent needs to backtrack.

However, once a mission transitions to a finalized state (`DONE`), retaining these intermediate artifacts causes server disk space to leak over time. The **Ephemeral Content Purge Engine** hooks into database update cycles or listens for a mission completion event. It performs an atomic sweep across the temporary directories—wiping raw scraped code segments while preserving critical system audit footprints, the `/kaizen` directory, active production source code, and your dual markdown files (`report_technical.md` and `report_executive.md`).

```
           [ Mobile Sync / Human Marks Mission as DONE ]
                                 │
                                 ▼
                 ┌──────────────────────────────┐
                 │     purge_cleaner_engine.ts  │
                 └───────────────┬───────────────┘
                                 │
               Identifies Target Staging Directories
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼ (Wipe Cleared Targets)                        ▼ (Retain Protected Assets)
┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│ • /tmp/downloads/*              │             │ • /home/elo/workspace/src/*     │
│ • reports/missions/scraped/*    │             │ • reports/missions/technical/*  │
│ • .local/share/browser-context/*│             │ • reports/missions/executive/*  │
└─────────────────────────────────┘             │ • /kaizen/*                     │
                                                └─────────────────────────────────┘

```

---

## 2. Concrete Terminal & Control Flow

### A. Expected Standard Out Telemetry Tracking Trace

```txt
[PURGE_ENGINE] [2026-07-02T16:45:00Z] Database event-hook intercept: Mission 'mirage-poc' updated to status: DONE.
[PURGE_ENGINE] [2026-07-02T16:45:00Z] Initializing ephemeral workspace purge routine for safety boundaries...
[PURGE_ENGINE] [2026-07-02T16:45:01Z] Sweeping active browser session data layers under /home/elo/.local/share/browser-context
[PURGE_ENGINE] [2026-07-02T16:45:02Z] Securely purged 1,420 files. Freed storage volume: 412 MB.
[PURGE_ENGINE] [2026-07-02T16:45:02Z] PROTECTED: Preserved /kaizen tracking assets and twin bifurcated mission markdown files.
[PURGE_ENGINE] [2026-07-02T16:45:03Z] Ephemeral cleanup loop successfully closed. State machine synchronized.

```

---

## 3. Exact File Targets & Placements

### Target 1: New Module `src/utils/purge_cleaner_engine.ts`

Create a centralized cleanup manager component utilizing Node’s native `node:fs` capabilities to safely isolate and dismantle temporary directories without threatening repository asset states.

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SecurityGuard } from './security_guard';

export class EphemeralContentPurgeEngine {
    private guard = new SecurityGuard();
    private targetPurgeRoots: string[];

    constructor() {
        // Enforce rigid absolute targets to isolate system directories from recursive deletions
        this.targetPurgeRoots = [
            path.join(process.cwd(), 'reports', 'missions', 'scraped'),
            '/home/elo/.local/share/browser-context',
            '/tmp/downloads'
        ];
    }

    /**
     * Safely sweeps temporary directories recursively when triggered by status lifecycle changes.
     */
    public executeMissionPurge(missionId: string): void {
        console.log(`[PURGE_ENGINE] Booting cleaner sequence for mission references: ${missionId}`);

        for (const targetPath of this.targetPurgeRoots) {
            try {
                // Incorporate path traversal guard mechanisms to prevent accidental system wipes
                if (!fs.existsSync(targetPath)) {
                    continue;
                }

                this.cleanDirectoryRecursively(targetPath);
                console.log(`[PURGE_ENGINE] Successfully cleared temporary structures inside: ${targetPath}`);
            } catch (error: any) {
                console.error(`[PURGE_ENGINE_ERROR] Failed cleaning target root ${targetPath}: ${error.message}`);
            }
        }
    }

    private cleanDirectoryRecursively(directoryPath: string): void {
        const files = fs.readdirSync(directoryPath);

        for (const file of files) {
            const currentPath = path.join(directoryPath, file);
            const fileStat = fs.statSync(currentPath);

            if (fileStat.isDirectory()) {
                this.cleanDirectoryRecursively(currentPath);
                // Securely drop the empty folder casing shell
                fs.rmdirSync(currentPath);
            } else {
                // Delete explicit file asset rows
                fs.unlinkSync(currentPath);
            }
        }
    }
}

```

### Target 2: Integrating the Purge Hook within `src/index.ts`

Link the purge engine to the task lifecycle endpoint or your incoming mobile command processing loop inside `src/index.ts` (Hook 1). This ensures that when a human signals macro mission completion via the phone interface, the system fires off the cleaner sequence automatically.

```typescript
import { EphemeralContentPurgeEngine } from './utils/purge_cleaner_engine';
import { databaseHelper as db } from './utils/database_helper';

const purgeEngine = new EphemeralContentPurgeEngine();

/**
 * Public Entrypoint hook executing when an upstream synchronization request 
 * or mobile app command updates a high-level mission state to completed status.
 */
export async function finalizeMacroMissionState(missionId: string) {
    console.log(`[ORCHESTRATOR] Finalizing mission ${missionId}. Synchronizing state hooks...`);
    
    // 1. Transactionally update macro records inside the tracking tables if tracking states exist
    // db.updateMissionStatus(missionId, 'DONE');

    // 2. Fire the asynchronous background purge engine to collect volatile content artifacts
    try {
        purgeEngine.executeMissionPurge(missionId);
    } catch (cleanupError: any) {
        console.error(`[ORCHESTRATOR_WARNING] Ephemeral purge module failed safely: ${cleanupError.message}`);
    }

    console.log(`[ORCHESTRATOR] Mission state finalized cleanly. Storage assets optimized.`);
}

```

---

## 4. Assumptions Section

* **Protected Folders Boundary Rule:** The path targets are tightly locked to the designated staging array. Under no circumstances will paths referencing the production codebase (`src/`), the system journal state registries (`/kaizen`), or the primary dual-reports repositories (`reports/missions/technical` or `reports/missions/executive`) be fed into the directory traversal cleaner logic.
* **Absence Directory Fault Tolerant Control:** If an external automated process or system script already wiped `/tmp/downloads` prior to the engine trigger sequence, `fs.existsSync` guarantees that the purge tool steps over the target cleanly without raising runtime file errors.

---

## 5. Definition of Done Checklist

* [ ] **Targeted Ephemeral Eradication Test:** Populating `reports/missions/scraped/` with mock HTML files and running `executeMissionPurge("001")` successfully deletes the contents of that directory.
* [ ] **Absolute Asset Preservation Check:** Validates that executing the content purge loop leaves files residing under the `/kaizen/` and `reports/missions/technical/` directory completely untouched.
* [ ] **Missing Directory Graceful Pass:** Attempting to clean directories that do not physically exist on the system workspace does not cause unhandled process errors or freeze the parent `src/index.ts` event frame loop.
* [ ] **Deep Subdirectory Traversal Validation:** Nested directories inside the staging footprint are swept down to their leaf elements and cleanly unlinked without leaving orphan structural casings behind.