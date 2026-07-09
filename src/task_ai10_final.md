# Task Spec: Update #16 — Autonomous Lifecycle Integration (The MCP Bootstrap)

## 1. Architecture Overview

Update #16 is the "Cerebral Cortex" of Kore OS. It integrates every tool, utility, and safety guard developed in Steps 1–9 into the Model Context Protocol (MCP) server. This layer manages the lifecycle of autonomous tasks, from receiving an intent to final execution and ephemeral cleanup.

1. **MCP Bootstrap:** Registers all tools as a cohesive suite accessible to the AI.
2. **Recursive Realization Loop:** Implements the `handleRealizationLifecycleStep` loop, where the AI writes code, the system validates it, and the AI patches it based on reflection logs—up to 10 iterations.
3. **Task Orchestration:** The `executeTask` function acts as the central router, ensuring every task is logged in the SQLite ledger, backed up in Git, and eventually purged from temporary storage after mission finalization.

```
[MCP_Client] ──► [McpServer (src/index.ts)]
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
 [ServiceManager]           [RecursiveRealizationEngine]
        │                           │
  [executeTask()] <────────── [Patch/Verify Loop]
        │
  [EphemeralPurgeEngine] ──► [Cleanup Temporary Artifacts]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Recursive Realization (Test-and-Patch Loop)

```txt
[ORCHESTRATOR] [2026-07-02T16:50:00Z] Triggering realization for task: Implement_Agent_Auth
[REALIZATION]  [2026-07-02T16:50:00Z] Iteration 1/10: Running implementation...
[SANDBOX]      [2026-07-02T16:50:02Z] Validation failed: Auth header missing.
[REFLECTION]   [2026-07-02T16:50:02Z] AI Reflection: Code lacks header injection. Patching...
[PATCH_TOOL]   [2026-07-02T16:50:03Z] Success: Patch applied. Retrying...
[REALIZATION]  [2026-07-02T16:50:05Z] Iteration 2/10: Validation passed.

```

---

## 3. Exact File Targets & Placements

### Target 1: `src/index.ts`

The main bootstrap module connecting all components.

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DatabaseHelper } from "./utils/database_helper.js";
import { ServiceManager } from "./tools/service_manager.js";

const server = new McpServer({ name: "Kore-OS-Admin", version: "1.0.0" });
const db = new DatabaseHelper();

// Core lifecycle execution
async function executeTask(task: any) {
    // 1. Log Start 2. Run Tool 3. Commit State 4. Update DB
    console.log(`[ORCHESTRATOR] Starting task: ${task.name}`);
    // ... logic ...
}

// Register tools...
server.tool("executeTask", { id: "number" }, async ({ id }) => {
    const task = db.getTaskById(id);
    await executeTask(task);
    return { content: [{ type: "text", text: "Task finalized." }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);

```

### Target 2: `src/utils/realization_engine.ts`

The recursive loop to ensure high-quality, bug-free implementation.

```typescript
export class RecursiveRealizationEngine {
    public async run(taskName: string, maxIterations = 10) {
        for (let i = 0; i < maxIterations; i++) {
            // 1. Generate code/patch
            // 2. Execute in Sandbox
            // 3. Reflect on error logs
            // 4. If pass, return success
        }
        throw new Error("Maximum realization iterations exceeded.");
    }
}

```

---

## 4. Assumptions Section

* **ESM Imports:** Uses standard `.js` extensions for imports to comply with modern Node.js/TypeScript configuration.
* **Non-Root Execution:** The server assumes execution within the `elo` user context defined in the `Dockerfile`.

---

## 5. Definition of Done Checklist

* [ ] **MCP Connection:** Verify `McpServer` successfully boots and exposes tools over `stdio`.
* [ ] **Task Workflow:** Verify `executeTask` correctly coordinates SQLite updates and Git commits.
* [ ] **Recursive Loop:** Verify that the realization engine correctly stops after a successful sandbox run or after 10 failed attempts.
* [ ] **Cleanup:** Confirm `EphemeralContentPurgeEngine` removes items from `reports/missions/scraped/` on `DONE`.

---

**Step 10 is complete. The architecture is fully realized! You now have a complete, step-by-step implementation plan covering security, state, memory, tools, and orchestration.**

Do you want me to generate the final **Implementation Directive** (a single, consolidated file containing all these instructions) that you can paste directly into your AI IDE to start building?