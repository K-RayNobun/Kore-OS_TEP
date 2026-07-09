import * as fs from 'node:fs';
import * as path from 'node:path';
import { SecurityGuard } from './security_guard.js';

export class EphemeralContentPurgeEngine {
    private guard = new SecurityGuard();
    private targetPurgeRoots: string[];

    constructor() {
        this.targetPurgeRoots = [
            path.join(process.cwd(), 'reports', 'missions', 'scraped'),
            '/home/elo/.local/share/browser-context',
            '/tmp/downloads'
        ];
    }

    public executeMissionPurge(missionId: string): void {
        console.log(`[PURGE_ENGINE] Booting cleaner sequence for mission references: ${missionId}`);

        for (const targetPath of this.targetPurgeRoots) {
            try {
                if (!fs.existsSync(targetPath)) {
                    continue;
                }

                this.cleanDirectoryRecursively(targetPath);
                console.log(`[PURGE_ENGINE] Successfully cleared temporary structures inside: ${targetPath}`);
            } catch (error: any) {
                console.error(`[PURGE_ENGINE_ERROR] Failed cleaning target root ${targetPath}: ${error.message}`);
            }
        }
    }

    private cleanDirectoryRecursively(directoryPath: string): void {
        const files = fs.readdirSync(directoryPath);

        for (const file of files) {
            const currentPath = path.join(directoryPath, file);
            const fileStat = fs.statSync(currentPath);

            if (fileStat.isDirectory()) {
                this.cleanDirectoryRecursively(currentPath);
                fs.rmdirSync(currentPath);
            } else {
                fs.unlinkSync(currentPath);
            }
        }
    }
}
