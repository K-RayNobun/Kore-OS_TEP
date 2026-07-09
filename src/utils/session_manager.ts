// src/utils/session_manager.ts
import fs from "node:fs/promises";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { ALLOWED_ROOTS, validateAndResolvePath, sanitizeIngestedText } from "./security_guard.js";

/**
 * Ensures a browser session directory exists, is isolated by project,
 * and is strictly locked to the 'elo' user (chmod 700).
 */
export class SessionManager {
    private readonly BASE_PATH = '/home/elo/.local/share/browser-context';

    public getSessionDir(missionId: string): string {
        const dir = path.join(this.BASE_PATH, missionId);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        return dir;
    }
}

export async function getSecureSessionContext(sessionProfile: string): Promise<string> {
  // Sanitize the profile name to prevent directory traversal in the profile string itself
  const cleanProfileName = sanitizeIngestedText(sessionProfile).replace(/[^a-zA-Z0-9_-]/g, "");
  
  if (!cleanProfileName) {
    throw new Error("Invalid session profile name provided.");
  }

  // Construct the isolated path (e.g., /home/elo/.local/share/browser-contexts/Skinglow)
  const baseContextDir = ALLOWED_ROOTS.CONTEXT; 
  const targetPath = path.join(baseContextDir, cleanProfileName);
  
  // Verify it doesn't break out of the allowed context root
  const securePath = validateAndResolvePath(targetPath, baseContextDir);

  try {
    // Create the directory if it doesn't exist
    await fs.mkdir(securePath, { recursive: true });
    
    // DEFENSE: Enforce chmod 700 (rwx------)
    await fs.chmod(securePath, 0o700);
  } catch (error: any) {
    throw new Error(`Failed to secure session directory: ${error.message}`);
  }

  return securePath;
}