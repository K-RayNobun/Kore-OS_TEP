# Task Spec: Update #14 — Content Mutation & Disaster Recovery Engines

## 1. Architecture Overview

Update #14 provides the AI Admin with the ability to surgically modify its codebase, optimize multimedia for web delivery, and ensure absolute data persistence. This step closes the loop on system autonomy by enabling "self-healing" and asset preparation capabilities.

1. **Surgical Patching:** `patch.ts` allows the AI to perform text-based refactoring of its own logic without manual intervention, governed by strict path and content validation.
2. **Asset Optimization:** `asset_optimizer.ts` automates multimedia preparation (images/video) using hardened FFmpeg profiles, preventing resource-heavy or malicious file encodings.
3. **Disaster Recovery:** `backup.ts` provides transactional snapshots of the entire workspace, ensuring that any failed "realization" experiment can be rolled back to a point-in-time state.

```
[Orchestrator] ──► [Patching Tool] ────► [Validated File Mutation]
                      │
                      ├─► [Asset Optimizer] ──► [FFmpeg Security Profile]
                      │
                      └─► [Backup Tool] ──────► [Transactional .tar.gz]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Surgical Patch Execution

```txt
[PATCH_TOOL]     [2026-07-02T16:40:00Z] Target: src/utils/trait_registry.ts
[PATCH_TOOL]     [2026-07-02T16:40:00Z] Pattern match found. Applying change: "ELOQUENT" -> "LOGICAL"
[GIT_HELPER]     [2026-07-02T16:40:01Z] Commit: "Sync State | Decision: T-302 | Patched TraitRegistry"

```

---

## 3. Exact File Targets & Placements

### Target 1: `src/tools/patch.ts`

Performs surgical text-based mutations.

```typescript
import fs from 'node:fs';
import { SecurityGuard } from '../utils/security_guard';

export class PatchTool {
    private guard = new SecurityGuard();

    public applyPatch(filePath: string, find: string, replace: string) {
        const safePath = this.guard.validateAndResolvePath(filePath);
        const content = fs.readFileSync(safePath, 'utf8');
        const newContent = content.split(find).join(replace);
        fs.writeFileSync(safePath, newContent);
        return true;
    }
}

```

### Target 2: `src/tools/asset_optimizer.ts`

Uses strictly validated FFmpeg arguments.

```typescript
import { execSync } from 'node:child_process';
import { CommandValidator } from '../utils/command_validator';

export class AssetOptimizer {
    public optimize(input: string, output: string) {
        const args = ['-i', input, '-vcodec', 'libx264', '-crf', '23', output];
        if (!CommandValidator.validateFFmpegArgs(args)) throw new Error("Invalid FFmpeg profile");
        
        execSync(`ffmpeg ${args.join(' ')}`);
    }
}

```

### Target 3: `src/tools/backup.ts`

Creates atomic archives of the workspace.

```typescript
import { execSync } from 'node:child_process';
import * as path from 'node:path';

export class BackupTool {
    public createSnapshot(missionId: string) {
        const target = `/var/backups/elo-tep/${missionId}_${Date.now()}.tar.gz`;
        execSync(`tar -czf ${target} /home/elo/workspace`);
        return target;
    }
}

```

---

## 4. Assumptions Section

* **Backup Storage:** Assumes `/var/backups/elo-tep` exists and is writable by the `elo` user.
* **FFmpeg:** Assumes standard `ffmpeg` is available in the system `$PATH`.

---

## 5. Definition of Done Checklist

* [ ] **Patch Verification:** Ensure `applyPatch` only succeeds if the target file is within the `ALLOWED_ROOTS`.
* [ ] **Asset Validation:** Confirm `optimize` blocks non-approved flags (e.g., `-vf` filters).
* [ ] **Snapshot Integrity:** Verify `tar` creates a valid archive that can be manually unpacked to restore the workspace state.
