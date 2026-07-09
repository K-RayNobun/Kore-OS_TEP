import { dispatchTool, type ToolResult } from "./tool_dispatcher.js";

export interface DecisionInput {
  thought: string;
  action: string | null;
  parameters: Record<string, unknown>;
}

export interface ObservationResult {
  status: string;
  output?: unknown;
  error: string | undefined;
  executionTimeMs: number;
  validation_error: string | undefined;
  schema_used: string | undefined;
}

export class Interpreter {
  async interpret(decision: DecisionInput): Promise<ObservationResult | null> {
    if (!decision.action) {
      return null;
    }

    try {
      const result = await dispatchTool(decision.action as any, decision.parameters);
      return {
        status: result.status,
        output: result.output,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
        validation_error: result.validation_error,
        schema_used: result.schema_used
      };
    } catch (error: any) {
      return {
        status: "INVALID_PARAMETERS",
        output: undefined,
        error: `Parameter validation failed: ${error.message || String(error)}`,
        executionTimeMs: 0,
        validation_error: error.message || String(error),
        schema_used: undefined
      };
    }
  }
}
