export interface PolicyConfig {
  weightUrgency: number;
  weightImportance: number;
  categoryBias: Record<string, number>;
  reservePct: number;
}

const DEFAULT_POLICY: PolicyConfig = {
  weightUrgency: 12,
  weightImportance: 10,
  categoryBias: {
    urgent: 30,
    important: 20,
    "free-time": -20,
    periodic: 0,
    long: 5,
    standard: 0
  },
  reservePct: 0.1
};

export function getPolicy(): PolicyConfig {
  return DEFAULT_POLICY;
}
