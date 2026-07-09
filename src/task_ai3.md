# Task Spec: Update #9 — Network & Session Perimeter Hardening

## 1. Architecture Overview

Update #9 establishes the final layer of environmental isolation. Since the AI Admin interacts with external web resources via the browser and API services, it must operate within a strict "no-egress" zone for sensitive infrastructure and a "clean-room" policy for browser data.

1. **SSRF/Network Guard:** Prevents the AI from using its browser or network tools to scan the host’s local services (e.g., `localhost:3000` or internal Docker network gateway) by enforcing a strict IP-range allow-list.
2. **Session Sovereignty:** Ensures all web sessions (cookies, local storage, hashes) are pinned to specific isolated directories. This prevents session leakage between different AI "missions" and ensures we can `chmod 700` these directories to lock them away from other processes.
3. **Concurrency Limiter:** Prevents the AI from overwhelming the system resources (or its own network bandwidth) by throttling parallel browser or file-processing tasks.

```
[Browser/Network Tool] ──► [NetworkGuard] ── (Block Private/Loopback)
                               │
                               ▼
                        [SessionManager] ──► [Isolated /home/elo/.../context]
                               │
                               ▼
                        [ConcurrencyLimiter] ──► [Resource Budget]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: SSRF Guard Intervention

```txt
[NET_GUARD] [2026-07-02T16:15:20Z] Inspection: Browser requesting http://127.0.0.1:3000/internal_api
[NET_GUARD] [2026-07-02T16:15:20Z] CRITICAL: SSRF violation attempt. Private/Loopback range detected.
[ORCHESTRATOR] [2026-07-02T16:15:20Z] Network request rejected. Task #105 status: FAILED.

```

---

## 3. Exact File Targets & Placements

### Target 1: Creating `src/utils/network_guard.ts`

This enforces the SSRF perimeter by blocking any non-public/non-global IP address.

```typescript
export class NetworkGuard {
    // Regex for private, loopback, and local link IPs
    private readonly PRIVATE_IP_PATTERN = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|::1$|fc00::)/;

    public validateURL(url: string): boolean {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
            // In a production scenario, resolve hostname to IP to check against regex
            if (this.PRIVATE_IP_PATTERN.test(parsed.hostname)) return false;
            return true;
        } catch {
            return false;
        }
    }
}

```

### Target 2: Creating `src/utils/session_manager.ts`

Manages unique, hardened directories for each AI session.

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';

export class SessionManager {
    private readonly BASE_PATH = '/home/elo/.local/share/browser-context';

    public getSessionDir(missionId: string): string {
        const dir = path.join(this.BASE_PATH, missionId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        return dir;
    }
}

```

### Target 3: Creating `src/utils/task_queue.ts`

A generic concurrency limiter to prevent resource exhaustion during automation.

```typescript
export class ConcurrencyLimiter {
    private activeCount = 0;
    private queue: (() => void)[] = [];

    constructor(private maxConcurrency: number) {}

    public async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.activeCount >= this.maxConcurrency) {
            await new Promise<void>(resolve => this.queue.push(resolve));
        }
        this.activeCount++;
        try {
            return await fn();
        } finally {
            this.activeCount--;
            if (this.queue.length > 0) this.queue.shift()!();
        }
    }
}

```

---

## 4. Assumptions Section

* **Docker Environment:** Assumes the environment has `/home/elo` persistent and writable by the `elo` user.
* **DNS Resolution:** Note that `NetworkGuard` as implemented checks the hostname; in future iterations, we should use a custom `http.Agent` to perform the IP-check at the socket level to prevent DNS rebinding attacks.

---

## 5. Definition of Done Checklist

* [ ] **SSRF Guard:** Verify that requests to `localhost` or internal IPs are rejected by `validateURL`.
* [ ] **Session Pathing:** Verify that `SessionManager` creates directories with `0o700` permissions.
* [ ] **Concurrency:** Verify that the `ConcurrencyLimiter` successfully pauses calls when the `maxConcurrency` threshold is reached.

