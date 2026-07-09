# Context Informant (sys_inspect) Implementation Plan

**Mission ID:** 1783174403122-context-informant  
**Status:** IMPLEMENTED  
**Integration:** Inject skeleton into task state summary at bootstrap

## Key Decisions (vs context_informant.md spec)

| Spec | Implementation | Rationale |
|------|---------------|-----------|
| `.task_state.md` markdown | JSON in `task_state_manager.ts` | Existing codebase already uses JSON format |
| Explicit tool calls | Inject skeleton into state summary | Seamless context availability, reduced LLM friction |
| C++/Rust utility | TypeScript compiler API | Uses existing `typescript` package in devDependencies |
| `context_chain` table | `decisions` + `observations` tables | Matches existing `database_helper.ts` schema |
| Markdown output | JSON format | Deterministic downstream parsing |

## Implementation Files

1. **`src/utils/sys_inspect.ts`** - Core instrumentation utility (4 modes: skeleton, grep_logs, read_db, append)
2. **`src/utils/tool_dispatcher.ts`** - Added `SYS_INSPECT` action
3. **`src/utils/agent_loop.ts`** - Inject skeleton into `buildStateSummary()` on first step

## Four Modes (JSON Output)

```json
{
  "skeleton": { "imports": [], "classes": [], "interfaces": [], "functions": [] },
  "grep_logs": { "matches": ["file:line"], "total_files": number },
  "read_db": { "results": [] },
  "append": { "taskId": number, "appended": boolean }
}
```

## Validation Results

- TypeScript build: PASSED
- Reformulator tests: 7/7 PASSED
