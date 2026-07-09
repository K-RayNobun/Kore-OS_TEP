# Task Spec: Update #15 — Headless Browser Infrastructure & Analytics Tracking

## 1. Architecture Overview

Update #15 provides the AI Admin with "eyes" on the web and a "ledger" for marketing performance. This layer is the primary interface for autonomous research, marketplace interaction, and campaign assessment.

1. **Browser Automator:** Utilizes Playwright with persistent, mission-isolated contexts. It incorporates the "human-handoff" logic—if a CAPTCHA or 2FA challenge occurs, it suspends its state, triggers an alert, and waits for a WebSocket VNC proxy reconciliation.
2. **Metrics Ledger:** An isolated analytics database that stores campaign performance and Git-linked pipeline telemetry. This enables the AI to quantitatively assess which "marketing policies" (from `marketing_policy.ts`) result in higher conversion rates.

```
[Orchestrator] ──► [BrowserAutomator] ──► [Session Isolation (Step 3)]
                      │
                      └─► [Human Handoff Exception (2FA/CAPTCHA)]
                      │
                      └─► [MetricsLedger] ──► [marketing_metrics.db]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Browser Session Isolation & Handoff

```txt
[BROWSER]        [2026-07-02T16:45:00Z] Launching mission-context: M-105
[BROWSER]        [2026-07-02T16:45:05Z] Encountered challenge: [AUTH_REQUIRED_2FA]
[ORCHESTRATOR]   [2026-07-02T16:45:05Z] Suspension triggered. Activating Telegram relay.
[ORCHESTRATOR]   [2026-07-02T16:45:05Z] Mission M-105 status set: SUSPENDED_FOR_HUMAN

```

---

## 3. Exact File Targets & Placements

### Target 1: `src/tools/browser_automator.ts`

Uses Playwright with `SessionManager` integration.

```typescript
import { chromium, BrowserContext } from 'playwright';
import { SessionManager } from '../utils/session_manager';

export class BrowserAutomator {
    private sessionMgr = new SessionManager();

    public async createMissionContext(missionId: string): Promise<BrowserContext> {
        const browser = await chromium.launch();
        return await browser.newContext({
            storageState: this.sessionMgr.getSessionDir(missionId) + '/state.json'
        });
    }

    // Logic for handling human-in-the-loop handoff
    public checkHandoffRequired(content: string): boolean {
        return content.includes('2FA') || content.includes('CAPTCHA');
    }
}

```

### Target 2: `src/tools/metrics_ledger.ts`

Interface for tracking campaign success and Git milestones.

```typescript
import Database from 'better-sqlite3';

export class MetricsLedger {
    private db = new Database('/home/elo/data/marketing_metrics.db');

    public recordMilestone(campaignId: string, gitHash: string, score: number) {
        const stmt = this.db.prepare(`
            INSERT INTO git_pipeline_telemetry (campaign_id, git_hash, score) 
            VALUES (?, ?, ?)
        `);
        return stmt.run(campaignId, gitHash, score);
    }
}

```

---

## 4. Assumptions Section

* **Dependencies:** Assumes `playwright` and `better-sqlite3` are installed in the container environment.
* **Storage:** The `SessionManager` path must exist and be writable by the `elo` user, as established in Step 3.
* **Network:** The Browser instance must adhere to the `NetworkGuard` logic (enforced via a proxy or custom browser context configuration in production).

---

## 5. Definition of Done Checklist

* [ ] **Session Pinning:** Confirm that `BrowserAutomator` stores context files in the mission-specific directory created by `SessionManager`.
* [ ] **Handoff Logic:** Verify that `checkHandoffRequired` identifies standard challenge strings.
* [ ] **Metrics Integrity:** Confirm `recordMilestone` inserts data correctly into the secondary metrics database without impacting the primary `tasks` ledger.

---

**Step 9 is complete. We are now at the finish line! Are you ready for the final Step 10: Autonomous Lifecycle Integration & MCP Bootstrapping (`src/index.ts`)?**