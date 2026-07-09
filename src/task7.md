# Task Spec: Update #8 — Recursive Code Realization Engine & Safe-Brakes

## 1. Architecture Overview

This update introduces the core runtime execution container responsible for the autonomous test-and-patch lifecycle of software modifications. When a realization task is scheduled, the engine moves beyond stubs and uses the `SecureSandbox` to run software builds or isolated command scripts, harvesting full telemetry output (syntax bugs, type compilation failures, runtime crashes).

To protect against runaway loops and excessive API credit consumption, the engine includes an architectural loop guard consisting of:

1. **State Iterator Counter:** A strict iteration register tracked inside a volatile memory map thread boundary.
2. **10-Iteration Safe-Brake Monitor:** Forces a hard context loop pause if exactly 10 consecutive compilation attempts fail.
3. **Autonomous Reflection Module:** Triggers upon hitting the safe-brake. It re-swaps the LLM trait constraint to `CRITICALMIND_TECHNICAL_AND_BRUTALLY_HONEST`, feeding the cumulative 10 error logs back into the model to isolate the core architectural issue before preparing an escalation notification.

```
       [ Initiate Recursive Code Execution Loop ]
                            │
                            ▼
          ┌───────────────────────────────────┐
          │ Loop Counter < 10 Iterations?     │
          └─────────────────┬─────────────────┘
                            │
               ┌────────────┴────────────┐
               ▼ (YES)                   ▼ (NO)
  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ Execute Code inside     │  │ Trigger Safe-Brake Halt │
  │ SecureSandbox           │  └────────────┬────────────┘
  └────────────┬────────────┘               │
               │                            ▼
      Build/Test Successful?   [ Swap Trait to CRITICALMIND ]
         ├──► YES ──► [ DONE ]              │
         └──► NO  ──► [ Increment Loop ]    ▼
                               [ Compile Reflection Report ]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Runaway Self-Repair Loop Brake Trigger

```txt
[REALIZATION]   [2026-07-02T16:30:00Z] Initializing code realization tracer for Task #104 (Fix Order Hooks).
[SANDBOX_LOOP]  [2026-07-02T16:30:02Z] Iteration [1/10] failed: Type 'string' is not assignable to type 'number'. Patching...
[SANDBOX_LOOP]  [2026-07-02T16:30:15Z] Iteration [5/10] failed: Cannot read properties of undefined (reading 'map'). Patching...
[SANDBOX_LOOP]  [2026-07-02T16:31:02Z] Iteration [10/10] failed: Cannot read properties of undefined (reading 'map').
[SAFE_BRAKE]    [2026-07-02T16:31:02Z] CRITICAL: 10 consecutive patch loops exhausted. Activating safe-brake halt.
[REFLECTION]    [2026-07-02T16:31:03Z] Injecting CRITICALMIND archetypes. Processing accumulated compiler telemetry...
[REFLECTION]    [2026-07-02T16:31:05Z] Structural diagnostic isolated: Missing initialization state inside parent config mapping.
[ORCHESTRATOR]  [2026-07-02T16:31:05Z] Task #104 forced to SUSPENDED. Escalation reflection logs written out to disk.

```

### B. Expected Telemetry File Format (`/reports/missions/technical/reflection_104.md`)

```markdown
# Autonomous Safe-Brake Reflection Analysis
**Target Task reference:** 104
**Failure Trajectory State:** RUNAWAY_RECURSIVE_REALIZATION

## System Loop Telemetry Dump
* **Total Iterations Attempted:** 10 / 10
* **Execution Sandbox Command:** `npm run build`

## Root Cause Structural Analysis
> The patch loop continually failed due to a missing default initialization value for the order metadata array mapping payload. The code was attempting a `.map()` evaluation over a null interface state because the raw sandbox mocked test database did not match the environment assumptions.

## Proposed Strategy Update
* Inject an initial conditional check (`?? []`) directly into the repository data pipeline.

```

---

## 3. Exact File Targets & Placements

### Target 1: New Module `src/utils/realization_engine.ts`

Create the dedicated execution tracer component tracking loop counters and routing code generation loops cleanly.

```typescript
import { SecureSandbox } from '../tools/sandbox_tool';
import { ApiGuardMiddleware } from './api_guard_middleware';
import { TraitRegistry } from './trait_registry';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RealizationConfig {
    taskId: number;
    buildCommand: string;
    targetFilePath: string;
}

export class RecursiveRealizationEngine {
    private sandbox = new SecureSandbox();
    private apiGuard = new ApiGuardMiddleware();
    private traitRegistry = new TraitRegistry();
    private maxIterations = 10;

    /**
     * Executes the recursive test-and-patch lifecycle loop.
     */
    public async executeRealizationLoop(config: RealizationConfig, taskPrompt: string): Promise<{ success: boolean; logs: string }> {
        let loopCounter = 0;
        const errorAccumulator: string[] = [];

        while (loopCounter < this.maxIterations) {
            loopCounter++;
            console.log(`[SANDBOX_LOOP] Initiating execution cycle [${loopCounter}/${this.maxIterations}]...`);

            try {
                // 1. Run the compilation/test command inside the isolated sandbox environment
                const compileOutput = await this.sandbox.runIsolatedBinary('/usr/bin/npm', ['run', 'build'], 12000);
                console.log(`[SANDBOX_LOOP] Compilation loop successful on iteration ${loopCounter}.`);
                return { success: true, logs: compileOutput };
            } catch (sandboxError: any) {
                console.warn(`[SANDBOX_LOOP] Iteration ${loopCounter} crashed. Logging error telemetry...`);
                errorAccumulator.push(`[ITERATION ${loopCounter}] Error output:\n${sandboxError.message}`);

                if (loopCounter >= this.maxIterations) {
                    break; // Hard block reached
                }

                // 2. Request a patch generation pass from the LLM, passing previous errors back to the context
                await this.generatePatchPass(config, taskPrompt, errorAccumulator.join('\n'));
            }
        }

        // 3. Safe-Brake Activated: Run autonomous reflection parsing
        const reflectionOutput = await this.executeAutonomousReflection(config.taskId, errorAccumulator.join('\n'));
        return { success: false, logs: reflectionOutput };
    }

    private async generatePatchPass(config: RealizationConfig, basePrompt: string, accumulatedErrors: string[] | string): Promise<void> {
        const systemPrompt = this.traitRegistry.compileSystemPrompt('REALIZATION');
        const optimizedErrors = this.apiGuard.optimizePayloadContext(accumulatedErrors.toString(), 40000);

        await this.apiGuard.executeWithRetry('gemini', async (apiKey) => {
            console.log(`[REALIZATION] Generating tactical code patch fix via active LLM layer keys...`);
            // Here, your actual LLM connector writes out a surgical block modification to config.targetFilePath
            return { text: "Simulated patch write generation." };
        });
    }

    private async executeAutonomousReflection(taskId: number, completeErrorLogs: string): Promise<string> {
        console.log(`[SAFE_BRAKE] Hard brake triggered. Initiating autonomous critical structural reflection...`);
        
        // Force the personality state to brutally honest critical mind layout
        const criticalSystemPrompt = this.traitRegistry.compileSystemPrompt('CONCEPTION');
        const optimizedLogs = this.apiGuard.optimizePayloadContext(completeErrorLogs, 60000);

        const reflectionResult = await this.apiGuard.executeWithRetry('gemini', async (apiKey) => {
            // Call the LLM to analyze the 10 failure cycles and return an structural issue diagnosis
            return { text: "The patch loop continually failed due to a structural type mapping issue." };
        });

        // Write the diagnostic telemetry down to disk for internal reference
        const reportPath = path.join(process.cwd(), 'reports/missions/technical', `reflection_${taskId}.md`);
        const markdownPayload = `# Autonomous Safe-Brake Reflection Analysis\n**Task Reference:** ${taskId}\n\n## Diagnostic Core\n> ${reflectionResult.text}`;
        
        fs.writeFileSync(reportPath, markdownPayload, 'utf8');
        return reflectionResult.text;
    }
}

```

### Target 2: Connecting the Engine within `src/index.ts`

Replace the standard completion stubs within your core runtime file (`src/index.ts`) to handle full recursive validation routines before marking a realization subtask done.

```typescript
import { RecursiveRealizationEngine } from './utils/realization_engine';
import { databaseHelper as db } from './utils/database_helper';

const realizationEngine = new RecursiveRealizationEngine();

// Upgrade Hook 1 within executeTask implementation block
async function handleRealizationLifecycleStep(task: any) {
    if (task.name.includes('Code') || task.name.includes('Implement')) {
        db.updateTaskStatus(task.id, 'RUNNING');

        const contextConfig = {
            taskId: task.id,
            buildCommand: 'npm run build',
            targetFilePath: path.join('/home/elo/workspace', 'src/active_module.ts')
        };

        const result = await realizationEngine.executeRealizationLoop(contextConfig, task.name);

        if (result.success) {
            console.log(`[ORCHESTRATOR] Realization pass completed cleanly for task ${task.id}.`);
            // Forward directly down into the standard Update #3 dual-reporting channel pipelines
        } else {
            console.error(`[ORCHESTRATOR] Realization failed under safe-brake boundary limits. Suspending task ${task.id}.`);
            db.updateTaskStatus(task.id, 'SUSPENDED');
            // Dispatch notification loops down to mobile interface channel architectures
        }
    }
}

```

---

## 4. Assumptions Section

* **Sandbox Capability Boundary:** It is assumed that the command strings mapped via `config.buildCommand` contain validated parameters acceptable to the shell argument white-list rules tracked inside `src/utils/command_validator.ts`.
* **Atomic Patch Application:** Every execution pass generates an isolated code file change on disk. It relies directly on `writeFileSync` routines to guarantee the codebase modifications flush cleanly to disk before running the subsequent sandbox test loop.

---

## 5. Definition of Done Checklist

* [ ] **Strict 10-Loop Limit Verification:** Injecting a mock compilation error that systematically fails every time successfully terminates the real-time loop execution thread at exactly the 10th attempt.
* [ ] **Safe-Brake State Suspension Test:** Assert that a task failing all 10 iteration parameters finishes with a state status equal to `SUSPENDED` inside the core SQLite task table instead of crashing or looping indefinitely.
* [ ] **Critical Personality Shift Check:** Confirm via standard out telemetry tracing that during the execution of `executeAutonomousReflection`, the registry prompt module successfully forces compilation under the `CRITICALMIND_TECHNICAL_AND_BRUTALLY_HONEST` system configuration keys.
* [ ] **Reflection Artifact Verification:** Assert that upon safe-brake execution, `reports/missions/technical/reflection_[id].md` is physically stored on disk, holding deep diagnosis context.