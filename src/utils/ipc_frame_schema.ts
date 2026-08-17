import { z } from "zod";

export const PromptSubmitSchema = z.object({
  type: z.literal("prompt_submit"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string().optional(),
    prompt: z.string(),
    priority: z.number().optional(),
    budget_tokens: z.number().optional(),
    resume_from: z.string().optional(),
    attributes: z.any().optional()
  })
});

export const HumanDirectiveSchema = z.object({
  type: z.literal("human_directive"),
  session_id: z.string().optional(),
  payload: z.object({
    taskId: z.number(),
    approved: z.boolean(),
    choice: z.string().optional(),
    answer: z.string().optional()
  })
});

export const MissionCancelSchema = z.object({
  type: z.literal("mission_cancel"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string()
  })
});

export const MissionInterruptSchema = z.object({
  type: z.literal("mission_interrupt"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string(),
    force: z.boolean().optional()
  })
});

export const MissionPrioritySchema = z.object({
  type: z.literal("mission_priority"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string(),
    priority: z.number()
  })
});

export const MissionBudgetSchema = z.object({
  type: z.literal("mission_budget"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string(),
    tokens: z.number()
  })
});

export const MissionUpdateSchema = z.object({
  type: z.literal("mission_update"),
  session_id: z.string().optional(),
  payload: z.object({
    missions: z.array(z.any())
  })
});

export const BudgetUpdateSchema = z.object({
  type: z.literal("budget_update"),
  session_id: z.string().optional(),
  payload: z.object({
    pool: z.any()
  })
});

export const CheckpointSchema = z.object({
  type: z.literal("checkpoint"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string(),
    loop_iteration: z.number().optional()
  })
});

export const InterruptionSchema = z.object({
  type: z.literal("interruption"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string(),
    reason: z.string().optional(),
    tool: z.string().optional(),
    cleanup_ok: z.boolean().optional()
  })
});

export const AlertSchema = z.object({
  type: z.literal("alert"),
  session_id: z.string().optional(),
  payload: z.object({
    severity: z.enum(["info", "warning", "critical"]),
    message: z.string(),
    mission_id: z.string().optional()
  })
});

export const MissionPauseSchema = z.object({
  type: z.literal("mission_pause"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string()
  })
});

export const MissionResumeSchema = z.object({
  type: z.literal("mission_resume"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string()
  })
});

export const BudgetRefillSchema = z.object({
  type: z.literal("budget_refill"),
  session_id: z.string().optional(),
  payload: z.object({
    tokens: z.number()
  })
});

export const ThinkingSchema = z.object({
  type: z.literal("thinking"),
  session_id: z.string().optional(),
  payload: z.object({
    task_id: z.number().optional(),
    mission_id: z.string().optional(),
    thought: z.string(),
    action: z.string().optional(),
    parameters: z.any().optional(),
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional()
  })
});

export const ToolExecutionSchema = z.object({
  type: z.literal("tool_execution"),
  session_id: z.string().optional(),
  payload: z.object({
    task_id: z.number().optional(),
    mission_id: z.string().optional(),
    action: z.string().optional(),
    status: z.string().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    duration_ms: z.number().optional(),
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional()
  })
});

export const StateChangeSchema = z.object({
  type: z.literal("state_change"),
  session_id: z.string().optional(),
  payload: z.object({
    state: z.string(),
    mission_id: z.string().optional(),
    task_id: z.number().optional(),
    detail: z.string().optional()
  })
});

export const InterventionRequestSchema = z.object({
  type: z.literal("intervention_request"),
  session_id: z.string().optional(),
  payload: z.object({
    intervention_type: z.string(),
    task_id: z.number(),
    url: z.string().url().optional()
  })
});

export const ArtifactManifestSchema = z.object({
  type: z.literal("artifact_manifest"),
  session_id: z.string().optional(),
  payload: z.object({
    id: z.string(),
    mission_id: z.string(),
    task_id: z.number().optional(),
    file_name: z.string(),
    file_path: z.string(),
    file_size: z.number(),
    mime_type: z.string()
  })
});

export const TelemetryResponseSchema = z.object({
  type: z.literal("telemetry_response"),
  session_id: z.string().optional(),
  payload: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional()
  })
});

export const MissionCompleteSchema = z.object({
  type: z.literal("mission_complete"),
  session_id: z.string().optional(),
  payload: z.object({
    mission_id: z.string(),
    status: z.string(),
    total_duration_ms: z.number().optional()
  })
});

export const TelemetryHeartbeatSchema = z.object({
  type: z.literal("telemetry_heartbeat"),
  session_id: z.string().optional(),
  payload: z.object({
    ts: z.number(),
    cpu: z.number(),
    ram: z.number(),
    tokens: z.number(),
    burn_rate: z.number().optional(),
    ceil_active: z.boolean().optional(),
    budget_remaining: z.number().optional()
  })
});

export const AckSchema = z.object({
  type: z.literal("ack"),
  session_id: z.string().optional(),
  correlation_id: z.string(),
  payload: z.object({}).optional()
});

export const NakSchema = z.object({
  type: z.literal("nak"),
  session_id: z.string().optional(),
  correlation_id: z.string(),
  payload: z.object({
    reason: z.string()
  })
});

export const FrameSchema = z.union([
  PromptSubmitSchema,
  HumanDirectiveSchema,
  MissionPauseSchema,
  MissionResumeSchema,
  MissionCancelSchema,
  MissionInterruptSchema,
  MissionPrioritySchema,
  MissionBudgetSchema,
  MissionUpdateSchema,
  BudgetUpdateSchema,
  CheckpointSchema,
  InterruptionSchema,
  AlertSchema,
  BudgetRefillSchema,
  ThinkingSchema,
  ToolExecutionSchema,
  StateChangeSchema,
  InterventionRequestSchema,
  ArtifactManifestSchema,
  TelemetryResponseSchema,
  MissionCompleteSchema,
  TelemetryHeartbeatSchema,
  AckSchema,
  NakSchema
]);

export type TypedIpcFrame = z.infer<typeof FrameSchema>;

export function validateFrame(frame: Record<string, unknown>): TypedIpcFrame | null {
  try {
    return FrameSchema.parse(frame) as TypedIpcFrame;
  } catch {
    return null;
  }
}

export function isSessionFrame(frame: Record<string, unknown>): frame is { session_id?: string } {
  return typeof (frame as any).session_id === "string" || (frame as any).session_id === undefined;
}
