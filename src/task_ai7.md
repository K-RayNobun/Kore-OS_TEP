# Task Spec: Update #13 — Low-Level OS Administration & Inspection Tools

## 1. Architecture Overview

Update #13 provides the AI Admin with "system eyes and hands." These tools allow the AI to monitor hardware health, manage daemonized services (via OpenRC), inspect binary signatures, and audit network activity. This layer transforms the AI from a mere script runner into a true Operating System Administrator.

1. **Hardware Telemetry:** Direct reads from `/proc/meminfo` and `node:os` to gauge resource availability before launching compute-heavy tasks.
2. **Process Orchestration:** Using OpenRC-style commands to manage the lifecycle of system services.
3. **Network & Binary Auditing:** Passive scanning tools to verify binary integrity and identify active TCP/UDP ports, ensuring the environment remains within specified network boundaries.

```
[Orchestrator] ──► [Tool Suite] ──► [System Interface]
       │                 │                │
       ├─ Telemetry ─────┼──► /proc, os ──┤
       ├─ ServiceMngr ──┼──► OpenRC ─────┤
       ├─ NetAudit ─────┼──► netstat ────┤
       └─ BinInspector ─┼──► ldd/strings ┘

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: System Health Audit & Service Restart

```txt
[TELEMETRY]      [2026-07-02T16:35:10Z] Memory status: 85% utilization detected.
[SVC_MANAGER]    [2026-07-02T16:35:11Z] Investigating 'marketing_bot' status...
[SVC_MANAGER]    [2026-07-02T16:35:11Z] Status: CRASHED. Initiating restart sequence.
[SVC_MANAGER]    [2026-07-02T16:35:12Z] Service 'marketing_bot' restarted successfully.

```

---

## 3. Exact File Targets & Placements

### Target 1: `src/tools/telemetry.ts`

Exposes hardware performance data.

```typescript
import * as os from 'node:os';
import * as fs from 'node:fs';

export class TelemetryTool {
    public getMetrics() {
        // Prefer proc filesystem for high-accuracy Alpine Linux metrics
        let memInfo = '';
        try { memInfo = fs.readFileSync('/proc/meminfo', 'utf8'); } catch { memInfo = 'N/A'; }
        
        return {
            freemem: os.freemem(),
            totalmem: os.totalmem(),
            loadavg: os.loadavg(),
            procMemInfo: memInfo.substring(0, 200) // Truncated preview
        };
    }
}

```

### Target 2: `src/tools/service_manager.ts`

Manages system services via standardized shell abstractions.

```typescript
import { execSync } from 'node:child_process';

export class ServiceManager {
    public manage(service: string, action: 'start' | 'stop' | 'restart' | 'status') {
        try {
            return execSync(`rc-service ${service} ${action}`, { encoding: 'utf8' });
        } catch (e: any) {
            return `[ERROR] ${e.message}`;
        }
    }
}

```

### Target 3: `src/tools/network_audit.ts`

Scans for active network sockets.

```typescript
import { execSync } from 'node:child_process';

export class NetworkAudit {
    public scanSockets() {
        // Lists active TCP/UDP ports
        return execSync('netstat -tuln', { encoding: 'utf8' });
    }
}

```

---

## 4. Assumptions Section

* **Host Environment:** Assumes the container has `rc-service` and `netstat` (from `net-tools` or `busybox-extras`) installed.
* **Permission Level:** The `elo` user must be configured in `sudoers` with NOPASSWD for the specific commands (`rc-service`, `netstat`) to avoid blocking the AI workflow.

---

## 5. Definition of Done Checklist

* [ ] **Telemetry Accuracy:** Verify that the `TelemetryTool` correctly reads from `/proc/meminfo` and identifies host load.
* [ ] **Service Control:** Confirm that `ServiceManager` can toggle a dummy test service.
* [ ] **Network Audit:** Confirm `scanSockets` returns a formatted table of active ports.
* [ ] **Interface Consistency:** Ensure all tools expose clean output for the LLM to parse into the `technical_report`.