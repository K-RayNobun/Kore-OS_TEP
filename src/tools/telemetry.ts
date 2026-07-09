// src/tools/telemetry.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import os from "node:os";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import crypto from "node:crypto";

// Memory variable to store the hash of our critical paths between tool calls
let previousStateHash = "";

/**
 * Attempts to read memory directly from Alpine's /proc virtual filesystem 
 * for zero-overhead execution. Falls back to standard node:os if on Windows/Mac.
 */
async function getDirectMemoryStats() {
  try {
    const meminfo = await fs.readFile("/proc/meminfo", "utf8");
    const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
    const freeMatch = meminfo.match(/MemFree:\s+(\d+)/);
    
    if (totalMatch && freeMatch) {
      const totalBytes = parseInt(totalMatch[1]!) * 1024;
      const freeBytes = parseInt(freeMatch[1]!) * 1024;
      return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
    }
    throw new Error("Regex mismatch on /proc/meminfo");
  } catch {
    // Fallback for local development outside of Alpine/Linux
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
  }
}

/**
 * Generates a quick cryptographic hash of a directory's shallow state
 * to let the AI know if files were added or removed since the last check.
 */
async function getDirectoryStateHash(targetPath: string): Promise<string> {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    // Create a deterministic string of file names and types
    const stateString = entries
      .map(e => `${e.isDirectory() ? 'D' : 'F'}:${e.name}`)
      .sort()
      .join("|");
    
    return crypto.createHash("sha256").update(stateString).digest("hex");
  } catch {
    return "unreadable_path";
  }
}

export class TelemetryTool {
    public getMetrics() {
        let memInfo = '';
        try { memInfo = fsSync.readFileSync('/proc/meminfo', 'utf8'); } catch { memInfo = 'N/A'; }
        
        return {
            freemem: os.freemem(),
            totalmem: os.totalmem(),
            loadavg: os.loadavg(),
            procMemInfo: memInfo.substring(0, 200)
        };
    }
}

export function registerTelemetryTool(server: McpServer) {
  server.tool(
    "get_system_telemetry",
    "Extracts real-time CPU load, memory utilization, and differential system state changes.",
    {},
    async () => {
      try {
        const memStats = await getDirectMemoryStats();
        const memUsagePercentage = ((memStats.usedBytes / memStats.totalBytes) * 100).toFixed(2);
        const loadAvg = os.loadavg();

        // Target your core Alpine workspace path (fallback to cwd for local dev)
        const targetPath = process.env.NODE_ENV === "production" ? "/home/elo" : process.cwd();
        
        // Check for state mutations
        const currentStateHash = await getDirectoryStateHash(targetPath);
        const hasStateChanged = previousStateHash !== "" && previousStateHash !== currentStateHash;
        previousStateHash = currentStateHash;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                timestamp: new Date().toISOString(),
                os_metrics: {
                  uptime_seconds: os.uptime(),
                  cpu_load_1m: loadAvg[0],
                  memory_usage: `${memUsagePercentage}%`,
                },
                workspace_state: {
                  path: targetPath,
                  state_hash: currentStateHash.substring(0, 8), // Short hash for AI token efficiency
                  has_mutated_since_last_check: hasStateChanged
                }
              }, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Telemetry failure: ${error.message}` }]
        };
      }
    }
  );
}