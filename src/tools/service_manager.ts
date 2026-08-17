// src/tools/service_manager.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import * as dbHelper from "../utils/database_helper.js";
import { validateAndResolvePath, ALLOWED_ROOTS } from "../utils/security_guard.js";

const execAsync = promisify(exec);

export class ServiceManager extends EventEmitter {
  getAvailableTasks(): any[] {
    return dbHelper.getAvailableTasks();
  }

  completeTask(taskId: number): void {
    dbHelper.updateTaskStatus(taskId, "DONE");
    console.log(`Task ${taskId} completed.`);
    this.emit("taskCompleted", taskId);
  }

  suspendTask(taskId: number): void {
    dbHelper.updateTaskStatus(taskId, "SUSPENDED");
    console.log(`Task ${taskId} suspended.`);
  }

  failTask(taskId: number, errorMessage: string): void {
    dbHelper.updateTaskStatus(taskId, "FAILED");
    console.log(`Task ${taskId} failed: ${errorMessage}`);
    this.emit("taskFailed", taskId);
  }

  public manage(service: string, action: 'start' | 'stop' | 'restart' | 'status' | 'kill'): string {
    try {
      return execSync(`rc-service ${service} ${action}`, { encoding: 'utf8' });
    } catch (e: any) {
      return `[ERROR] ${e.message}`;
    }
  }
}

export const serviceManager = new ServiceManager();

export function registerServiceManagerTool(server: McpServer) {
  server.tool(
    "manage_background_service",
    "Manages the lifecycle of background daemons and processes on Alpine Linux using OpenRC or standard process signals.",
    {
      target: z.string().describe("The name of the service (e.g., 'nginx') or a specific Process ID (PID)"),
      action: z.enum(["status", "start", "stop", "restart", "kill"]).describe("The lifecycle action to execute"),
      isSystemDaemon: z.boolean().default(false).describe("Set to true if targeting an OpenRC system service, false for standard user processes")
    },
    async ({ target, action, isSystemDaemon }) => {
      try {
        if (isSystemDaemon) {
          if (action === "kill") {
            return { isError: true, content: [{ type: "text", text: "Action 'kill' is invalid for OpenRC. Use 'stop'." }] };
          }
          const safeTarget = target.replace(/[^a-zA-Z0-9_-]/g, "");
          const { stdout } = await execAsync(`sudo rc-service ${safeTarget} ${action}`, { timeout: 5000 });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "LIFECYCLE_ACTION_EXECUTED",
                target_process: target,
                action_taken: action,
                system_output: stdout.trim() || "Execution completed with no standard output.",
                warnings: "None"
              }, null, 2)
            }]
          };
        }

        if (action === "status") {
          const { stdout } = await execAsync(`ps -ef`, { timeout: 5000 });
          const matches = stdout.split("\n").filter(line => line.includes(target) && !line.includes("grep"));
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: matches.length > 0 ? "PROCESS_FOUND" : "PROCESS_NOT_FOUND",
                target_process: target,
                matches: matches.slice(0, 10)
              }, null, 2)
            }]
          };
        }

        if (action === "kill" || action === "stop") {
          const pid = parseInt(target, 10);
          if (Number.isFinite(pid) && pid > 0) {
            process.kill(pid, action === "kill" ? "SIGKILL" : "SIGTERM");
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "SIGNAL_SENT",
                  target_process: target,
                  action_taken: action,
                  signal: action === "kill" ? "SIGKILL" : "SIGTERM"
                }, null, 2)
              }]
            };
          }
          return { isError: true, content: [{ type: "text", text: `Invalid PID: ${target}` }] };
        }

        return { isError: true, content: [{ type: "text", text: `Action '${action}' requires custom shell execution for non-daemon processes.` }] };

      } catch (error: any) {
        if (action === "status" && !isSystemDaemon) {
          return {
            content: [{ type: "text", text: JSON.stringify({ status: "PROCESS_NOT_FOUND", target_process: target }, null, 2) }]
          };
        }

        return {
          isError: true,
          content: [{ type: "text", text: `Service management failure: ${error.message}\nStderr: ${error.stderr || 'N/A'}` }]
        };
      }
    }
  );
}