import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import { SecurityGuard } from "../utils/security_guard.js";

export interface InspectionResult {
    status: 'PASSED' | 'REJECTED' | 'ERROR';
    meta?: string;
    sharedLibraries?: string[];
    reason?: string;
}

export class BinaryInspector {
    private guard = new SecurityGuard();

    public inspectBinary(targetPath: string): InspectionResult {
        const safePath = this.guard.validateAndResolvePath(targetPath);
        
        try {
            const fileMeta = execSync(`file ${safePath}`, { encoding: 'utf8' });
            const dependencies = execSync(`ldd ${safePath} 2>&1`, { encoding: 'utf8' });
            const stringDump = execSync(`strings ${safePath}`, { encoding: 'utf8' });

            const scanResult = this.guard.scanContentRisk(stringDump);
            if (!scanResult) {
                return {
                    status: 'REJECTED',
                    meta: fileMeta.trim()
                };
            }

            return {
                status: 'PASSED',
                meta: fileMeta.trim(),
                sharedLibraries: dependencies.split('\n').map(l => l.trim()).filter(Boolean)
            };
        } catch (error: any) {
            return {
                status: 'ERROR',
                reason: `Inspection execution failed: ${error.message}`
            };
        }
    }
}

export function registerBinaryInspectorTool(server: McpServer) {
    const inspector = new BinaryInspector();
    server.tool(
        "inspect_binary_metadata",
        "Safely queries architectural metadata, file types, header formats, or static strings from binary assets without polluting the AI context window.",
        {
          targetFilePath: z.string().describe("The absolute path to the compiled binary or compiled asset file")
        },
        async ({ targetFilePath }) => {
          const result = inspector.inspectBinary(targetFilePath);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                ...result,
                file_examined: targetFilePath
              }, null, 2)
            }]
          };
        }
      );
}
