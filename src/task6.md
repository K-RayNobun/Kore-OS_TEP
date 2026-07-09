# Task Spec: Update #6 — ELF Asset Examiner & Secure Execution Sandbox (The Security/Risks Update)

## 1. Architecture Overview

Update #6 implements the core guardrails and verification pipelines required to download, inspect, and run arbitrary binaries safely. When a task requires inspecting or executing an external asset (such as an ELF binary), the engine passes the asset through a multi-tiered validation pipeline.

1. **Static Binary Inspection:** The `BinaryInspectorTool` runs native system tools (`file`, `ldd`, `strings`) to check architecture, shared library links, and look for known malicious strings (e.g., hidden network calls, shell commands).
2. **Security Isolation Policy:** The `SecurityGuard` runs path traversal and input sanitization routines to ensure the path doesn't escape allowed boundaries.
3. **Restricted Sandbox Execution:** If static validation passes, the binary is launched inside the `SandboxTool` using a hard timeout constraint, isolated directory context, and minimal path access.

```
 [ Untrusted ELF Asset ] ──► [ SecurityGuard: Path & Input Validation ]
                                      │
                                      ▼
                             [ BinaryInspector ] ── (Fails Strings/LDD Check) ──► [ Halt Execution ]
                                      │
                                      ▼ (Passes Static Profile)
                             [ Sandbox Execution ]
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼ (Exceeds 10s or Violates Allow-list)        ▼ (Executes Safely)
       [ Process Terminated / FAILED ]              [ Capture Stdout / DONE ]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Malicious Indicator Detection & Sandbox Abort

```txt
[SECURITY_GUARD] [2026-07-02T16:02:11Z] Resolving safe path for asset: /home/elo/workspace/downloads/untrusted_mod
[SECURITY_GUARD] [2026-07-02T16:02:11Z] Path successfully verified inside ALLOWED_ROOTS.
[INSPECTOR]      [2026-07-02T16:02:11Z] Running static signature scanning on untrusted_mod...
[INSPECTOR]      [2026-07-02T16:02:12Z] FILE output: ELF 64-bit LSB executable, x86-64, version 1 (SYSV)
[INSPECTOR]      [2026-07-02T16:02:12Z] STRINGS match found: "rm -rf /" pattern triggered.
[SECURITY_RISK]  [2026-07-02T16:02:12Z] CRITICAL: Static analysis failed. High-risk signature detected.
[ORCHESTRATOR]   [2026-07-02T16:02:12Z] Aborting sandbox launch. Task #89 status updated to FAILED.

```

### B. Terminal Trace: Secure Execution Timeout Trigger

```txt
[INSPECTOR]      [2026-07-02T16:05:00Z] Static verification passed for asset: /home/elo/workspace/bin/test_worker
[SANDBOX]        [2026-07-02T16:05:00Z] Initializing execution jail container. Timeout: 10000ms.
[SANDBOX]        [2026-07-02T16:05:10Z] WARNING: Sandbox execution timeout exceeded (10 seconds).
[SANDBOX]        [2026-07-02T16:05:10Z] Sending SIGKILL to process tree root (PID: 14205).
[ORCHESTRATOR]   [2026-07-02T16:05:11Z] Task #90 execution failed due to resource boundary timeout constraint.

```

---

## 3. Exact File Targets & Placements

### Target 1: Upgrading `src/utils/security_guard.ts`

Implement robust path validation and deep threat string inspection arrays to flag suspicious embedded strings.

```typescript
import * as path from 'node:path';

export class SecurityGuard {
    private allowedRoots: string[] = ['/home/elo/workspace', '/home/elo/data', '/tmp'];
    private bannedPatterns: RegExp[] = [
        /rm\s+-rf/,
        /\/etc\/passwd/,
        /curl\s+.*\|\s*sh/,
        /nc\s+-e/,
        /wget\s+/
    ];

    public validateAndResolvePath(inputPath: string): string {
        const resolved = path.resolve(inputPath);
        const isAllowed = this.allowedRoots.some(root => resolved.startsWith(root));
        
        if (!isAllowed) {
            throw new Error(`[SECURITY_VIOLATION] Access denied for path outside boundaries: ${resolved}`);
        }
        return resolved;
    }

    public scanContentRisk(content: string): { safe: boolean; reason?: string } {
        for (const pattern of this.bannedPatterns) {
            if (pattern.test(content)) {
                return { safe: false, reason: `Banned command pattern detected: ${pattern.toString()}` };
            }
        }
        return { safe: true };
    }
}

```

### Target 2: Implementing Static Inspection in `src/tools/binary_inspector.ts`

Build an inspector component that extracts file signatures and shared library links via native system tools.

```typescript
import { execSync } from 'node:child_process';
import { SecurityGuard } from '../utils/security_guard';

export class BinaryInspector {
    private guard = new SecurityGuard();

    public inspectBinary(targetPath: string) {
        const safePath = this.guard.validateAndResolvePath(targetPath);
        
        try {
            const fileMeta = execSync(`file ${safePath}`, { encoding: 'utf8' });
            const dependencies = execSync(`ldd ${safePath} 2>&1`, { encoding: 'utf8' });
            const stringDump = execSync(`strings ${safePath}`, { encoding: 'utf8' });

            // Check strings for malicious indicators
            const scanResult = this.guard.scanContentRisk(stringDump);
            if (!scanResult.safe) {
                return {
                    status: 'REJECTED',
                    reason: scanResult.reason,
                    meta: fileMeta.trim()
                };
            }

            return {
                status: 'PASSED',
                meta: fileMeta.trim(),
                sharedLibraries: dependencies.split('\n').map(l => l.trim()).filter(Boolean)
            };
        } catch (error: any) {
            return {
                status: 'ERROR',
                reason: `Inspection execution failed: ${error.message}`
            };
        }
    }
}

export function registerBinaryInspectorTool(server: any) {
    const inspector = new BinaryInspector();
    // Connect tool definitions to your standard MCP server instances here
}

```

### Target 3: Implementing Execution Controls in `src/tools/sandbox_tool.ts`

Build a secure process wrapper tool with strict timeout constraints to run validated files safely.

```typescript
import { spawn } from 'node:child_process';
import { SecurityGuard } from '../utils/security_guard';

export class SecureSandbox {
    private guard = new SecurityGuard();

    public runIsolatedBinary(binaryPath: string, args: string[] = [], timeoutMs = 10000): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const safePath = this.guard.validateAndResolvePath(binaryPath);
                
                const processInstance = spawn(safePath, args, {
                    cwd: '/tmp',
                    env: { PATH: '/usr/bin:/bin' }, // Stripped environment
                    shell: false
                });

                let stdoutAccumulator = '';
                let stderrAccumulator = '';

                const killTimer = setTimeout(() => {
                    processInstance.kill('SIGKILL');
                    reject(new Error(`[SANDBOX_TIMEOUT] Execution forced kill after ${timeoutMs}ms`));
                }, timeoutMs);

                processInstance.stdout.on('data', (data) => { stdoutAccumulator += data.toString(); });
                processInstance.stderr.on('data', (data) => { stderrAccumulator += data.toString(); });

                processInstance.on('close', (code) => {
                    clearTimeout(killTimer);
                    if (code !== 0) {
                        reject(new Error(`[SANDBOX_FAILURE] Process exited with code ${code}. Stderr: ${stderrAccumulator}`));
                    } else {
                        resolve(stdoutAccumulator.trim());
                    }
                });

            } catch (error) {
                reject(error);
            }
        });
    }
}

export function registerSandboxTool(server: any) {
    const sandbox = new SecureSandbox();
    // Connect secure execution interface descriptors to MCP runtime here
}

```

---

## 4. Assumptions Section

* **System Binary Dependencies:** The host container OS environment (Node 20 Alpine setup) must have standard testing packages installed (`file`, `ldd`, `binutils` for strings). If running in a stripped minimal environment, `ldd` and `strings` executions will fallback to graceful shell exceptions caught by the code.
* **Environment Variable Integrity:** Safe paths match current production directories. Path validation relies directly on `path.resolve` to flatten complex paths and prevent traversal strategies like `../..`.

---

## 5. Definition of Done Checklist

* [ ] **Path Traversal Guard Verification:** Triggering binary checks or executions against path layouts outside of permitted roots (e.g., `/etc/shadow` or `../../secret`) correctly throws explicit security path exceptions.
* [ ] **Threat String Flagging Check:** Parsing a dummy binary that returns blacklisted commands like `rm -rf /` via its strings stream successfully aborts execution before the sandbox stage.
* [ ] **Execution Timeout Verification:** Running a binary that blocks the process thread via an infinite loop correctly drops the tracking context and terminates the process branch at exactly 10,000ms.
* [ ] **Standard Interface Preservation:** Validates that refactoring these tools preserves standard export signatures so `src/index.ts` can register them with the MCP loop without issues.