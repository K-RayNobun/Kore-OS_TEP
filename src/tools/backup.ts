// src/tools/backup.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const BACKUP_DIR = "/var/backups/elo-tep";

export class BackupTool {
    public createSnapshot(missionId: string): string {
        const target = `${BACKUP_DIR}/${missionId}_${Date.now()}.tar.gz`;
        execSync(`tar -czf ${target} /home/elo/workspace`);
        return target;
    }
}

export function registerBackupTool(server: McpServer) {
  server.tool(
    "stage_secure_backup",
    "Creates a transactional .tar.gz snapshot recovery point of a targeted project directory before structural updates are applied.",
    {
      sourcePath: z.string().describe("The absolute path of the directory to back up (e.g., '/home/elo/workspace')"),
      backupName: z.string().describe("A descriptive name for the recovery context (e.g., 'pre-patch-hilux-listing')")
    },
    async ({ sourcePath, backupName }) => {
      try {
        const resolvedSource = path.resolve(sourcePath);
        
        // Clean the backup string to prevent command injection characters or directory traversal paths
        const safeName = backupName.replace(/[^a-zA-Z0-9_-]/g, "");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const archiveFilename = `${safeName}_${timestamp}.tar.gz`;
        const fullBackupPath = path.join(BACKUP_DIR, archiveFilename);

        // Ensure the backup storage directory exists securely
        await fs.mkdir(BACKUP_DIR, { recursive: true });

        // Grab the base directory name and its parent path to ensure tar doesn't include massive absolute structures
        const parentDir = path.dirname(resolvedSource);
        const targetDirName = path.basename(resolvedSource);

        // Run Alpine's native tar program to cleanly compress the filesystem slice
        await execFileAsync("tar", ["-czf", fullBackupPath, "-C", parentDir, targetDirName], { timeout: 15000 });

        const stats = await fs.stat(fullBackupPath);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "BACKUP_STAGED_SUCCESSFULLY",
              recovery_point: {
                archive_identifier: archiveFilename,
                stored_location: fullBackupPath,
                source_protected: resolvedSource,
                archive_size_bytes: stats.size,
                created_at: new Date().toISOString()
              },
              rollback_hint: `To restore this snapshot, run 'tar -xzf ${fullBackupPath} -C ${parentDir}'`
            }, null, 2)
          }]
        };

      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Backup stabilization crashed: ${error.message}` }]
        };
      }
    }
  );
}