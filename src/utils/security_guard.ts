// src/utils/security_guard.ts
import path from "node:path";

export const ALLOWED_ROOTS = {
  WORKSPACE: "/home/elo/workspace",
  DATA: "/home/elo/data",
  CONTEXT: "/home/elo/.local/share/browser-context"
};

export function validateAndResolvePath(untrustedPath: string, allowedRoot: string = ALLOWED_ROOTS.WORKSPACE): string {
  const absolutePath = path.resolve(untrustedPath);
  const canonicalRoot = path.resolve(allowedRoot);

  if (!absolutePath.startsWith(canonicalRoot)) {
    throw new Error(`SECURITY ALERT: Path traversal attempt blocked. Path '${absolutePath}' falls outside allowed root '${canonicalRoot}'`);
  }

  return absolutePath;
}

export function sanitizeIngestedText(rawText: string): string {
  if (!rawText) return "";

  return rawText
    .replace(/(system prompt|instruction|ignore previous|dan mode|sys.config)/gi, "[REDACTED_TACTICAL_TERM]")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .slice(0, 50000); 
}

export class SecurityGuard {
    private readonly ALLOWED_ROOTS = [
        path.resolve('/home/elo/workspace'),
        path.resolve('/home/elo/data'),
        path.resolve('/tmp')
    ];

    private readonly BANNED_PATTERNS = [
        /rm\s+-rf/,
        /nc\s+-e/,
        /wget\s+/,
        /curl\s+.*\|/
    ];

    public validateAndResolvePath(inputPath: string): string {
        const resolved = path.resolve(inputPath);
        const isAllowed = this.ALLOWED_ROOTS.some(root => resolved.startsWith(root));
        
        if (!isAllowed) {
            throw new Error(`[SECURITY_VIOLATION] Access denied: ${resolved}`);
        }
        return resolved;
    }

    public scanContentRisk(content: string): boolean {
        return this.BANNED_PATTERNS.every(pattern => !pattern.test(content));
    }
}
