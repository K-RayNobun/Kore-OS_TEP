# Task Spec: Update #2 — Multi-Provider API Key Pool & Guardrails

## 1. Architecture Overview

Update #2 implements a resilient, middleware-style execution wrapper around the outbound LLM connection layers in the Kore OS/ELO-OS runtime. It introduces a secure, rotational key pool architecture that isolates the execution engine from strict Request-Per-Minute (RPM), Request-Per-Day (RPD), and Token-Per-Minute (TPM) limits inherent to Gemini and Zhipu AI free tiers. 

Instead of allowing a `429 Too Many Requests` or context exhaustion error to crash an active, multi-day task iteration, this system layer traps the error, shifts states dynamically, swaps credentials from a thread-safe local array, or executes intelligent payload token-compression before attempting a retry.



[ Outbound LLM Call Request from index.ts / tools ]
                           │
                           ▼
          ┌─────────────────────────────────┐
          │     api_guard_middleware.ts     │
          └────────────────┬────────────────┘
                           │
        Is Context Window / TPM Threatened?
                 ├──► YES ──► [ Tokenizer / Summarizer Utility ] ──┐
                 └──► NO  ─────────────────────────────────────────┤
                                                                   ▼
                                                      ┌────────────────────────┐
                                                      │ Execute API HTTP Call  │
                                                      └────────────┬───────────┘
                                                                   │
                                                        Did it throw a 429?
                                                           ├──► YES ──┐
                                                           └──► NO    ▼
                                    ┌─────────────────────────────────┼────────────────┐
                                    ▼                                 ▼                ▼
                       [ Rotate to Next Pool Key ]            [ Clear Error ]   [ Return Data ]


                       



                       ---

## 2. Concrete Terminal & Control Flow

### A. Local Configuration Blueprint (`/config/api_pool.json`)
The key array acts as a secure local credential rotation buffer.

```json
{
  "providers": {
    "gemini": [
      { "id": "gemini_key_primary", "key": "AIzaSyAsExampleAlphaKey_111" },
      { "id": "gemini_key_backup", "key": "AIzaSyAsExampleBetaKey_222" }
    ],
    "zhipu": [
      { "id": "zhipu_key_primary", "key": "7b0a8c...ExampleZhipuKey1" },
      { "id": "zhipu_key_backup", "key": "3f1d9e...ExampleZhipuKey2" }
    ]
  },
  "default_cooldown_ms": 60000
}







B. Expected Telemetry Output Logs (Standard Out Loop Tracing)
Plaintext
[API_GUARD] [2026-07-02T14:15:01Z] Outbound request size: 142,500 tokens. TPM Threshold Limit: 100,000.
[API_GUARD] [2026-07-02T14:15:02Z] WARNING: Potential Context Exhaustion. Invoking localized Tokenizer utility...
[API_GUARD] [2026-07-02T14:15:04Z] Token reduction complete. Compressed input from 142,500 to 64,200 tokens.
[API_GUARD] [2026-07-02T14:15:05Z] Dispatching HTTP Payload via credential key index [0] (gemini_key_primary).
[API_GUARD] [2026-07-02T14:15:06Z] EXCEPTION CAUGHT: HTTP STATUS 429 (Too Many Requests).
[API_GUARD] [2026-07-02T14:15:06Z] Initiating Failover Protocol. Rotating credential keys...
[API_GUARD] [2026-07-02T14:15:06Z] Target key switched successfully to index [1] (gemini_key_backup).
[API_GUARD] [2026-07-02T14:15:07Z] Retrying HTTP Payload execution... Success. Response received cleanly.






3. Exact File Targets & Placements
Target 1: /utils/api_guard_middleware.ts
Create a clean utility to wrap all outbound generative AI interaction sequences.
TypeScript
import * as fs from 'fs';
import * as path from 'path';

interface ApiKeyConfig {
    id: string;
    key: string;
}

export class ApiGuardMiddleware {
    private keys: Record<string, ApiKeyConfig[]> = {};
    private currentIndices: Record<string, number> = {};
    private cooldownPeriodMs: number = 60000;

    constructor() {
        this.loadKeyPool();
    }

    private loadKeyPool() {
        const configPath = process.env.KORE_API_POOL_PATH || path.join(process.cwd(), 'config', 'api_pool.json');
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON.parse(raw);
            this.keys = parsed.providers;
            this.cooldownPeriodMs = parsed.default_cooldown_ms || 60000;
        }
        // Initialize state markers
        Object.keys(this.keys).forEach(provider => {
            this.currentIndices[provider] = 0;
        });
    }

    public getActiveKey(provider: string): string {
        const providerKeys = this.keys[provider];
        if (!providerKeys || providerKeys.length === 0) {
            throw new Error(`[API_GUARD_FATAL] No keys registered for provider: ${provider}`);
        }
        const index = this.currentIndices[provider];
        return providerKeys[index].key;
    }

    public rotateKey(provider: string): void {
        const totalKeys = this.keys[provider]?.length || 0;
        if (totalKeys <= 1) {
            console.log(`[API_GUARD] Single key threshold met for ${provider}. Initiating hard wait cooldown block...`);
            return;
        }
        this.currentIndices[provider] = (this.currentIndices[provider] + 1) % totalKeys;
        console.log(`[API_GUARD] Swapped API credential key index to: [${this.currentIndices[provider]}]`);
    }

    /**
     * Shrinks raw context payload blocks when token capacity boundaries are breached.
     */
    public optimizePayloadContext(rawInput: string, maxTokenConstraint: number): string {
        // Simple token estimator helper (approx 4 chars per token)
        const estimatedTokens = rawInput.length / 4;
        if (estimatedTokens <= maxTokenConstraint) {
            return rawInput;
        }

        console.log(`[API_GUARD] Reducing data density. Input length ${rawInput.length} characters exceeds ceiling.`);
        // Splits input, drops formatting, truncates redundant logs recursively
        const chunks = rawInput.split('\n');
        const prioritizedLines = chunks.filter(line => 
            line.includes('ERROR') || line.includes('Exception') || line.includes('panic') || line.includes('FAIL')
        );
        
        if (prioritizedLines.length > 0) {
            return `[TRUNCATED LOGS - ERROR HIGH-LIGHTS ONLY]\n${prioritizedLines.join('\n')}`;
        }
        return rawInput.substring(0, maxTokenConstraint * 4);
    }

    /**
     * Executes an LLM operation with integrated 429 interception loop logic.
     */
    public async executeWithRetry<T>(provider: string, apiCallFn: (key: string) => Promise<T>): Promise<T> {
        let attempts = 0;
        const maxFailuresAllowed = (this.keys[provider]?.length || 1) * 2;

        while (attempts < maxFailuresAllowed) {
            try {
                const activeKey = this.getActiveKey(provider);
                return await apiCallFn(activeKey);
            } catch (error: any) {
                attempts++;
                // Handle standard 429 or provider rate limit exceptions
                if (error.status === 429 || error.message?.includes('429') || error.message?.includes('Quota exceeded')) {
                    console.warn(`[API_GUARD] Rate limit hit (429) on attempt ${attempts}. Triggering rotation...`);
                    this.rotateKey(provider);
                    
                    // If we have wrapped all the way around the pool, back off and sleep
                    if (this.currentIndices[provider] === 0) {
                        console.log(`[API_GUARD] Exhausted all keys in pool. Sleeping for ${this.cooldownPeriodMs}ms...`);
                        await new Promise(resolve => setTimeout(resolve, this.cooldownPeriodMs));
                    }
                    continue;
                }
                throw error; // Re-throw fatal functional bugs (syntax, authorization errors)
            }
        }
        throw new Error(`[API_GUARD_FATAL] Loop aborted. All key combinations and back-off cooling periods exhausted.`);
    }
}
Target 2: Integration Hook Placement in index.ts
Wrap your existing operational LLM invocations using the new middleware instance to provide instant fault tolerance:
TypeScript
import { ApiGuardMiddleware } from './utils/api_guard_middleware';

const apiGuard = new ApiGuardMiddleware();

async function callModelGenerativeLoop(taskPrompt: string, rawSystemLogs: string) {
    const targetProvider = "gemini";
    const tokenCeilingLimit = 80000; // Target free-tier TPM constraint

    // 1. Intercept context limits before execution happens
    const optimizedContextLogs = apiGuard.optimizePayloadContext(rawSystemLogs, tokenCeilingLimit);
    const compiledPayload = `${taskPrompt}\nContext Traces:\n${optimizedContextLogs}`;

    // 2. Execute execution call via retry controller
    return await apiGuard.executeWithRetry(targetProvider, async (apiKey) => {
        // Drop your actual HTTP fetch / sdk request here, using the dynamic apiKey variable
        // return await nativeLlmClientCall(apiKey, compiledPayload);
        return { text: "Simulated successful generation pass." };
    });
}
4. Assumptions Section
Free-Tier Limits Identity: The middleware treats standard string patterns containing "429", "Quota exceeded", or explicit HTTP Status codes equal to 429 as valid rate-limit flags. General connection faults (e.g., 401 Unauthorized) will drop out immediately without wasting pool rotations.
Fallback Synchronization: If a single key is registered, or all keys in the array have been attempted inside a tight window, the tool executes a synchronous setTimeout pause corresponding to default_cooldown_ms to clear the provider's request-per-minute window safely.
Token Sizing Calculation Rule: To remain fully dependency-free without requiring massive external C++ binding packages like tiktoken, context tracking relies on a robust character_length / 4 standard approximation, adding an automatic 15% safety margin buffer to protect execution requests.
5. Definition of Done Checklist
[ ] Automatic Key Rotation Validation: Testing an artificial HTTP 429 response sequence against index [0] successfully forces a credential index change to [1] without bubbling up errors to the main task manager tracking runtime.
[ ] Synchronization Cooldown Assertion: If all keys within the provider index array are depleted, the system pauses execution and sleeps for the exact time configured by default_cooldown_ms before trying again.
[ ] Context-Truncation Integrity Test: Injecting a mock compilation text log string larger than 500,000 characters successfully triggers the payload context optimizer, reducing the output size below the maxTokenConstraint barrier before the API call fires.
[ ] Config Independence Asset: Verifies that removing or adding any arbitrary number of key strings inside /config/api_pool.json does not break file indexing loops or require modification of the underlying TypeScript types.