import { createHash } from "node:crypto";

export type TypedIpcFrame = Record<string, unknown>;

export interface ImplicationRecord {
  tool: string;
  paramsJson: string;
  environmentJson?: string;
  resultJson: string;
}

export class ImplicationStore {
  private readonly ttlMinutes = 30;

  public computeHash(tool: string, params: Record<string, unknown>, environment?: Record<string, unknown>): string {
    const normalized = JSON.stringify({ tool, params, environment: environment ?? {} });
    return createHash("sha256").update(normalized).digest("hex");
  }

  public async lookup(tool: string, params: Record<string, unknown>, environment?: Record<string, unknown>): Promise<string | null> {
    const hash = this.computeHash(tool, params, environment);
    const row = await import("./database_helper.js").then((m) => m.lookupImplicationHash(hash));
    if (!row) return null;
    return row.result_json;
  }

  public async store(tool: string, params: Record<string, unknown>, result: unknown, environment?: Record<string, unknown>): Promise<void> {
    const hash = this.computeHash(tool, params, environment);
    const paramsJson = JSON.stringify(params);
    const resultJson = JSON.stringify(result);
    const environmentJson = environment ? JSON.stringify(environment) : undefined;
    await import("./database_helper.js").then((m) => m.upsertImplicationHash(hash, tool, paramsJson, resultJson, environmentJson, this.ttlMinutes));
  }

  public async gc(): Promise<number> {
    return await import("./database_helper.js").then((m) => m.gcExpiredImplicationHashes());
  }
}
