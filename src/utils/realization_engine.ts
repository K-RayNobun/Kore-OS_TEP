import { SecureSandbox } from '../tools/sandbox.js';
import { ApiGuardMiddleware } from './api_guard_middleware.js';
import { TraitRegistry } from './trait_registry.js';
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

    public async run(taskName: string, maxIterations: number = 10): Promise<void> {
        for (let i = 0; i < maxIterations; i++) {
            const config: RealizationConfig = {
                taskId: i,
                buildCommand: 'npm run build',
                targetFilePath: '/home/elo/workspace/src/active_module.ts'
            };
            const result = await this.executeRealizationLoop(config, taskName);
            if (result.success) {
                return;
            }
        }
        throw new Error("Maximum realization iterations exceeded.");
    }

    public async executeRealizationLoop(config: RealizationConfig, taskPrompt: string): Promise<{ success: boolean; logs: string }> {
        let loopCounter = 0;
        const errorAccumulator: string[] = [];

        while (loopCounter < this.maxIterations) {
            loopCounter++;
            console.log(`[SANDBOX_LOOP] Initiating execution cycle [${loopCounter}/${this.maxIterations}]...`);

            try {
                const compileOutput = await this.sandbox.runIsolatedBinary('/usr/bin/npm', ['run', 'build'], 12000);
                console.log(`[SANDBOX_LOOP] Compilation loop successful on iteration ${loopCounter}.`);
                return { success: true, logs: compileOutput };
            } catch (sandboxError: any) {
                console.warn(`[SANDBOX_LOOP] Iteration ${loopCounter} crashed. Logging error telemetry...`);
                errorAccumulator.push(`[ITERATION ${loopCounter}] Error output:\n${sandboxError.message}`);

                if (loopCounter >= this.maxIterations) {
                    break;
                }

                await this.generatePatchPass(config, taskPrompt, errorAccumulator.join('\n'));
            }
        }

        const reflectionOutput = await this.executeAutonomousReflection(config.taskId, errorAccumulator.join('\n'));
        return { success: false, logs: reflectionOutput };
    }

    private async generatePatchPass(config: RealizationConfig, basePrompt: string, accumulatedErrors: string): Promise<void> {
        const systemPrompt = this.traitRegistry.compileSystemPrompt('REALIZATION');
        const optimizedErrors = this.apiGuard.optimizePayloadContext(accumulatedErrors, 40000);

        await this.apiGuard.executeWithRetry('gemini', async (apiKey) => {
            console.log(`[REALIZATION] Generating tactical code patch fix via active LLM layer keys...`);
            return { text: "Simulated patch write generation." };
        });
    }

    private async executeAutonomousReflection(taskId: number, completeErrorLogs: string): Promise<string> {
        console.log(`[SAFE_BRAKE] Hard brake triggered. Initiating autonomous critical structural reflection...`);
        
        const criticalSystemPrompt = this.traitRegistry.compileSystemPrompt('CONCEPTION');
        const optimizedLogs = this.apiGuard.optimizePayloadContext(completeErrorLogs, 60000);

        const reflectionResult = await this.apiGuard.executeWithRetry('gemini', async (apiKey) => {
            return { text: "The patch loop continually failed due to a structural type mapping issue." };
        });

        const reportPath = path.join(process.cwd(), 'reports/missions/technical', `reflection_${taskId}.md`);
        const markdownPayload = `# Autonomous Safe-Brake Reflection Analysis\n**Task Reference:** ${taskId}\n\n## Diagnostic Core\n> ${reflectionResult.text}`;
        
        fs.writeFileSync(reportPath, markdownPayload, 'utf8');
        return reflectionResult.text;
    }
}
