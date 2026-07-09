import { execSync } from 'node:child_process';
import * as path from 'node:path';

export interface CommitStats {
    hash: string;
    linesAdded: number;
    linesDeleted: number;
}

export class GitAutomationHelper {
    private workDir: string;

    constructor() {
        this.workDir = process.env.KORE_WORKSPACE_ROOT || '/home/elo/workspace';
        this.initRepo();
    }

    private executeGitCommand(args: string): string {
        try {
            return execSync(`git ${args}`, { cwd: this.workDir, encoding: 'utf8' }).trim();
        } catch (error: any) {
            console.error(`[GIT_ERROR] Failed executing: git ${args}. Reason: ${error.message}`);
            throw error;
        }
    }

    private initRepo() {
        try {
            execSync('git init', { cwd: this.workDir });
        } catch {}
    }

    public getCurrentBranch(): string {
        return this.executeGitCommand('branch --show-current');
    }

    public commitWorkspace(message: string): string {
        this.executeGitCommand('add .');
        this.executeGitCommand(`commit --allow-empty -m "${message.replace(/"/g, '\\"')}"`);
        return this.executeGitCommand('rev-parse HEAD');
    }

    public commitState(taskId: number, message: string): string | null {
        try {
            execSync('git add .', { cwd: this.workDir });
            execSync(`git commit -m "Sync State | Decision: ${taskId} | ${message}"`, { cwd: this.workDir });
            return execSync('git rev-parse HEAD', { cwd: this.workDir }).toString().trim();
        } catch (error) {
            console.error('[GIT_ERROR] Failed to commit state:', error);
            return null;
        }
    }

    public rollbackTo(sha: string): void {
        execSync(`git reset --hard ${sha}`, { cwd: this.workDir });
    }

    public createAndSwitchToSpeculativeBranch(taskId: number): void {
        const branchName = `speculative-exploratory-${taskId}`;
        this.executeGitCommand(`checkout -b ${branchName}`);
        console.log(`[GIT_LOOP] Successfully diverged onto branch: ${branchName}`);
    }

    public reconcileRejection(taskId: number, fallbackCommitHash: string): void {
        const currentBranch = this.getCurrentBranch();
        const targetBranch = `speculative-exploratory-${taskId}`;

        if (currentBranch === targetBranch || currentBranch.includes('speculative')) {
            this.executeGitCommand('checkout main');
        }

        this.executeGitCommand(`reset --hard ${fallbackCommitHash}`);
        this.executeGitCommand(`branch -D ${targetBranch}`);
        console.log(`[GIT_LOOP] Rejection complete. Purged speculative branch ${targetBranch}. Hard reset executed.`);
    }

    public reconcileApproval(taskId: number): void {
        const targetBranch = `speculative-exploratory-${taskId}`;
        this.executeGitCommand('checkout main');
        this.executeGitCommand(`merge ${targetBranch} --no-ff -m "chore(orchestrator): merge approved speculative branch for task ${taskId}"`);
        this.executeGitCommand(`branch -D ${targetBranch}`);
        console.log(`[GIT_LOOP] Approval complete. Merged speculative progress into main branch.`);
    }

    public getLatestCommitStats(): CommitStats {
        try {
            const hash = this.executeGitCommand('rev-parse HEAD');
            const numstat = this.executeGitCommand('show --numstat --oneline HEAD');
            
            let linesAdded = 0;
            let linesDeleted = 0;
            
            const lines = numstat.split('\n').slice(1);
            for (const line of lines) {
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    const added = parseInt(parts[0] || '0', 10);
                    const deleted = parseInt(parts[1] || '0', 10);
                    if (!isNaN(added)) linesAdded += added;
                    if (!isNaN(deleted)) linesDeleted += deleted;
                }
            }
            
            return { hash, linesAdded, linesDeleted };
        } catch (error) {
            return { hash: 'UNKNOWN', linesAdded: 0, linesDeleted: 0 };
        }
    }
}
