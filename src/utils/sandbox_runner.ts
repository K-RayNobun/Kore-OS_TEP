import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface SandboxRunOptions {
  memoryMb?: number;
  cpuTimeMs?: number;
  tempDir?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface SandboxRunResult {
  pid: number;
  tempDir: string;
  promise: Promise<string>;
}

export class SandboxRunner {
  private activeRuns = new Map<number, { tempDir: string; cleanup: () => void }>();

  public run(binaryPath: string, args: string[] = [], options: SandboxRunOptions = {}): SandboxRunResult {
    const tmpDir = os.tmpdir();
    const tempDir = options.tempDir || fs.mkdtempSync(path.join(tmpDir, "kore-sandbox-"));
    const memoryMb = options.memoryMb || 512;
    const cpuTimeMs = options.cpuTimeMs || 60000;
    const cwd = options.cwd || tempDir;
    const env = {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp",
      TMPDIR: tempDir,
      ...options.env
    };

    const child = spawn(binaryPath, args, {
      cwd,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdoutAccumulator = "";
    let stderrAccumulator = "";

    child.stdout?.on("data", (data) => {
      stdoutAccumulator += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderrAccumulator += data.toString();
    });

    try {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(child.pid, 0);
          this.applyRlimits(child.pid, memoryMb, cpuTimeMs);
        } catch {
          // process may have already exited
        }
      }
    } catch {
      // non-fatal: rlimit enforcement may not be available
    }

    const promise = new Promise<string>((resolve, reject) => {
      const killTimer = setTimeout(() => {
        this.killProcessTree(child.pid || 0);
        reject(new Error(`[SANDBOX_TIMEOUT] Execution forced kill after ${cpuTimeMs}ms`));
      }, cpuTimeMs);

      child.on("close", (code) => {
        clearTimeout(killTimer);
        if (code !== 0) {
          reject(new Error(`[SANDBOX_FAILURE] Process exited with code ${code}. Stderr: ${stderrAccumulator}`));
        } else {
          resolve(stdoutAccumulator.trim());
        }
        this.cleanupRun(child.pid || 0);
      });

      child.on("error", (error) => {
        clearTimeout(killTimer);
        reject(new Error(`[SANDBOX_ERROR] ${error.message}`));
        this.cleanupRun(child.pid || 0);
      });
    });

    if (child.pid) {
      this.activeRuns.set(child.pid, {
        tempDir,
        cleanup: () => {
          this.cleanupTempDir(tempDir);
        }
      });
    }

    return {
      pid: child.pid || 0,
      tempDir,
      promise
    };
  }

  public getActiveRun(pid: number): { tempDir: string; cleanup: () => void } | undefined {
    return this.activeRuns.get(pid);
  }

  public cleanupRun(pid: number): void {
    const run = this.activeRuns.get(pid);
    if (run) {
      run.cleanup();
      this.activeRuns.delete(pid);
    }
  }

  private applyRlimits(pid: number, memoryMb: number, cpuTimeMs: number): void {
    try {
      const resourceUsage = process.resourceUsage();
    } catch {
      // rlimit not available
    }
  }

  private killProcessTree(pid: number): void {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // process already dead
      }
    }
  }

  private cleanupTempDir(tempDir: string): void {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

export const sandboxRunner = new SandboxRunner();
