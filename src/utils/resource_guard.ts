import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { sandboxRunner } from "./sandbox_runner.js";

const TMP_PREFIX = "/tmp/kore-";
const TMP_TTL_MS = 60 * 60 * 1000;

export class ResourceGuard {
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startPeriodicCleanup();
  }

  public startPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupTempFiles();
      this.rotateExecutionLogs();
      this.cleanupOrphanedSandboxDirs();
    }, 5 * 60 * 1000);
  }

  public stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  public cleanupTaskFiles(taskId: number, tempPaths: string[] = []): void {
    const pathsToClean = [
      ...tempPaths,
      `${TMP_PREFIX}task-${taskId}-*`,
      `${TMP_PREFIX}browser-${taskId}-*`
    ];
    for (const pattern of pathsToClean) {
      try {
        if (pattern.includes("*")) {
          const matches = execSync(`ls -d ${pattern} 2>/dev/null || true`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
          for (const match of matches) {
            fs.rmSync(match, { recursive: true, force: true });
          }
        } else {
          fs.rmSync(pattern, { recursive: true, force: true });
        }
      } catch {
        // ignore cleanup errors
      }
    }
  }

  public trackOpenHandle(missionId: string, handle: any): void {
    // Placeholder for file handle tracking
  }

  public releaseHandles(missionId: string): void {
    // Placeholder for releasing tracked handles
  }

  public getResourceSnapshot(): { tmpFileCount: number; openHandles: number; sandboxRuns: number } {
    let tmpFileCount = 0;
    try {
      const entries = fs.readdirSync("/tmp");
      tmpFileCount = entries.filter((e) => e.startsWith("kore-")).length;
    } catch {
      tmpFileCount = 0;
    }
    return {
      tmpFileCount,
      openHandles: 0,
      sandboxRuns: sandboxRunner ? 0 : 0
    };
  }

  public cleanupOrphanedSandboxDirs(): void {
    try {
      const entries = fs.readdirSync("/tmp");
      const cutoff = Date.now() - TMP_TTL_MS;
      for (const entry of entries) {
        if (!entry.startsWith("kore-sandbox-")) continue;
        const fullPath = path.join("/tmp", entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < cutoff) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {
          // ignore individual cleanup errors
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  private cleanupTempFiles(): void {
    try {
      const entries = fs.readdirSync("/tmp");
      const cutoff = Date.now() - TMP_TTL_MS;
      for (const entry of entries) {
        if (!entry.startsWith("kore-")) continue;
        const fullPath = path.join("/tmp", entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs < cutoff) {
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
        } catch {
          // ignore individual cleanup errors
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  private rotateExecutionLogs(): void {
    try {
      const { archiveOldExecutionLogs } = require("./database_helper.js");
      const deleted = archiveOldExecutionLogs(30);
      if (deleted > 0) {
        console.error("[RESOURCE_GUARD] Archived old execution logs", { deleted });
      }
    } catch {
      // ignore rotation errors
    }
  }
}
