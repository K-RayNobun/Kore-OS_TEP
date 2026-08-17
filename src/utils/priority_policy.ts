import type { PolicyConfig } from "./policy.js";

export interface MissionAttributes {
  urgency?: number;
  importance?: number;
  durationClass?: "quick" | "normal" | "long";
  estimateMinutes?: number;
  recurrence?: { kind?: string; intervalMinutes?: number; cron?: string; nextAt?: string };
  tags?: string[];
  category?: string;
  deadline?: string;
  quietHours?: { start?: string; end?: string };
  budgetCap?: number;
  alertPolicy?: string;
  preemptible?: boolean;
}

export function computePriority(attributes: MissionAttributes | undefined, policy: PolicyConfig): number {
  if (!attributes) return 0;
  const urgency = Number(attributes.urgency ?? 0);
  const importance = Number(attributes.importance ?? 0);
  const category = typeof attributes.category === "string" ? attributes.category : "standard";
  const categoryBias = policy.categoryBias[category] ?? 0;
  const raw = policy.weightUrgency * urgency + policy.weightImportance * importance + categoryBias;
  return Math.max(0, Math.round(raw));
}

export function isOpportunistic(attributes: MissionAttributes | undefined): boolean {
  if (!attributes) return false;
  const category = typeof attributes.category === "string" ? attributes.category : "standard";
  return category === "free-time" && Number(attributes.urgency ?? 0) === 0;
}
