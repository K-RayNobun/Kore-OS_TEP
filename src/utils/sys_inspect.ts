import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import Database from "better-sqlite3";
import * as dbHelper from "./database_helper.js";

export interface SkeletonResult {
  imports: string[];
  classes: Array<{ name: string; methods: string[] }>;
  interfaces: Array<{ name: string; properties: string[] }>;
  functions: Array<{ name: string; params: string; return: string }>;
  cache_hit?: boolean;
}

export interface GrepLogsResult {
  matches: string[];
  total_files: number;
}

export interface ReadDbResult {
  results: any[];
}

export interface AppendResult {
  taskId: number;
  appended: boolean;
}

export interface SysInspectParams {
  mode: "skeleton" | "paged" | "grep_logs" | "read_db" | "append";
  targetPath?: string;
  pattern?: string;
  query?: string;
  params?: any[];
  taskId?: number;
  breadcrumb?: string;
  missionId?: string;
  pageSize?: number;
  pageToken?: string;
}

const skeletonCache = new Map<string, { timestamp: number; result: SkeletonResult }>();
const CACHE_TTL_MS = 120000; // 2 minutes

export class SysInspect {
  private cacheHits = 0;
  private cacheMisses = 0;

  public getCacheStats(): { hits: number; misses: number; entries: number } {
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      entries: skeletonCache.size
    };
  }

  async inspect(params: SysInspectParams): Promise<SkeletonResult | GrepLogsResult | ReadDbResult | AppendResult> {
    switch (params.mode) {
      case "skeleton":
        return this.extractSkeleton(params.targetPath || "/home/elo/workspace/src", params.pageSize || 10);
      case "paged":
        return this.extractPagedSkeleton(params.targetPath || "/home/elo/workspace/src", params.pageSize || 5, params.pageToken);
      case "grep_logs":
        return this.grepLogs(params.pattern || "", params.missionId);
      case "read_db":
        return this.readDb(params.query || "SELECT * FROM decisions LIMIT 10", params.params);
      case "append":
        if (!params.taskId || !params.breadcrumb) {
          throw new Error("taskId and breadcrumb required for append mode");
        }
        return this.appendBreadcrumb(params.taskId, params.breadcrumb);
      default:
        throw new Error(`Unknown mode: ${(params as any).mode}`);
    }
  }

  private async extractSkeleton(targetPath: string, maxFiles: number = 10): Promise<SkeletonResult> {
    const cacheKey = `${targetPath}:${maxFiles}`;
    const cached = skeletonCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.cacheHits++;
      return { ...cached.result, cache_hit: true };
    }

    this.cacheMisses++;
    const result: SkeletonResult = {
      imports: [],
      classes: [],
      interfaces: [],
      functions: [],
      cache_hit: false
    };

    try {
      const entries = readdirSync(targetPath, { recursive: true });
      const tsFiles = entries.filter(e => typeof e === "string" && e.endsWith(".ts")).slice(0, maxFiles);

      for (const file of tsFiles) {
        const fullPath = join(targetPath, file as string);
        try {
          const content = readFileSync(fullPath, "utf8");
          const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);

          sourceFile.forEachChild((node) => {
            if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
              result.imports.push(node.moduleSpecifier.text);
            }
            if (ts.isClassDeclaration(node) && node.name) {
              const methods = node.members
                .filter(m => ts.isMethodDeclaration(m) && m.name)
                .map(m => `${(m.name as ts.Identifier).text}()`);
              result.classes.push({ name: node.name.text, methods });
            }
            if (ts.isInterfaceDeclaration(node)) {
              const properties = node.members
                .filter(m => ts.isPropertySignature(m) && m.name)
                .map(m => `${(m.name as ts.Identifier).text}: any`);
              result.interfaces.push({ name: node.name?.text || "Anonymous", properties });
            }
            if (ts.isFunctionDeclaration(node) && node.name) {
              const params = node.parameters.map(p => (p.name as ts.Identifier).getText()).join(",");
              result.functions.push({
                name: node.name.text,
                params,
                return: node.type?.getText() || "void"
              });
            }
          });

        } catch {
          // Skip files that can't be read
        }
      }

      skeletonCache.set(cacheKey, { timestamp: Date.now(), result });
      return this.enforceTokenCap(result);
    } catch (error: any) {
      throw new Error(`Skeleton extraction failed: ${error.message}`);
    }
  }

  private async extractPagedSkeleton(targetPath: string, pageSize: number, pageToken?: string): Promise<SkeletonResult> {
    const cacheKey = `${targetPath}:paged:${pageSize}:${pageToken || "start"}`;
    const cached = skeletonCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.cacheHits++;
      return { ...cached.result, cache_hit: true };
    }

    this.cacheMisses++;
    const result: SkeletonResult = {
      imports: [],
      classes: [],
      interfaces: [],
      functions: [],
      cache_hit: false
    };

    try {
      const entries = readdirSync(targetPath, { recursive: true });
      const tsFiles = entries.filter(e => typeof e === "string" && e.endsWith(".ts"));
      const startIdx = pageToken ? parseInt(pageToken, 10) || 0 : 0;
      const pageFiles = tsFiles.slice(startIdx, startIdx + pageSize);

      for (const file of pageFiles) {
        const fullPath = join(targetPath, file as string);
        try {
          const content = readFileSync(fullPath, "utf8");
          const sourceFile = ts.createSourceFile(fullPath, content, ts.ScriptTarget.Latest, true);

          sourceFile.forEachChild((node) => {
            if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
              result.imports.push(node.moduleSpecifier.text);
            }
            if (ts.isClassDeclaration(node) && node.name) {
              const methods = node.members
                .filter(m => ts.isMethodDeclaration(m) && m.name)
                .map(m => `${(m.name as ts.Identifier).text}()`);
              result.classes.push({ name: node.name.text, methods });
            }
            if (ts.isInterfaceDeclaration(node)) {
              const properties = node.members
                .filter(m => ts.isPropertySignature(m) && m.name)
                .map(m => `${(m.name as ts.Identifier).text}: any`);
              result.interfaces.push({ name: node.name?.text || "Anonymous", properties });
            }
            if (ts.isFunctionDeclaration(node) && node.name) {
              const params = node.parameters.map(p => (p.name as ts.Identifier).getText()).join(",");
              result.functions.push({
                name: node.name.text,
                params,
                return: node.type?.getText() || "void"
              });
            }
          });

        } catch {
          // Skip files that can't be read
        }
      }

      const capped = this.enforceTokenCap(result);
      const nextToken = startIdx + pageSize < tsFiles.length ? String(startIdx + pageSize) : undefined;
      (capped as any).page_token = nextToken;
      (capped as any).truncated = nextToken !== undefined;
      return capped;
    } catch (error: any) {
      throw new Error(`Paged skeleton extraction failed: ${error.message}`);
    }
  }

  private enforceTokenCap(result: SkeletonResult): SkeletonResult {
    const json = JSON.stringify(result);
    const tokens = Math.ceil(json.length / 4);
    if (tokens <= 1000) return result;

    const trimmed: SkeletonResult = {
      imports: result.imports.slice(0, 5),
      classes: result.classes.slice(0, 3),
      interfaces: result.interfaces.slice(0, 3),
      functions: result.functions.slice(0, 3)
    };
    if (result.cache_hit !== undefined) {
      (trimmed as any).cache_hit = result.cache_hit;
    }
    (trimmed as any).truncated = true;
    return trimmed;
  }

  private async grepLogs(pattern: string, missionId?: string): Promise<GrepLogsResult> {
    const matches: string[] = [];
    try {
      let decisions;
      if (missionId) {
        decisions = dbHelper.getDecisionsByMission(missionId);
      } else {
        const dbPath = process.env.KORE_DB_PATH || "/home/elo/data/tasks.db";
        const db = Database(dbPath);
        decisions = db.prepare("SELECT * FROM decisions ORDER BY id ASC").all();
      }
      for (const d of decisions) {
        if (pattern && d.thought.toLowerCase().includes(pattern.toLowerCase())) {
          matches.push(`${d.id}: ${d.thought.substring(0, 100)}`);
        }
      }
      return { matches, total_files: matches.length };
    } catch {
      return { matches, total_files: 0 };
    }
  }

  private async readDb(query: string, params?: any[]): Promise<ReadDbResult> {
    try {
      const dbPath = process.env.KORE_DB_PATH || "/home/elo/data/tasks.db";
      const db = Database(dbPath);
      const results = db.prepare(query).all(...(params || []));
      return { results };
    } catch (error: any) {
      return { results: [] };
    }
  }

  private async appendBreadcrumb(taskId: number, breadcrumb: string): Promise<AppendResult> {
    const state = await (await import("./task_state_manager.js")).loadTaskState(taskId);
    if (!state) {
      throw new Error(`Task ${taskId} not found`);
    }
    const step = {
      step: state.steps.length + 1,
      decision: { thought: `[BREADCRUMB] ${breadcrumb}`, action: null, parameters: {} },
      observation: undefined,
      timestamp: new Date().toISOString()
    };
    await (await import("./task_state_manager.js")).appendStep(state, step);
    return { taskId, appended: true };
  }
}

export async function sysInspect(params: SysInspectParams): Promise<SkeletonResult | GrepLogsResult | ReadDbResult | AppendResult> {
  const inspect = new SysInspect();
  return inspect.inspect(params);
}
