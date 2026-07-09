# Task Spec: Update #8 — Core Security Perimeter & Command Validation Defense

## 1. Architecture Overview

Update #8 hardens the Kore OS environment by implementing the fundamental "Security Guardrail" layer. This layer prevents path traversal attacks and arbitrary command injection by strictly white-listing file system access and sanitizing input arguments before they ever reach the shell or sensitive system tools.

1. **Path Normalization:** The `SecurityGuard` prevents access to unauthorized system files (e.g., `/etc/shadow`) by resolving paths to absolute roots and enforcing an `ALLOWED_ROOTS` boundary.
2. **Command Validation:** The `CommandValidator` acts as an immutable filter for tools like FFmpeg. It blocks meta-characters (`;`, `&`, `|`) and unauthorized flags, ensuring that only "known-good" command structures are executed.
3. **Content Risk Scanning:** Scans text-based inputs for dangerous patterns (e.g., shell fork-bombs, credential exfiltration attempts) before passing them to the LLM or execution engine.

```
[Untrusted Input] ──► [SecurityGuard] ── (Deny) ──► [Halt Execution]
                            │
                            ▼ (Passes)
                      [CommandValidator] ──► [Whitelist Check] ──► [Execution]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Path Traversal Attempt Blocked

```txt
[SECURITY_GUARD] [2026-07-02T16:08:12Z] Attempted path: /home/elo/workspace/../../etc/passwd
[SECURITY_GUARD] [2026-07-02T16:08:12Z] Resolution: /etc/passwd
[SECURITY_VIOLATION] [2026-07-02T16:08:12Z] Access denied: Path outside of /home/elo/workspace boundaries.
[ORCHESTRATOR]   [2026-07-02T16:08:12Z] Task aborted. Security alert logged to reflection artifact.

```

### B. Terminal Trace: Malicious Command Injection Blocked

```txt
[CMD_VALIDATOR]  [2026-07-02T16:09:45Z] Validating FFmpeg arguments: ["-i", "input.mp4", ";", "rm", "-rf", "/"]
[CMD_VALIDATOR]  [2026-07-02T16:09:45Z] WARNING: Prohibited meta-characters detected: [";"].
[ORCHESTRATOR]   [2026-07-02T16:09:45Z] Argument sanitization failed. Operation denied.

```

---

## 3. Exact File Targets & Placements

### Target 1: Hardening `src/utils/security_guard.ts`

This enforces strict boundaries for all file-system operations.

```typescript
import * as path from 'node:path';

export class SecurityGuard {
    private readonly ALLOWED_ROOTS = [
        path.resolve('/home/elo/workspace'),
        path.resolve('/home/elo/data'),
        path.resolve('/tmp')
    ];

    public validateAndResolvePath(inputPath: string): string {
        const resolved = path.resolve(inputPath);
        if (!this.ALLOWED_ROOTS.some(root => resolved.startsWith(root))) {
            throw new Error(`[SECURITY_VIOLATION] Access denied: ${resolved}`);
        }
        return resolved;
    }

    public scanContentRisk(content: string): boolean {
        const BANNED_PATTERNS = [/rm\s+-rf/, /nc\s+-e/, /wget\s+/, /curl\s+.*\|/];
        return BANNED_PATTERNS.every(pattern => !pattern.test(content));
    }
}

```

### Target 2: Creating `src/utils/command_validator.ts`

This isolates the validation logic for external tool calls (like FFmpeg).

```typescript
export class CommandValidator {
    // Only permit specific safe flags for asset optimization
    private static readonly ALLOWED_FFMPEG_FLAGS = new Set([
        '-i', '-vcodec', '-acodec', '-preset', '-crf', '-y'
    ]);

    public static validateFFmpegArgs(args: string[]): boolean {
        // Reject shell meta-characters
        const metaPattern = /[;&|><$]/;
        if (args.some(arg => metaPattern.test(arg))) return false;

        // Ensure every flag is in our allowed list
        return args.every(arg => 
            !arg.startsWith('-') || this.ALLOWED_FFMPEG_FLAGS.has(arg)
        );
    }
}

```

---

## 4. Assumptions Section

* **Path Normalization:** Assumes `path.resolve` correctly handles symbolic link resolution within the container to prevent bypasses.
* **Tool Configuration:** The `CommandValidator` profiles are additive; new tools added later will require their own specific validation maps in this utility.

---

## 5. Definition of Done Checklist

* [ ] **Path Guard Test:** Verify that `../` attempts outside `workspace` trigger the `SECURITY_VIOLATION` exception.
* [ ] **Command Sanitization:** Verify `validateFFmpegArgs` returns `false` when input contains `;`, `&&`, or illegal flags.
* [ ] **Integration:** Ensure both utilities are exported and ready to be consumed by `AssetOptimizer` and `BinaryInspector` in later steps.

---

**Does this implementation plan for Step 2 meet your requirements, or should we adjust the security string/flag lists?**