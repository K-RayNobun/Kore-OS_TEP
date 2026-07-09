export interface TraitPrompt {
    name: string;
    systemPrompt: string;
}

export class TraitRegistry {
    private traits: Record<string, TraitPrompt> = {
        REALIZATION: {
            name: 'REALIZATION',
            systemPrompt: 'You are a tactical code realization agent. Analyze errors and generate surgical patches.'
        },
        CONCEPTION: {
            name: 'CONCEPTION',
            systemPrompt: 'CRITICALMIND_TECHNICAL_AND_BRUTALLY_HONEST: You are a senior architect performing ruthless structural diagnostics. Identify root causes without sugarcoating.'
        }
    };

    public compileSystemPrompt(traitName: string): string {
        const trait = this.traits[traitName];
        if (!trait) {
            throw new Error(`[TRAIT_REGISTRY] Unknown trait key requested: ${traitName}`);
        }
        console.log(`[TRAIT_REGISTRY] Swapping LLM personality state to: ${trait.name}`);
        return trait.systemPrompt;
    }
}
