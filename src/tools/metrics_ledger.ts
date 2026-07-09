import Database from "better-sqlite3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizeIngestedText } from "../utils/security_guard.js";
import * as path from "node:path";
import * as fs from "node:fs";

export interface GitTelemetryPayload {
    taskId: number;
    branchName: string;
    commitHash: string;
    commitMessage: string;
    linesAdded: number;
    linesDeleted: number;
}

function resolveMetricsDbPath(): string {
    const configured = process.env.KORE_MARKETING_METRICS_DB_PATH;
    if (configured && configured.trim()) {
        const dir = path.dirname(configured);
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch {}
        return configured;
    }
    const fallback = path.join(process.cwd(), "data", "marketing_metrics.db");
    try {
        fs.mkdirSync(path.dirname(fallback), { recursive: true });
    } catch {}
    return fallback;
}

export class MetricsLedger {
    private db: Database.Database;

    constructor() {
        const dbPath = resolveMetricsDbPath();
        this.db = new Database(dbPath);
        this.initializeSchema();
    }

    public getDb(): Database.Database {
        return this.db;
    }

    private initializeSchema() {
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                performance_score REAL,
                last_git_milestone TEXT
            )
        `).run();
        
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS git_pipeline_telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id INTEGER NOT NULL,
                branch_name TEXT NOT NULL,
                commit_hash TEXT NOT NULL UNIQUE,
                commit_message TEXT NOT NULL,
                lines_added INTEGER DEFAULT 0,
                lines_deleted INTEGER DEFAULT 0,
                recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `).run();

        const columns = this.db.prepare("PRAGMA table_info(git_pipeline_telemetry)").all() as { name: string }[];
        const hasCampaignId = columns.some((col) => col.name === "campaign_id");
        const hasScore = columns.some((col) => col.name === "score");
        if (!hasCampaignId) {
            this.db.prepare("ALTER TABLE git_pipeline_telemetry ADD COLUMN campaign_id TEXT;").run();
        }
        if (!hasScore) {
            this.db.prepare("ALTER TABLE git_pipeline_telemetry ADD COLUMN score REAL;").run();
        }
    }

    public recordMilestone(campaignId: string, gitHash: string, score: number) {
        const stmt = this.db.prepare(`
            INSERT INTO git_pipeline_telemetry (campaign_id, git_hash, score) 
            VALUES (?, ?, ?)
        `);
        return stmt.run(campaignId, gitHash, score);
    }

    public logCampaignMetric(id: string, score: number): void {
        const stmt = this.db.prepare(`INSERT OR REPLACE INTO campaigns (id, performance_score) VALUES (?, ?)`);
        stmt.run(id, score);
    }

    public logGitMilestone(payload: GitTelemetryPayload): void {
        const stmt = this.db.prepare(`
            INSERT INTO git_pipeline_telemetry 
            (task_id, branch_name, commit_hash, commit_message, lines_added, lines_deleted)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            payload.taskId,
            payload.branchName,
            payload.commitHash,
            payload.commitMessage,
            payload.linesAdded,
            payload.linesDeleted
        );
        console.log(`[METRICS_LEDGER] Successfully logged commit pipeline telemetry for hash: ${payload.commitHash}`);
    }
}

export function registerMetricsLedgerTool(server: McpServer) {
    const ledger = new MetricsLedger();
    
    server.tool(
        "log_campaign_metrics",
        "Persists campaign performance data into the local SQLite analytics ledger.",
        {
          project: z.string(),
          impressions: z.number(),
          clicks: z.number(),
          conversions: z.number()
        },
        async ({ project, impressions, clicks, conversions }) => {
          const cleanProjectName = sanitizeIngestedText(project).replace(/['";\-]/g, "");
          const score = impressions > 0 ? (clicks / impressions) * 100 : 0;
          
          const stmt = ledger.getDb().prepare(
            "INSERT OR REPLACE INTO campaigns (id, performance_score, last_git_milestone) VALUES (?, ?, ?)"
          );
          stmt.run(cleanProjectName, score, new Date().toISOString());
    
          return {
            content: [{ type: "text", text: `Metrics logged for ${cleanProjectName} (CTR: ${score.toFixed(2)}%).` }]
          };
        }
      );
}
