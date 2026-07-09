# Operational Architecture: Optimized Dynamic Context Mapping for Sovereign Administrative Engines

This specification outlines the **Tri-Masterclass Context Protocol (TMCP)** optimized for the Kore OS (ELO-OS) Autonomous Administration Pipeline. The architecture eliminates token bloat and context degradation across multi-day execution lifecycles by managing context exactly like an operating system manages memory: using structured maps, sequential breadcrumbs, and Just-In-Time (JIT) memory paging.

---

## 1. System Topology & Functional Concepts

```
                  [ MISSION CONTROL RUNTIME ]
                               │
               Divides Mission into Multiple Tasks
                               │
                               ▼
 ┌───────────────────────────────────────────────────────────┐
 │               TASK LIFECYCLE RECURSION LOOP               │
 ├───────────────────────────────────────────────────────────┤
 │                                                           │
 │  [Init Task] ──► Inject Masterclass 1 & 2 Base Context    │
 │                        │                                  │
 │                        ▼                                  │
 │         ┌──────────────────────────────┐                  │
 │         │   IMPLICATION ROUTING ENGINE │                  │
 │         └──────────────┬───────────────┘                  │
 │                        │                                  │
 │           ┌────────────┴────────────┐                     │
 │           ▼                         ▼                     │
 │     [TYPE: PLANNING]        [TYPE: TOOL_CALL]             │
 │     Reflect / Pivot          Execute Sandbox              │
 │           │                         │                     │
 │           └────────────┬────────────┘                     │
 │                        │                                  │
 │                        ▼                                  │
 │   [Update State] ──► Invoke `sys_inspect(mode="append")`  │
 │                        │                                  │
 │   (Loop until current Task is marked DONE or SUSPENDED)   │
 └───────────────────────────────────────────────────────────┘

```

The execution pipeline enforces a rigid hierarchy: **Mission $\rightarrow$ Tasks $\rightarrow$ Implications**.

* **Mission:** A high-level strategic directive consisting of multiple discrete steps.
* **Task:** An atomic, sequential phase within the mission. At the initialization of a task, a specialized ephemeral markdown file—the **Task State File** (`.task_state.md`)—is instantiated.
* **Implication:** A single cognitive invocation of the AI Admin Engine. Implications are strongly typed into two profiles:
1. `PLANNING`: Cognitive analysis, architectural design, trade-off matrix evaluation, or system error reflection. No direct state-mutation tool is provided.
2. `TOOL_CALL`: Sandbox execution, filesystem writes, shell execution, or web scraping loops.



---

## 2. Combined Architecture Specification

### Phase A: Task Bootstrapping (Masterclass 1 + 2 Fusion)

When a Task initializes, the Orchestrator executes a cold-boot. It constructs the baseline `.task_state.md` using static filesystem scanning and compiler hooks, preventing the injection of raw code blocks until requested.

1. **Structural Skeletons (M1):** A system background worker processes the active code trees using an AST-signature generator. It strips all implementation logic, compiling an ultra-compact map containing only package imports, class layouts, TypeScript interfaces, and function signatures.
2. **Sliding Breadcrumb Buffer (M3):** The orchestrator selects the last $N$ entries (typically $N=10$) from the persistent SQLite transaction log table (`context_chain`). These entries form a chronological timeline of immediate historical intent.

These two datasets are written directly into `.task_state.md`, configuring the system's structural and historical baseline for fewer than 1,000 tokens.

### Phase B: Just-In-Time Internal Inspection (Unified Tool Engine)

To give the AI Admin exact visibility without overloading individual implications, the separate discovery tools are unified into a single, high-performance C++ or native Node.js/Rust system utility: `sys_inspect`.

The AI Admin calls this tool during `TOOL_CALL` implications to "page" precise content into memory on demand.

```json
{
  "name": "sys_inspect",
  "description": "Unified system instrumentation utility to query environment state, read AST skeletons, or retrieve forensic runtime logs.",
  "parameters": {
    "type": "object",
    "properties": {
      "mode": {
        "type": "string",
        "enum": ["skeleton", "grep_logs", "read_db", "append"],
        "description": "The specific instrumentation vector to execute."
      },
      "target": {
        "type": "string",
        "description": "The target file path, database query string, or regular expression search term."
      },
      "payload": {
        "type": "string",
        "description": "The text content or micro-thought breadcrumb to append when mode is set to 'append'."
      }
    },
    "required": ["mode"]
  }
}

```

---

## 3. The Lifecycle of an Implication Sequence

Once initialized, the loop handles the shifting context dynamically via continuous mutations to the state file:

### Step 1: Implication Initialization

The Engine receives the active task objective accompanied *exclusively* by the current content of `.task_state.md`.

### Step 2: Planning Implication Execution

If the current lifecycle requirement is analytical, the engine runs a `PLANNING` implication. It weighs alternative implementations or reflects on a compiler error block without generating code or calling external tools.

### Step 3: Inter-Implication Context Sync (M3 Triage)

Immediately before finalizing the planning step, the AI Admin updates its context by calling the unified inspector tool with the `append` parameter:

```json
sys_inspect({
  "mode": "append",
  "payload": "[Planning Layer] Selected Option 2 for index optimization. Shifting to execution in guard.ts."
})

```

The system takes this micro-thought string, instantly formats it with a timestamp, and appends it to the bottom of the `.task_state.md` log stream.

### Step 4: Tool Call Implication Execution

The Orchestrator triggers a `TOOL_CALL` implication. Armed with its updated context file, the Admin confidently fires its operational tools (e.g., `write_file`) or invokes `sys_inspect(mode="grep_logs", target="stderr")` to verify compilation sanity.

### Step 5: Iteration Closure

Upon sandbox verification or error capture, another breadcrumb append is executed via `sys_inspect`. This loop continues recursively until the task triggers a hard Git state check-in and signals termination.

---

## 4. Architectural Advantages

* **Precision:** By loading code skeletons initially and reading line fragments via `sys_inspect(mode="grep_logs")` only when a fault triggers, the Admin targets its modifications with surgical accuracy.
* **Speed:** System state is read directly from quick native operations (`sys_inspect`) rather than taxing the LLM to search through multi-megabyte history tracks.
* **Resource Economy:** Chat histories reaching back 10 days are archived away. The context remains isolated inside the active task boundaries, maintaining an optimized, compressed token footprint throughout the runtime lifecycle.
