import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { SecurityGuard } from "../utils/security_guard.js";

export class SecureSandbox {
    private guard = new SecurityGuard();

    public runIsolatedBinary(binaryPath: string, args: string[] = [], timeoutMs = 10000): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const safePath = this.guard.validateAndResolvePath(binaryPath);
                
                const processInstance = spawn(safePath, args, {
                    cwd: '/tmp',
                    env: { PATH: '/usr/bin:/bin' },
                    shell: false
                });

                let stdoutAccumulator = '';
                let stderrAccumulator = '';

                const killTimer = setTimeout(() => {
                    processInstance.kill('SIGKILL');
                    reject(new Error(`[SANDBOX_TIMEOUT] Execution forced kill after ${timeoutMs}ms`));
                }, timeoutMs);

                processInstance.stdout!.on('data', (data) => { stdoutAccumulator += data.toString(); });
                processInstance.stderr!.on('data', (data) => { stderrAccumulator += data.toString(); });

                processInstance.on('close', (code) => {
                    clearTimeout(killTimer);
                    if (code !== 0) {
                        reject(new Error(`[SANDBOX_FAILURE] Process exited with code ${code}. Stderr: ${stderrAccumulator}`));
                    } else {
                        resolve(stdoutAccumulator.trim());
                    }
                });

            } catch (error) {
                reject(error);
            }
        });
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
            const output = await sandbox.runIsolatedBinary(binaryPath, args, timeoutMs);
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
