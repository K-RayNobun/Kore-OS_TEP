import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sandboxRunner } from "../utils/sandbox_runner.js";
import { SecurityGuard } from "../utils/security_guard.js";

export class SecureSandbox {
    private guard = new SecurityGuard();

    public runIsolatedBinary(binaryPath: string, args: string[] = [], options: { cpuTimeMs?: number; memoryMb?: number } = {}): Promise<string> {
        const safePath = this.guard.validateAndResolvePath(binaryPath);
        
        const result = sandboxRunner.run(safePath, args, {
            cpuTimeMs: options.cpuTimeMs || 10000,
            memoryMb: options.memoryMb || 512
        });

        return result.promise;
    }
}

export function registerSandboxTool(server: McpServer) {
    const sandbox = new SecureSandbox();
    server.tool(
        "execute_sandbox_command",
        "Executes a validated binary inside a restricted security sandbox with strict timeout constraints. Long-running processes are automatically killed after 10 seconds.",
        {
          binaryPath: z.string().describe("The absolute path to the validated binary to execute"),
          args: z.array(z.string()).default([]).describe("Optional command-line arguments for the binary"),
          timeoutMs: z.number().default(10000).describe("Maximum execution time in milliseconds before forced SIGKILL")
        },
        async ({ binaryPath, args, timeoutMs }) => {
          try {
            const output = await sandbox.runIsolatedBinary(binaryPath, args, { cpuTimeMs: timeoutMs });
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  status: "EXECUTION_SUCCESS",
                  binary_path: binaryPath,
                  output: output || "No standard output returned."
                }, null, 2)
              }]
            };
          } catch (error: any) {
            return {
              isError: true,
              content: [{ type: "text", text: error.message }]
            };
          }
        }
      );
}
