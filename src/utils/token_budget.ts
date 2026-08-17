import * as os from "node:os";

const MAX_IMPLICATION_TOKENS = 1000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function enforceImplicationTokenCap(prompt: string, systemPrompt: string): { capped: boolean; prompt: string; tokenCount: number } {
  const total = estimateTokens(systemPrompt + prompt);
  if (total <= MAX_IMPLICATION_TOKENS) {
    return { capped: false, prompt, tokenCount: total };
  }
  const allowedLen = MAX_IMPLICATION_TOKENS * 4;
  const truncated = systemPrompt.length >= allowedLen ? systemPrompt : systemPrompt + "\n" + prompt;
  const trimmed = truncated.substring(0, allowedLen);
  const lastSpace = trimmed.lastIndexOf(" ");
  const finalPrompt = lastSpace > 0 ? trimmed.substring(0, lastSpace) : trimmed;
  return { capped: true, prompt: finalPrompt, tokenCount: estimateTokens(finalPrompt) };
}

export function gateMissionSpawn(prompt: string, systemPrompt: string): boolean {
  const { tokenCount } = enforceImplicationTokenCap(prompt, systemPrompt);
  return tokenCount <= MAX_IMPLICATION_TOKENS;
}
