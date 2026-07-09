Task Spec: Update #4 — The 30-Minute Speculative Pivot Engine & Git Automation Loop
1. Architecture Overview
Update #4 introduces a time-bounded background state engine for long-running or blocked tasks. When a task hits a logic roadblock or a human-in-the-loop validation barrier, the orchestrator sets an explicit 30-minute countdown timer.
If the threshold passes without human feedback, the system automatically runs an atomic workspace commit, switches to a dedicated tracking branch (speculative-exploratory-[task_id]), shifts its behavioral system context to an internal execution profile, and continues work. When you come back, the system presents the speculative history and prompts for reconciliation (hard merge/refactor vs. hard branch deletion).
 [ Task Hits Blocker / Awaits Human ] ──► [ Start 30-Min Background Timer ]
                                                       │
                           ┌───────────────────────────┴───────────────────────────┐
                           ▼ (Human responds in < 30m)                             ▼ (Timer Expires)
               [ Execute Absolute Directive ]                            [ Git Auto-Commit Main ]
                           │                                                       │
                           ▼                                                       ▼
               [ Continue on Main Branch ]                               [ Git Branch: speculative-* ]
                                                                                   │
                                                                                   ▼
                                                                         [ AI Executes Speculative Loop ]
                                                                                   │
                                                                                   ▼
                                                                         [ Human Returns Later ]
                                                                                   │
                                                   ┌───────────────────────────────┴───────────────────────────────┐
                                                   ▼ (Approve Progress)                                            ▼ (Disapprove)
                                     [ Git Merge speculative-* into Main ]                           [ Git Checkout Main & Force Delete Branch ]
2. Concrete Terminal & Control Flow
A. Terminal Trace: Automated Workspace Diversion Sequence
Plaintext
[PIVOT_ENGINE] [2026-07-02T14:40:00Z] Task #42 status updated to SUSPENDED. Human notification dispatched to mobile app.
[PIVOT_ENGINE] [2026-07-02T14:40:00Z] Initializing 30-minute active timeout monitor...
[PIVOT_ENGINE] [2026-07-02T15:10:00Z] CRITICAL: 30-minute timeout expired with zero human response. Switching to speculative track.
[GIT_LOOP]     [2026-07-02T15:10:01Z] Executing pre-divergence workspace commit on branch 'main'...
[GIT_LOOP]     [2026-07-02T15:10:02Z] Local commit hash generated: [commit 7fca12b] "chore(task-42): pre-pivot snapshot due to human timeout"
[GIT_LOOP]     [2026-07-02T15:10:02Z] Creating exploratory tracking branch: 'speculative-exploratory-42'
[GIT_LOOP]     [2026-07-02T15:10:03Z] Switched to branch 'speculative-exploratory-42'. Workspace branch divergence complete.
[PIVOT_ENGINE] [2026-07-02T15:10:03Z] Unblocking Task #42 thread on speculative track. Advancing execution state.
B. Expected File Modification After Recursive Iteration
Every successful loop on the speculative branch writes directly to the repository using a strict log template.
Bash
$ git log -n 1 --stat
Plaintext
commit 9a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b
Author: Kore OS Admin <admin@kore-os.internal>
Date:   Thu Jul 2 15:25:00 2026 +0000

    chore(task-42): speculative loop iteration pass
    
    METADATA_SNAPSHOT:
    - Target Subtask ID: 42
    - Run State: SPECULATIVE_EXPLORATORY
    - Active Branch: speculative-exploratory-42
    - Loop Counter Trace: 1/10
    - Technical Execution Status: SUCCESSFUL_PATCH

 src/tools/playbook_compiler.ts | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
3. Exact File Targets & Placements
Target 1: New Module src/utils/git_automation_helper.ts
Create a clean helper utility leveraging Node’s native node:child_process to execute shell git directives inside the designated workspace (/home/elo/workspace).
TypeScript
import { execSync } from 'node:child_process';
import * as path from 'node:path';

export class GitAutomationHelper {
    private workspaceRoot: string;

    constructor() {
        this.workspaceRoot = process.env.KORE_WORKSPACE_ROOT || '/home/elo/workspace';
    }

    private executeGitCommand(args: string): string {
        try {
            return execSync(`git ${args}`, { cwd: this.workspaceRoot, encoding: 'utf8' }).trim();
        } catch (error: any) {
            console.error(`[GIT_ERROR] Failed executing: git ${args}. Reason: ${error.message}`);
            throw error;
        }
    }

    public getCurrentBranch(): string {
        return this.executeGitCommand('branch --show-current');
    }

    public commitWorkspace(message: string): string {
        this.executeGitCommand('add .');
        // Allow empty checkouts to prevent crashing if no modifications occurred during iteration
        this.executeGitCommand(`commit --allow-empty -m "${message.replace(/"/g, '\\"')}"`);
        return this.executeGitCommand('rev-parse HEAD');
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
        
        // Hard drop the exploratory code base back to the original stable pre-timeout hash
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
}
Target 2: Integrating Timeout Tracking Hook inside src/index.ts
Refactor the primary executeTask routing container in src/index.ts to implement the asynchronous background timer block directly.
TypeScript
import { GitAutomationHelper } from './utils/git_automation_helper';
import { databaseHelper as db } from './utils/database_helper';

const gitHelper = new GitAutomationHelper();
const activeTimers = new Map<number, NodeJS.Timeout>();
const prePivotHashes = new Map<number, string>();

async function executeTask(task: any) {
    // Current task execution stub behavior mapped to Hook 1
    console.log(`[ORCHESTRATOR] Booting task processing loop for ID: ${task.id}`);
    
    if (task.status === 'SUSPENDED') {
        handleSuspendedTaskEscalation(task);
    }
}

function handleSuspendedTaskEscalation(task: any) {
    const TIMEOUT_DURATION_MS = 30 * 60 * 1000; // 30 Minutes
    
    console.log(`[PIVOT_ENGINE] Task ${task.id} is blocked awaiting human verification. Initializing timeout trigger.`);
    
    const timeout = setTimeout(() => {
        executeSpeculativePivot(task);
    }, TIMEOUT_DURATION_MS);
    
    activeTimers.set(task.id, timeout);
}

function executeSpeculativePivot(task: any) {
    console.log(`[PIVOT_ENGINE] 30 minutes elapsed without input for task ${task.id}. Diverging branch...`);
    
    try {
        // 1. Commit whatever is sitting on the main tree and capture the recovery reference point
        const prePivotHash = gitHelper.commitWorkspace(`chore(task-${task.id}): pre-pivot snapshot due to human timeout`);
        prePivotHashes.set(task.id, prePivotHash);
        
        // 2. Fork off to the temporary exploration tree
        gitHelper.createAndSwitchToSpeculativeBranch(task.id);
        
        // 3. Mark the task state inside the database to reflect active speculative execution
        db.updateTaskStatus(task.id, 'RUNNING'); 
        db.setTaskLogicBranch(task.id, `speculative-exploratory-${task.id}`);
        
        // 4. Force restart the task execution pipeline on the isolated branch layout
        console.log(`[PIVOT_ENGINE] AI admin resuming task ${task.id} autonomously on exploratory branch.`);
        // resumeAutonomousExecutionLoop(task);
        
    } catch (error) {
        console.error(`[PIVOT_ENGINE_CRITICAL] Failed branch swap routine for task ${task.id}`, error);
    }
}

// Public API Interface entry point invoked when your phone app passes a resolve command back to the system
export async function receiveHumanReconciliationDirective(taskId: number, approved: boolean) {
    const timeoutHandle = activeTimers.get(taskId);
    if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        activeTimers.delete(taskId);
    }

    const task = await db.getTaskById(taskId);
    
    if (task.logic_branch && task.logic_branch.startsWith('speculative-')) {
        console.log(`[RECONCILIATION] Processing human response for speculative task ${taskId}. Approved: ${approved}`);
        
        if (approved) {
            gitHelper.reconcileApproval(taskId);
            db.updateTaskStatus(taskId, 'DONE');
        } else {
            const recoveryHash = prePivotHashes.get(taskId) || "HEAD~1";
            gitHelper.reconcileRejection(taskId, recoveryHash);
            db.updateTaskStatus(taskId, 'SUSPENDED'); // Return to suspended layout for a clean manual intervention
        }
        
        db.setTaskLogicBranch(taskId, 'main');
        prePivotHashes.delete(taskId);
    } else {
        console.log(`[RECONCILIATION] Task ${taskId} responded to within window limit. Applying standard absolute directive.`);
        db.updateTaskStatus(taskId, approved ? 'DONE' : 'FAILED');
    }
}
4. Assumptions Section
Workspace Initialization Rule: It is assumed that /home/elo/workspace has already been initialized as a functional Git repository (git init) and contains at least one baseline root commit (initial commit) prior to launching the Kore OS instance.
Workspace Safety Isolation: The Git helper executes commands strictly targeted to the project workspace directory layout. It will not touch system level configs or modify the core runtime codebase directory sitting inside /src.
Zero Modification Safety Guarantee: If the AI admin attempts a commit pass during an automated recursive loop, and no files have changed on disk, git commit --allow-empty prevents the underlying terminal command from throwing a non-zero exit status code that would crash the executeTask thread.
5. Definition of Done Checklist
[ ] Branch Divergence Telemetry Verification: Forcing an artificial timeout execution against a SUSPENDED task successfully triggers a workspace baseline commit, forks off a clean branch matching speculative-exploratory-[id], and moves the active branch selector off main.
[ ] Absolute Rejection Cleanup Test: Invoking receiveHumanReconciliationDirective(id, false) successfully checks the workspace back out to main, triggers a hard reset to the exact hash logged prior to the pivot, and completely drops the temporary speculative branch from local tracking memory.
[ ] Concurrent Timer Safety Isolation: Launching three independent tasks in parallel and setting them all to SUSPENDED creates three completely unique, non-overlapping async timers inside the internal runtime map memory tracking pool.
[ ] Empty Workspace Pass Validation: Running the commit loops when no new code changes have been introduced executes cleanly without raising system shell exceptions or crashing the core Node.js execution loop wrapper.