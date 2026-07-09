# Prompt Reformulator Implementation Plan

**Mission ID:** plan-1783174403122  
**Status:** IMPLEMENTED  
**Integration Point:** `executeMission()` pre-LLM hook in `agent_loop.ts`

## Implementation Complete ✓

### Files Created/Modified:
1. **`src/utils/prompt_reformulator.ts`** - Core reformulator class (310 lines)
2. **`src/utils/agent_loop.ts`** - Pre-reformulation hook before LLM decomposition
3. **`src/utils/tool_dispatcher.ts`** - Added `REFORMULATE_PROMPT` action
4. **`tests/prompt-reformulator/test_reformulator.js`** - Test suite (7/7 tests passing)

## Core Architecture

The Prompt Reformulator transforms raw user prompts into structured, deterministic tool chains using 5-layer constraint-first architecture:

```
[Raw Prompt] → Reformulator → [Structured Tool Chain] → LLM (for content generation only) → [Execution]
```

## Five-Layer Structure

### Layer 1: Purpose Definition
Single cognitive responsibility - transform prompts into tool chains with explicit output contracts.

### Layer 2: Constraint Layer (NOT_ALLOWED)
- Guess missing required parameters
- Combine multiple responsibilities in one tool call
- Emit non-JSON output
- Invent tool names or parameter keys
- Proceed with ambiguous/missing critical inputs

### Layer 3: Interpretation Layer
Extract signals:
- `platform`: Valid platform name or URL
- `content_type`: video|image|text|binary
- `campaign_context`: product|campaign|brand identifiers
- `session_profile`: browser session name for flows
- `metric_data`: impressions/clicks/conversions counts

### Layer 4: Decision Layer
Priority-ordered tool selection:
1. Security guard validation (BLOCK if path traversal/malicious)
2. Platform/content-type driven tool mapping
3. Parameter extraction with defaults
4. Multi-step decomposition when needed

### Layer 5: Output Contract
```json
{
  "mission_id": "string",
  "status": "REFORMAT_READY|VALIDATION_ERROR|BLOCKED",
  "tool_chain": [
    {
      "step": number,
      "tool": "TOOL_NAME",
      "parameters": {},
      "depends_on_step": number|null,
      "output_marker": "string|null"
    }
  ],
  "validation_errors": ["error1", "error2"]
}
```

## Prompt Categories & Mappings

| Category | Trigger Patterns | Tool Chain |
|----------|---------------|------------|
| Social Media Content | "write.*post|content|caption" | WRITE_TECHNICAL_REPORT + WRITE_EXECUTIVE_REPORT |
| Browser Flow | "login|scrape|extract.*from.*url" | EXECUTE_BROWSER_FLOW + validation |
| Asset Optimization | "optimize.*video|image|for.*platform" | OPTIMIZE_MARKETING_ASSETS |
| Backup+Operation | "before.*patch|backup.*before|create.*snapshot" | STAGE_SECURE_BACKUP + chained tool |
| Code Implementation | "implement|add.*middleware|code.*" | PATCH_FILE_DIFF or RealizationEngine |
| Metrics Logging | "log.*metrics|impressions.*clicks" | LOG_CAMPAIGN_METRICS |
| Multi-Step Mission | "prepare|verify.*backup.*generate|and.*and" | Sequential tool chain |

## Implementation Files

1. **`src/utils/prompt_reformulator.ts`** - Core reformulator class
2. **`src/utils/agent_loop.ts`** - Pre-reformulation hook at line 39
3. **`src/utils/tool_dispatcher.ts`** - Add REFORMULATE_PROMPT action
4. **`tests/prompt-reformulator/`** - Category-specific test cases

## Output Markers Pattern

For deterministic parsing without AI:
- `POST_X_START|||...POST_X_END|||` for social media posts
- `METRIC_RECORDED|||project_id:score|||` for metrics
- `BACKUP_CREATED|||path|||` for backup artifacts

## Failure Behavior

- Missing required params → `{"status": "VALIDATION_ERROR", "missing": ["param_name"]}`
- Security violation → `{"status": "BLOCKED", "reason": "SECURITY_VIOLATION"}`
- Ambiguous intent → `{"status": "VALIDATION_ERROR", "ambiguous_signals": ["signal1"]}`

## Engineering Principles Applied

1. **Responsibility Separation** - Reformulator only structures, LLM only generates
2. **Constraint-First** - Hard boundaries on what reformulator will attempt
3. **Tradeoff Ordering** - Security > Validation > Structure > Content
4. **Output Contract** - Every output follows strict JSON schema
5. **Surface Area Minimization** - Single purpose, zero fluff