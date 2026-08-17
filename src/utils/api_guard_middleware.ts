import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RetryEvent {
  attempt: number;
  error_type: string;
  error_message: string;
  error_stack?: string;
  http_status?: number;
  timeout_duration_ms: number | undefined;
  api_key_id_from?: string;
  api_key_id_to?: string;
  cooldown_ms: number;
  duration_ms: number;
  provider: string;
}

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

    public estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    public gatePromptByTokenBudget(prompt: string, systemPrompt: string, maxTokens = 1000): boolean {
        const total = this.estimateTokens(systemPrompt + prompt);
        return total <= maxTokens;
    }

    private loadKeyPool() {
        const configPath = process.env.KORE_API_POOL_PATH || path.join(process.cwd(), 'config', 'api_pool.json');
        if (fs.existsSync(configPath)) {
            try {
                const raw = fs.readFileSync(configPath, 'utf8').trim();
                if (!raw) {
                    console.warn(`[API_GUARD] ${configPath} is empty. No LLM keys loaded.`);
                    return;
                }
                const parsed = JSON.parse(raw);
                this.keys = parsed.providers || {};
                this.cooldownPeriodMs = parsed.default_cooldown_ms || 60000;
            } catch (error) {
                console.warn(`[API_GUARD] Failed to parse ${configPath}:`, error instanceof Error ? error.message : String(error));
                this.keys = {};
            }
        } else {
            console.warn(`[API_GUARD] ${configPath} not found. No LLM keys loaded.`);
        }
        Object.keys(this.keys).forEach(provider => {
            this.currentIndices[provider] = 0;
        });
    }

    public getActiveKeyId(provider: string): string {
        const providerKeys = this.keys[provider];
        if (!providerKeys || providerKeys.length === 0) {
            throw new Error(`[API_GUARD_FATAL] No keys registered for provider: ${provider}`);
        }
        const index = this.currentIndices[provider] ?? 0;
        return providerKeys[index]!.id;
    }

    public getActiveKey(provider: string): string {
        const providerKeys = this.keys[provider];
        if (!providerKeys || providerKeys.length === 0) {
            throw new Error(`[API_GUARD_FATAL] No keys registered for provider: ${provider}`);
        }
        const index = this.currentIndices[provider] ?? 0;
        return providerKeys[index]!.key;
    }

    public rotateKey(provider: string): void {
        const totalKeys = (this.keys[provider] || []).length;
        if (totalKeys <= 1) {
            console.log(`[API_GUARD] Single key threshold met for ${provider}. Initiating hard wait cooldown block...`);
            return;
        }
        const current = this.currentIndices[provider] ?? 0;
        this.currentIndices[provider] = (current + 1) % totalKeys;
        console.log(`[API_GUARD] Swapped API credential key index to: [${this.currentIndices[provider]}]`);
    }

    public optimizePayloadContext(rawInput: string, maxTokenConstraint: number): string {
        const estimatedTokens = rawInput.length / 4;
        if (estimatedTokens <= maxTokenConstraint) {
            return rawInput;
        }

        console.log(`[API_GUARD] Reducing data density. Input length ${rawInput.length} characters exceeds ceiling.`);
        const chunks = rawInput.split('\n');
        const prioritizedLines = chunks.filter(line =>
            line.includes('ERROR') || line.includes('Exception') || line.includes('panic') || line.includes('FAIL')
        );

        if (prioritizedLines.length > 0) {
            return `[TRUNCATED LOGS - ERROR HIGH-LIGHTS ONLY]\n${prioritizedLines.join('\n')}`;
        }
        return rawInput.substring(0, maxTokenConstraint * 4);
    }

    public async executeWithRetry<T>(provider: string, apiCallFn: (key: string) => Promise<T>, retries: number | null = null, retryAccumulator: RetryEvent[] = []): Promise<T> {
        const maxRateLimitRetries = retries ?? 5;
        console.error(`[API_GUARD] executeWithRetry START provider=${provider} maxRetries=${maxRateLimitRetries}`);

        for (let rateLimitRetries = 0; rateLimitRetries <= maxRateLimitRetries; rateLimitRetries++) {
            const attemptStart = Date.now();
            console.error(`[API_GUARD] attempt ${rateLimitRetries + 1} provider=${provider}`);
            try {
                const activeKey = this.getActiveKey(provider);
                console.error(`[API_GUARD] calling API with keyId=${this.getActiveKeyId(provider)}`);
                const result = await apiCallFn(activeKey);
                console.error(`[API_GUARD] API call succeeded provider=${provider} attempt=${rateLimitRetries + 1}`);
                return result;
            } catch (error: any) {
                console.error(`[API_GUARD] attempt ${rateLimitRetries + 1} FAILED provider=${provider} error=${error?.message || String(error)}`);
                const isRateLimited = (error.status === 429 || error.status === 503) || error.message?.includes('429') || error.message?.includes('Quota exceeded') || error.message?.includes('UNAVAILABLE');
                const isAbortError = error.name === 'AbortError';

                if (!isRateLimited && !isAbortError) {
                    console.error(`[API_GUARD] non-retryable error, throwing provider=${provider}`);
                    throw error;
                }

                const attemptDuration = Date.now() - attemptStart;
                const fromKeyId = this.getActiveKeyId(provider);

                if (isAbortError) {
                    console.warn(`[API_GUARD] Request aborted (timeout) on attempt ${rateLimitRetries + 1}. Retrying...`);
                } else {
                    console.warn(`[API_GUARD] Rate limit hit (429) on attempt ${rateLimitRetries + 1}. Triggering rotation...`);
                }

                this.rotateKey(provider);
                const toKeyId = this.getActiveKeyId(provider);

                retryAccumulator.push({
                    attempt: rateLimitRetries + 1,
                    error_type: error.name || 'Error',
                    error_message: error.message || String(error),
                    error_stack: error.stack,
                    http_status: error.status,
                    timeout_duration_ms: isAbortError ? 120000 : undefined,
                    api_key_id_from: fromKeyId,
                    api_key_id_to: toKeyId,
                    cooldown_ms: this.cooldownPeriodMs,
                    duration_ms: attemptDuration,
                    provider: provider
                });

                if (rateLimitRetries >= maxRateLimitRetries) {
                    console.error(`[API_GUARD] FATAL: all retries exhausted provider=${provider}`);
                    throw new Error(`[API_GUARD_FATAL] Loop aborted. All retries exhausted.`);
                }

                const totalKeys = this.keys[provider]?.length || 0;
                if (totalKeys <= 1) {
                    console.log(`[API_GUARD] Single key pool. Sleeping for ${this.cooldownPeriodMs}ms before retry...`);
                } else {
                    console.log(`[API_GUARD] Exhausted all keys in pool. Sleeping for ${this.cooldownPeriodMs}ms...`);
                }

                console.error(`[API_GUARD] sleeping ${this.cooldownPeriodMs}ms before retry attempt ${rateLimitRetries + 2} provider=${provider}`);
                await new Promise(resolve => setTimeout(resolve, this.cooldownPeriodMs));
                console.error(`[API_GUARD] woke up from sleep provider=${provider}`);
            }
        }

        throw new Error(`[API_GUARD_FATAL] Loop aborted. All rate-limit retries exhausted.`);
    }
}
