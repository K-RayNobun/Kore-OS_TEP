// src/tools/network_audit.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class NetworkAudit {
    public scanSockets(): string {
        return execSync('netstat -tuln', { encoding: 'utf8' });
    }
}

export function registerNetworkAuditTool(server: McpServer) {
  server.tool(
    "audit_network_sockets",
    "Scans the system for active TCP/UDP ports, listening sockets, and established connections to diagnose network conflicts.",
    {
      protocol: z.enum(["all", "tcp", "udp"]).default("all").describe("Filter by network protocol"),
      listeningOnly: z.boolean().default(true).describe("If true, only shows ports actively listening for incoming connections")
    },
    async ({ protocol, listeningOnly }) => {
      try {
        // Build the netstat flag string dynamically based on parameters
        // -t: TCP, -u: UDP, -n: numeric IPs (faster), -p: show PID/Program, -l: listening
        let flags = "-n -p"; 
        if (protocol === "tcp" || protocol === "all") flags += " -t";
        if (protocol === "udp" || protocol === "all") flags += " -u";
        if (listeningOnly) flags += " -l";

        // Execute netstat natively via BusyBox
        const { stdout } = await execAsync(`netstat ${flags}`, { timeout: 5000 });

        // Parse the raw terminal output into structured arrays for the AI
        const lines = stdout.split('\n').filter(line => line.trim() !== '');
        const matrix = lines.slice(2).map(line => {
          // Normalize whitespace to single spaces to easily split into columns
          const parts = line.replace(/\s+/g, ' ').trim().split(' ');
          
          if (parts.length >= 6) {
            return {
              protocol: parts[0],
              recv_q: parts[1],
              send_q: parts[2],
              local_address: parts[3],
              foreign_address: parts[4],
              state: parts[5],
              pid_program: parts[6] || "UNKNOWN"
            };
          }
          return null;
        }).filter(item => item !== null);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              audit_timestamp: new Date().toISOString(),
              filter_applied: { protocol, listening_only: listeningOnly },
              active_sockets: matrix.length,
              connectivity_matrix: matrix
            }, null, 2)
          }]
        };

      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Network audit collapsed: ${error.message}` }]
        };
      }
    }
  );
}