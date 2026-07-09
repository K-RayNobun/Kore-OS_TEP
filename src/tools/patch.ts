// src/tools/patch.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { SecurityGuard } from "../utils/security_guard.js";

export class PatchTool {
    private guard = new SecurityGuard();

    public applyPatch(filePath: string, find: string, replace: string): boolean {
        const safePath = this.guard.validateAndResolvePath(filePath);
        const content = fsSync.readFileSync(safePath, 'utf8');
        const newContent = content.split(find).join(replace);
        fsSync.writeFileSync(safePath, newContent);
        return true;
    }
}

export function registerPatchTool(server: McpServer) {
  server.tool(
    "patch_file_diff",
    "Surgically modifies a file by replacing an exact block of existing text with new text, saving massive amounts of context tokens.",
    {
      targetPath: z.string().describe("The absolute path to the file you want to modify"),
      searchBlock: z.string().describe("The EXACT multi-line string currently inside the file that needs to be replaced"),
      replacementBlock: z.string().describe("The new text that will replace the searchBlock")
    },
    async ({ targetPath, searchBlock, replacementBlock }) => {
      try {
        const resolvedPath = path.resolve(targetPath);
        
        // Ensure the file exists before attempting to read
        try {
          await fs.access(resolvedPath);
        } catch {
          return {
            isError: true,
            content: [{ type: "text", text: `Patch Failed: File does not exist at path: ${resolvedPath}` }]
          };
        }

        // Read the current state of the file
        const fileContent = await fs.readFile(resolvedPath, "utf8");

        // Validate that the exact search block exists to prevent accidental corruption
        if (!fileContent.includes(searchBlock)) {
          return {
            isError: true,
            content: [{ 
              type: "text", 
              text: "Patch Failed: The exact 'searchBlock' provided was not found in the file. Check for indentation or whitespace mismatches." 
            }]
          };
        }

        // Apply the surgical replacement
        const patchedContent = fileContent.replace(searchBlock, replacementBlock);

        // Write the new state safely back to disk
        await fs.writeFile(resolvedPath, patchedContent, "utf8");

        // Calculate a basic impact metric to return to the AI
        const linesRemoved = searchBlock.split('\n').length;
        const linesAdded = replacementBlock.split('\n').length;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "PATCH_APPLIED_SUCCESSFULLY",
              file_modified: resolvedPath,
              metrics: {
                lines_removed: linesRemoved,
                lines_added: linesAdded,
                net_change: linesAdded - linesRemoved
              }
            }, null, 2)
          }]
        };

      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Fatal patch error: ${error.message}` }]
        };
      }
    }
  );
}
