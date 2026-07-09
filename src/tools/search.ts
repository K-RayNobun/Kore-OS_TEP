// src/tools/search.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

// ==========================================
// 1. IN-MEMORY SEARCH INDEX (The Card Catalog)
// ==========================================
interface CacheEntry {
  timestamp: number;
  results: string[];
}
const memoryIndex = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 120000; // 2 minutes

// ==========================================
// 2. SEMANTIC ROUTING (The Organizational Filter)
// ==========================================
const DOMAIN_MAP: Record<string, string> = {
  "config": "/etc/elo-state",
  "system": "/etc",
  "workspace": "/home/elo/workspace",
  "core": "/home/elo/workspace/src/core",
  "logs": "/var/log"
};

export function registerSearchTool(server: McpServer) {
  server.tool(
    "search_workspace",
    "Lightning-fast search combining Semantic Routing, In-Memory RAM Caching, and Native ripgrep binary execution.",
    {
      domain: z.enum(["config", "system", "workspace", "core", "logs"]).describe("The semantic domain to search inside"),
      keyword: z.string().describe("The exact string or regex pattern to find"),
      extension: z.string().optional().describe("Target extension filter (e.g., '.ts')")
    },
    async ({ domain, keyword, extension }) => {
      try {
        // Resolve semantic route to an absolute Alpine path
        const targetDirectory = DOMAIN_MAP[domain];
        
        // Generate a unique fingerprint for this specific search
        const cacheKey = `${domain}:${extension || '*'}:${keyword}`;
        
        // 1. CHECK THE IN-MEMORY CARD CATALOG FIRST
        const cached = memoryIndex.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                source: "RAM_CACHE",
                speed: "Instant",
                results_found: cached.results.length,
                matches: cached.results
              }, null, 2)
            }]
          };
        }

        // ==========================================
        // 3. NATIVE OS-LEVEL INDEXING (ripgrep)
        // ==========================================
        const rgArgs = [
          "-l", // Only output file paths (files-with-matches)
          "--max-filesize", "2M", // Instant byte-size gatekeeping
          "--glob", "!node_modules/**", // Hard structural pruning
          "--glob", "!.git/**",
          "--glob", "!.next/**",
          "--glob", "!dist/**"
        ];

        // Apply native extension filters BEFORE reading bytes
        if (extension) {
          rgArgs.push("-type-add", `custom:*.${extension.replace('.', '')}`);
          rgArgs.push("-t", "custom");
        }

        // Append the keyword and target directory last
        rgArgs.push(keyword);
        rgArgs.push(targetDirectory!);

        try {
          // Execute the compiled Rust binary directly on the host CPU
          const { stdout } = await execFileAsync("rg", rgArgs, { 
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer to prevent overflow
          });

          // Parse the raw binary output into a clean TypeScript array
          const matches = stdout.split('\n').filter(line => line.trim() !== '');

          // Update the In-Memory Card Catalog
          memoryIndex.set(cacheKey, {
            timestamp: Date.now(),
            results: matches
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                source: "NATIVE_RIPGREP",
                speed: "Parallel Core Execution",
                results_found: matches.length,
                matches: matches.slice(0, 50) // Cap payload for AI token efficiency
              }, null, 2)
            }]
          };

        } catch (execError: any) {
          // ripgrep exits with code 1 if no matches are found, which throws in execFile
          if (execError.code === 1) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ search_status: "NO_MATCHES_FOUND", domain, keyword }, null, 2)
              }]
            };
          }
          throw execError; 
        }

      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Native search pipeline collapsed: ${error.message}` }]
        };
      }
    }
  );
}