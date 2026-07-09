# Task Spec: Update #11 — Mission-Critical Report Compilation Framework

## 1. Architecture Overview

Update #11 implements the **Reporting Layer**, ensuring that every AI-driven action is documented in a human-readable format. This system acts as both a forensic log and an executive summary generator, separating technical system events from the high-level project narrative.

1. **Dual-Layered Documentation:** Automatically maintains `technical` logs (for code debugging) and `executive` reports (for human oversight) for every `missionId`.
2. **Safe-Brake Reflection:** Any time an execution hits a security barrier or critical failure, a `reflection_{taskId}.md` is generated, allowing the AI to "think" about why the mission failed.
3. **Environment-Agnostic Resolution:** Uses `KORE_REPORTS_PATH` or falls back to project-relative paths, ensuring the system can be deployed anywhere without breaking log persistence.

```
[System Events] ──► [PlaybookCompiler] ──► [Technical Report Stream]
                            │
                            └──────────► [Executive Summary Overwrite]
                            │
                            └──────────► [Reflection File (on Failure)]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Reporting Lifecycle for Mission M-101

```txt
[COMPILER]       [2026-07-02T16:25:00Z] Initializing report streams for Mission: M-101
[COMPILER]       [2026-07-02T16:25:00Z] Technical log created: /reports/missions/technical/mission_M-101_technical.md
[ORCHESTRATOR]   [2026-07-02T16:25:05Z] Task T-202 Completed. Logging outcomes...
[COMPILER]       [2026-07-02T16:25:05Z] Appended status to technical log.
[COMPILER]       [2026-07-02T16:25:05Z] Updating executive report summary...

```

---

## 3. Exact File Targets & Placements

### Target 1: Implementing `src/tools/playbook_compiler.ts`

This class handles the structured stream of mission progress.

```typescript
import fs from 'node:fs';
import path from 'node:path';

export class PlaybookCompiler {
    private baseDir: string;

    constructor() {
        this.baseDir = process.env.KORE_REPORTS_PATH || path.join(process.cwd(), 'reports/missions');
        this.ensureDirectories();
    }

    private ensureDirectories() {
        ['technical', 'executive', 'scraped', 'reflection'].forEach(dir => {
            fs.mkdirSync(path.join(this.baseDir, dir), { recursive: true });
        });
    }

    public compileTechnicalReport(missionId: string, entry: string) {
        const filePath = path.join(this.baseDir, 'technical', `mission_${missionId}_technical.md`);
        fs.appendFileSync(filePath, `[${new Date().toISOString()}] ${entry}\n`);
    }

    public updateExecutiveReport(missionId: string, summary: string) {
        const filePath = path.join(this.baseDir, 'executive', `mission_${missionId}_executive.md`);
        fs.writeFileSync(filePath, `# Executive Summary: ${missionId}\n\n${summary}`);
    }

    public writeReflection(taskId: number, logic: string) {
        const filePath = path.join(this.baseDir, 'reflection', `reflection_${taskId}.md`);
        fs.writeFileSync(filePath, `### Reflection Log\nTask: ${taskId}\nDate: ${new Date().toISOString()}\n\n${logic}`);
    }
}

```

### Target 2: Updating MCP Registration in `src/tools/playbook_compiler.ts`

```typescript
export function registerPlaybookCompilerTool(server: any) {
    const compiler = new PlaybookCompiler();
    
    // Register tools as MCP functions
    server.tool("logTechnicalProgress", { missionId: "string", entry: "string" }, async ({ missionId, entry }) => {
        compiler.compileTechnicalReport(missionId, entry);
        return { content: [{ type: "text", text: "Logged successfully." }] };
    });
}

```

---

## 4. Assumptions Section

* **IO Permissions:** Assumes the `elo` user has full write access to the `reports/` directory.
* **Format:** Files are strictly formatted as Markdown to ensure future compatibility with documentation tools or web frontends.

---

## 5. Definition of Done Checklist

* [ ] **Directory Creation:** Verify `reports/missions/` subfolders exist upon `PlaybookCompiler` instantiation.
* [ ] **Stream Persistence:** Verify `compileTechnicalReport` appends data without overwriting.
* [ ] **Executive Sync:** Verify `updateExecutiveReport` creates a clean, up-to-date version of the project state.
* [ ] **MCP Integration:** Verify that `registerPlaybookCompilerTool` successfully attaches to the server instance.
