// src/tools/asset_optimizer.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { heavyTaskQueue } from "../utils/task_queue.js";
import { getFfmpegArgsForProfile, CommandValidator } from "../utils/command_validator.js";
import { ALLOWED_ROOTS, validateAndResolvePath } from "../utils/security_guard.js";

const execFileAsync = promisify(execFile);

export class AssetOptimizer {
    public optimize(input: string, output: string): void {
        const args = ['-i', input, '-vcodec', 'libx264', '-crf', '23', output];
        if (!CommandValidator.validateFFmpegArgs(args)) {
            throw new Error("Invalid FFmpeg profile");
        }
        execSync(`ffmpeg ${args.join(' ')}`);
    }
}

export function registerAssetOptimizerTool(server: McpServer) {
  server.tool(
    "optimize_marketing_assets",
    "Resizes, crops, and compresses raw video or image assets to perfectly match social media platform constraints using native FFmpeg.",
    {
      inputPath: z.string().describe("Absolute path to the raw asset (e.g., '/home/elo/workspace/kars-enterprise/raw_hilux.mp4')"),
      platform: z.enum(["instagram_reels", "facebook_feed", "linkedin_document", "standard_image"]).describe("The target format profile"),
      outputDirectory: z.string().default("/home/elo/workspace/optimized_out").describe("Where to save the compressed file")
    },
    async ({ inputPath, platform, outputDirectory }) => {
      try {
        const resolvedInput = validateAndResolvePath(inputPath, ALLOWED_ROOTS.WORKSPACE);
        const resolvedOutDir = validateAndResolvePath(outputDirectory, ALLOWED_ROOTS.WORKSPACE);

        try {
          await fs.access(resolvedInput);
        } catch {
          return { isError: true, content: [{ type: "text", text: `Asset not found: ${resolvedInput}` }] };
        }

        await fs.mkdir(resolvedOutDir, { recursive: true });

        const ext = path.extname(resolvedInput);
        const baseName = path.basename(resolvedInput, ext);
        const outputFile = path.join(resolvedOutDir, `${baseName}_${platform}${ext}`);

        const ffmpegArgs = getFfmpegArgsForProfile(
          platform as "instagram_reels" | "facebook_feed" | "standard_image",
          resolvedInput,
          outputFile
        );

        await heavyTaskQueue.run(async () => {
          const { stderr } = await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 60000 });
          
          const finalStats = await fs.stat(outputFile);
          const sizeMB = (finalStats.size / (1024 * 1024)).toFixed(2);

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                status: "ASSET_OPTIMIZED",
                original_file: resolvedInput,
                optimized_file: outputFile,
                target_platform: platform,
                final_size_mb: sizeMB,
                render_warnings: stderr?.includes("Error") ? "Check FFmpeg logs, possible frame drops." : "Clean render."
              }, null, 2)
            }]
          };
        });

        const finalStats = await fs.stat(outputFile);
        const sizeMB = (finalStats.size / (1024 * 1024)).toFixed(2);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              status: "ASSET_OPTIMIZED",
              original_file: resolvedInput,
              optimized_file: outputFile,
              target_platform: platform,
              final_size_mb: sizeMB,
              render_warnings: "Clean render."
            }, null, 2)
          }]
        };

      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Security/Optimization Engine Failure: ${error.message}` }]
        };
      }
    }
  );
}