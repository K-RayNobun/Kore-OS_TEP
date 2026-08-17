export interface MissionState {
  mission_id: string;
  state: "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "UNKNOWN";
  priority: number;
  budget_allocated: number;
  budget_consumed: number;
  started_at: string | null;
  completed_at: string | null;
  prompt: string | null;
}

export interface TelemetryFrame {
  cpu: number;
  ram_used: number;
  ram_total: number;
  input_tokens: number;
  output_tokens: number;
  burn_rate: number;
  ceil_active: boolean;
  budget_remaining: number;
  budget_total: number;
}

export interface CognitionFrame {
  session_id?: string;
  intent: string;
  rationale: string;
}

export interface InterventionFrame {
  type: "intervention_request";
  session_id?: string;
  payload: {
    intervention_type: string;
    task_id: number;
    url: string;
  };
}

export interface StateChangeFrame {
  type: "state_change";
  session_id?: string;
  payload: {
    state: string;
    mission_id: string;
    task_id?: number;
    detail?: string;
  };
}
