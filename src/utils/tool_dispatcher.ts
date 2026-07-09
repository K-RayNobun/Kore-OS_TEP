import { z } from "zod";
import { TelemetryTool } from "../tools/telemetry.js";
import { SecureSandbox } from "../tools/sandbox.js";
import { PatchTool } from "../tools/patch.js";
import { ServiceManager } from "../tools/service_manager.js";
import { NetworkAudit } from "../tools/network_audit.js";
import { BackupTool } from "../tools/backup.js";
import { BinaryInspector } from "../tools/binary_inspector.js";
import { AssetOptimizer } from "../tools/asset_optimizer.js";
import { PlaybookCompiler } from "../tools/playbook_compiler.js";
import { BrowserAutomator } from "../tools/browser_automator.js";
import { MetricsLedger } from "../tools/metrics_ledger.js";

export type ToolAction =
  | "GET_SYSTEM_TELEMETRY"
  | "EXECUTE_SANDBOX_COMMAND"
  | "PATCH_FILE_DIFF"
  | "MANAGE_BACKGROUND_SERVICE"
  | "AUDIT_NETWORK_SOCKETS"
  | "STAGE_SECURE_BACKUP"
  | "INSPECT_BINARY_METADATA"
  | "OPTIMIZE_MARKETING_ASSETS"
  | "WRITE_TECHNICAL_REPORT"
  | "WRITE_EXECUTIVE_REPORT"
  | "WRITE_REFLECTION"
  | "EXECUTE_BROWSER_FLOW"
  | "LOG_CAMPAIGN_METRICS"
  | "RECORD_GIT_MILESTONE"
  | "REFORMULATE_PROMPT"
  | "SYS_INSPECT";

const telemetrySchema = z.object({
  action: z.literal("GET_SYSTEM_TELEMETRY")
});

const sandboxSchema = z.object({
  action: z.literal("EXECUTE_SANDBOX_COMMAND"),
  binaryPath: z.string(),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().default(10000)
});

const patchSchema = z.object({
  action: z.literal("PATCH_FILE_DIFF"),
  targetPath: z.string(),
  searchBlock: z.string(),
  replacementBlock: z.string()
});

const serviceSchema = z.object({
  action: z.literal("MANAGE_BACKGROUND_SERVICE"),
  target: z.string(),
  action_type: z.enum(["status", "start", "stop", "restart", "kill"]),
  isSystemDaemon: z.boolean().default(false)
});

const networkSchema = z.object({
  action: z.literal("AUDIT_NETWORK_SOCKETS"),
  protocol: z.enum(["all", "tcp", "udp"]).default("all"),
  listeningOnly: z.boolean().default(true)
});

const backupSchema = z.object({
  action: z.literal("STAGE_SECURE_BACKUP"),
  sourcePath: z.string(),
  backupName: z.string()
});

const binarySchema = z.object({
  action: z.literal("INSPECT_BINARY_METADATA"),
  targetFilePath: z.string()
});

const assetSchema = z.object({
  action: z.literal("OPTIMIZE_MARKETING_ASSETS"),
  inputPath: z.string(),
  platform: z.enum(["instagram_reels", "facebook_feed", "linkedin_document", "standard_image"]),
  outputDirectory: z.string().default("/home/elo/workspace/optimized_out")
});

const techReportSchema = z.object({
  action: z.literal("WRITE_TECHNICAL_REPORT"),
  missionId: z.string().optional(),
  entry: z.string().optional()
});

const execReportSchema = z.object({
  action: z.literal("WRITE_EXECUTIVE_REPORT"),
  missionId: z.string().optional(),
  summary: z.string().optional()
});

const reflectionSchema = z.object({
  action: z.literal("WRITE_REFLECTION"),
  taskId: z.number().optional(),
  logic: z.string().optional()
});

const browserSchema = z.object({
  action: z.literal("EXECUTE_BROWSER_FLOW"),
  url: z.string().url(),
  taskDescription: z.string(),
  sessionProfile: z.string(),
  screenshotName: z.string().optional()
});

const metricsSchema = z.object({
  action: z.literal("LOG_CAMPAIGN_METRICS"),
  project: z.string(),
  impressions: z.number(),
  clicks: z.number(),
  conversions: z.number()
});

const milestoneSchema = z.object({
  action: z.literal("RECORD_GIT_MILESTONE"),
  campaignId: z.string(),
  gitHash: z.string(),
  score: z.number()
});

const reformulateSchema = z.object({
  action: z.literal("REFORMULATE_PROMPT"),
  rawPrompt: z.string().min(1)
});

const sysInspectSchema = z.object({
  action: z.literal("SYS_INSPECT"),
  mode: z.enum(["skeleton", "grep_logs", "read_db", "append"]),
  targetPath: z.string().optional(),
  pattern: z.string().optional(),
  query: z.string().optional(),
  params: z.array(z.unknown()).optional(),
  taskId: z.number().optional(),
  breadcrumb: z.string().optional(),
  missionId: z.string().optional()
});

export interface ToolResult {
  status: string;
  output?: unknown;
  error?: string;
  executionTimeMs: number;
  validation_error?: string;
  schema_used?: string;
}

const schemaMap: Record<string, { schema: z.ZodTypeAny; name: string }> = {
  "GET_SYSTEM_TELEMETRY": { schema: telemetrySchema, name: "telemetrySchema" },
  "EXECUTE_SANDBOX_COMMAND": { schema: sandboxSchema, name: "sandboxSchema" },
  "PATCH_FILE_DIFF": { schema: patchSchema, name: "patchSchema" },
  "MANAGE_BACKGROUND_SERVICE": { schema: serviceSchema, name: "serviceSchema" },
  "AUDIT_NETWORK_SOCKETS": { schema: networkSchema, name: "networkSchema" },
  "STAGE_SECURE_BACKUP": { schema: backupSchema, name: "backupSchema" },
  "INSPECT_BINARY_METADATA": { schema: binarySchema, name: "binarySchema" },
  "OPTIMIZE_MARKETING_ASSETS": { schema: assetSchema, name: "assetSchema" },
  "WRITE_TECHNICAL_REPORT": { schema: techReportSchema, name: "techReportSchema" },
  "WRITE_EXECUTIVE_REPORT": { schema: execReportSchema, name: "execReportSchema" },
  "WRITE_REFLECTION": { schema: reflectionSchema, name: "reflectionSchema" },
  "EXECUTE_BROWSER_FLOW": { schema: browserSchema, name: "browserSchema" },
  "LOG_CAMPAIGN_METRICS": { schema: metricsSchema, name: "metricsSchema" },
  "RECORD_GIT_MILESTONE": { schema: milestoneSchema, name: "milestoneSchema" },
  "REFORMULATE_PROMPT": { schema: reformulateSchema, name: "reformulateSchema" },
  "SYS_INSPECT": { schema: sysInspectSchema, name: "sysInspectSchema" }
};

const toolInstances = {
  telemetry: new TelemetryTool(),
  sandbox: new SecureSandbox(),
  patch: new PatchTool(),
  service: new ServiceManager(),
  network: new NetworkAudit(),
  backup: new BackupTool(),
  binary: new BinaryInspector(),
  asset: new AssetOptimizer(),
  playbook: new PlaybookCompiler(),
  browser: new BrowserAutomator(),
  metrics: new MetricsLedger()
};

async function getReformulator() {
  return new (await import("./prompt_reformulator.js")).PromptReformulator();
}

export async function dispatchTool(action: ToolAction, rawParams: unknown): Promise<ToolResult> {
  const startTime = Date.now();
  const schemaEntry = schemaMap[action];

  if (!schemaEntry) {
    return {
      status: "ERROR",
      error: `Unknown action: ${action}`,
      executionTimeMs: Date.now() - startTime,
      validation_error: `No schema mapped for action: ${action}`,
      schema_used: "unknown"
    };
  }

  let validated: Record<string, unknown>;
  try {
    const parsed = schemaEntry.schema.parse({ ...(rawParams as Record<string, unknown>), action });
    validated = parsed as Record<string, unknown>;
  } catch (error: any) {
    return {
      status: "ERROR",
      error: `Parameter validation failed: ${error.message || String(error)}`,
      executionTimeMs: Date.now() - startTime,
      validation_error: error.message || String(error),
      schema_used: schemaEntry.name
    };
  }

  const v = validated as any;
  try {
    switch (v.action) {
      case "GET_SYSTEM_TELEMETRY": {
        const result = toolInstances.telemetry.getMetrics();
        return {
          status: "SUCCESS",
          output: result,
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "EXECUTE_SANDBOX_COMMAND": {
        const output = await toolInstances.sandbox.runIsolatedBinary(
          v.binaryPath,
          v.args,
          v.timeoutMs
        );
        return {
          status: "SUCCESS",
          output: { binaryPath: v.binaryPath, output },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "PATCH_FILE_DIFF": {
        const applied = toolInstances.patch.applyPatch(
          v.targetPath,
          v.searchBlock,
          v.replacementBlock
        );
        return {
          status: applied ? "SUCCESS" : "FAILED",
          output: { targetPath: v.targetPath, applied },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "MANAGE_BACKGROUND_SERVICE": {
        const output = toolInstances.service.manage(v.target, v.action_type);
        return {
          status: "SUCCESS",
          output: { target: v.target, action: v.action_type, output },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "AUDIT_NETWORK_SOCKETS": {
        const output = toolInstances.network.scanSockets();
        return {
          status: "SUCCESS",
          output: { protocol: v.protocol, listeningOnly: v.listeningOnly, output },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "STAGE_SECURE_BACKUP": {
        const target = toolInstances.backup.createSnapshot(v.backupName);
        return {
          status: "SUCCESS",
          output: { backupPath: target, sourcePath: v.sourcePath },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "INSPECT_BINARY_METADATA": {
        const result = toolInstances.binary.inspectBinary(v.targetFilePath);
        return {
          status: result.status === "PASSED" ? "SUCCESS" : result.status === "REJECTED" ? "FAILED" : "ERROR",
          output: result,
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "OPTIMIZE_MARKETING_ASSETS": {
        toolInstances.asset.optimize(v.inputPath, v.outputDirectory);
        return {
          status: "SUCCESS",
          output: { inputPath: v.inputPath, platform: v.platform },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "WRITE_TECHNICAL_REPORT": {
        const techPath = toolInstances.playbook.compileTechnicalReport(v.missionId || "unknown", v.entry || "Agent step logged without explicit entry.");
        return {
          status: "SUCCESS",
          output: { missionId: v.missionId || "unknown", path: techPath },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "WRITE_EXECUTIVE_REPORT": {
        const execPath = toolInstances.playbook.updateExecutiveReport(v.missionId || "unknown", v.summary || "Agent step logged without explicit summary.");
        return {
          status: "SUCCESS",
          output: { missionId: v.missionId || "unknown", path: execPath },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "WRITE_REFLECTION": {
        const reflectionPath = toolInstances.playbook.writeReflection(v.taskId ?? 0, v.logic || "Agent step logged without explicit reflection.");
        return {
          status: "SUCCESS",
          output: { taskId: v.taskId ?? 0, path: reflectionPath },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "EXECUTE_BROWSER_FLOW": {
        const result = await toolInstances.browser.executeFlow(
          v.url,
          v.taskDescription,
          v.sessionProfile,
          v.screenshotName
        );
        return {
          status: result.status === "FLOW_COMPLETE" ? "SUCCESS" : "FAILED",
          output: result,
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "LOG_CAMPAIGN_METRICS": {
        const score = (v.impressions > 0 ? (v.clicks / v.impressions) * 100 : 0) as number;
        toolInstances.metrics.logCampaignMetric(v.project as string, score);
        return {
          status: "SUCCESS",
          output: { project: v.project, score },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "RECORD_GIT_MILESTONE": {
        toolInstances.metrics.recordMilestone(v.campaignId as string, v.gitHash as string, v.score as number);
        return {
          status: "SUCCESS",
          output: { campaignId: v.campaignId, gitHash: v.gitHash, score: v.score },
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "REFORMULATE_PROMPT": {
        const reformulator = await getReformulator();
        const result = reformulator.reformulate(v.rawPrompt as string);
        return {
          status: "SUCCESS",
          output: result,
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      case "SYS_INSPECT": {
        const { sysInspect } = await import("./sys_inspect.js");
        const result = await sysInspect({
          mode: v.mode,
          ...(v.targetPath && { targetPath: v.targetPath }),
          ...(v.pattern && { pattern: v.pattern }),
          ...(v.query && { query: v.query }),
          ...(v.params && { params: v.params as any[] }),
          ...(v.taskId && { taskId: v.taskId }),
          ...(v.breadcrumb && { breadcrumb: v.breadcrumb }),
          ...(v.missionId && { missionId: v.missionId })
        });
        return {
          status: "SUCCESS",
          output: result,
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
      }

      default:
        return {
          status: "ERROR",
          error: `Unknown action: ${v.action}`,
          executionTimeMs: Date.now() - startTime,
          schema_used: schemaEntry.name
        };
    }
  } catch (error: any) {
    return {
      status: "ERROR",
      error: error.message || String(error),
      executionTimeMs: Date.now() - startTime,
      schema_used: schemaEntry.name
    };
  }
}

export function getAvailableActions(): { action: ToolAction; description: string }[] {
  return [
    { action: "GET_SYSTEM_TELEMETRY", description: "Get system hardware telemetry (CPU, memory, load average)" },
    { action: "EXECUTE_SANDBOX_COMMAND", description: "Run a binary in the isolated sandbox with timeout" },
    { action: "PATCH_FILE_DIFF", description: "Surgically replace text in a file" },
    { action: "MANAGE_BACKGROUND_SERVICE", description: "Start/stop/restart/status a system or user process" },
    { action: "AUDIT_NETWORK_SOCKETS", description: "Scan active TCP/UDP ports" },
    { action: "STAGE_SECURE_BACKUP", description: "Create a .tar.gz snapshot of a directory" },
    { action: "INSPECT_BINARY_METADATA", description: "Inspect binary file metadata and strings" },
    { action: "OPTIMIZE_MARKETING_ASSETS", description: "Optimize video/image for social platforms" },
    { action: "WRITE_TECHNICAL_REPORT", description: "Append a technical log entry for a mission" },
    { action: "WRITE_EXECUTIVE_REPORT", description: "Write/overwrite the executive summary for a mission" },
    { action: "WRITE_REFLECTION", description: "Write a reflection artifact for a task" },
    { action: "EXECUTE_BROWSER_FLOW", description: "Automate a browser flow with Playwright" },
    { action: "LOG_CAMPAIGN_METRICS", description: "Log campaign performance metrics" },
    { action: "RECORD_GIT_MILESTONE", description: "Record a Git milestone in the metrics ledger" },
    { action: "REFORMULATE_PROMPT", description: "Transform raw prompts into structured tool chains" },
    { action: "SYS_INSPECT", description: "Unified system instrumentation utility to query environment state, read AST skeletons, or retrieve forensic runtime logs" }
  ];
}
