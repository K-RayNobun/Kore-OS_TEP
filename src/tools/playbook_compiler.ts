// src/tools/playbook_compiler.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import { ALLOWED_ROOTS, validateAndResolvePath, sanitizeIngestedText } from "../utils/security_guard.js";

const USER_DATA_DIR = "/home/elo/.local/share/browser-context";

export class PlaybookCompiler {
    private baseDir: string;

    constructor() {
        this.baseDir = process.env.KORE_REPORTS_PATH
            ? path.resolve(process.env.KORE_REPORTS_PATH)
            : path.join(process.cwd(), 'reports/missions');
        this.ensureDirectoryStructure();
    }

    private ensureDirectoryStructure() {
        ['technical', 'executive', 'scraped', 'reflection'].forEach(dir => {
            fsSync.mkdirSync(path.join(this.baseDir, dir), { recursive: true });
        });
    }

    public compileTechnicalReport(missionId: string, entry: string): string {
        const filePath = path.join(this.baseDir, 'technical', `mission_${missionId}_technical.md`);
        fsSync.appendFileSync(filePath, `[${new Date().toISOString()}] ${entry}\n`);
        return filePath;
    }

    public updateExecutiveReport(missionId: string, summary: string): string {
        const filePath = path.join(this.baseDir, 'executive', `mission_${missionId}_executive.md`);
        fsSync.writeFileSync(filePath, `# Executive Summary: ${missionId}\n\n${summary}`);
        return filePath;
    }

    public writeReflection(taskId: number, logic: string): string {
        const filePath = path.join(this.baseDir, 'reflection', `reflection_${taskId}.md`);
        fsSync.writeFileSync(filePath, `### Reflection Log\nTask: ${taskId}\nDate: ${new Date().toISOString()}\n\n${logic}`);
        return filePath;
    }
}

export function registerPlaybookCompilerTool(server: McpServer) {
  server.tool(
    "logTechnicalProgress",
    "Appends a timestamped entry to the mission technical report stream.",
    {
      missionId: z.string().describe("The mission identifier (e.g., 'M-101')"),
      entry: z.string().describe("The technical log entry to append")
    },
    async ({ missionId, entry }) => {
      try {
        const compiler = new PlaybookCompiler();
        const filePath = compiler.compileTechnicalReport(missionId, entry);
        return {
          content: [{ type: "text", text: `Logged technical progress for mission ${missionId} to ${filePath}.` }]
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Playbook compiler failure: ${error.message}` }]
        };
      }
    }
  );
}
