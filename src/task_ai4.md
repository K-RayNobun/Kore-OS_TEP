# Task Spec: Update #10 — LLM Resilience & API Key Pooling

## 1. Architecture Overview

Update #10 elevates the AI Admin's cognitive capabilities from local simulated stubs to resilient, production-grade LLM connectivity. Since the AI Admin depends on external API providers (Gemini, Zhipu), this middleware acts as an intelligent traffic controller to ensure uptime, cost-efficiency, and error recovery.

1. **Key Rotation & Pooling:** Instead of a single hardcoded key, the system pulls from a configuration pool, enabling automatic rotation if a specific key hits rate limits.
2. **Contextual Token Management:** Automatically truncates or chunks prompts that exceed the provider's context window, preventing service-side rejection.
3. **Resilient Retry Logic:** Implements exponential backoff to handle `429 Too Many Requests` or transient network failures, ensuring mission-critical tasks don't fail due to ephemeral service hiccups.

```
[Orchestrator] ──► [ApiGuardMiddleware] ──► [Key Rotation Logic]
                                │               │
                                │        [Context Optimizer]
                                │               │
                                ▼               ▼
                        [Provider API (Gemini/Zhipu)]

```

---

## 2. Concrete Terminal & Control Flow

### A. Terminal Trace: Key Rotation on Rate Limit

```txt
[API_GUARD]      [2026-07-02T16:20:00Z] Attempting request to Gemini...
[API_GUARD]      [2026-07-02T16:20:01Z] Request failed: 429 Too Many Requests.
[API_GUARD]      [2026-07-02T16:20:01Z] Rotating API Key. Switching to: pool_key_02...
[API_GUARD]      [2026-07-02T16:20:01Z] Retrying request (Attempt 2)...
[API_GUARD]      [2026-07-02T16:20:02Z] Success: Request completed.

```

---

## 3. Exact File Targets & Placements

### Target 1: Implementing `src/utils/api_guard_middleware.ts`

This middleware wraps all outbound calls to LLM endpoints.

```typescript
import fs from 'node:fs';

export class ApiGuardMiddleware {
    private pool: any;
    private currentKeyIndex: Record<string, number> = {};

    constructor(configPath: string = 'config/api_pool.json') {
        this.pool = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    public getActiveKey(provider: string): string {
        const keys = this.pool.providers[provider];
        const index = this.currentKeyIndex[provider] || 0;
        return keys[index].key;
    }

    public rotateKey(provider: string) {
        const keys = this.pool.providers[provider];
        this.currentKeyIndex[provider] = ((this.currentKeyIndex[provider] || 0) + 1) % keys.length;
    }

    public async executeWithRetry<T>(provider: string, fn: () => Promise<T>, retries = 3): Promise<T> {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error: any) {
                if (error.status === 429 && i < retries - 1) {
                    this.rotateKey(provider);
                    await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Exponential backoff
                    continue;
                }
                throw error;
            }
        }
        throw new Error('All retries exhausted');
    }
}

```

---

## 4. Assumptions Section

* **Config Structure:** Expects `config/api_pool.json` to be present with the structure:
```json
{ "providers": { "gemini": [ { "id": "key1", "key": "..." } ], "zhipu": [...] } }

```


* **Environment:** Assumes `process.env` might override pathing if specified.

---

## 5. Definition of Done Checklist

* [ ] **Key Rotation:** Verify that calling `rotateKey` updates the internal pointer and `getActiveKey` returns the next key.
* [ ] **Retry Mechanism:** Simulate a `429` error and verify `executeWithRetry` performs the rotation and waits before retrying.
* [ ] **JSON Parsing:** Verify the constructor correctly loads the `api_pool.json` file.
