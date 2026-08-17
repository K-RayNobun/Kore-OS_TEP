import * as dbHelper from "./database_helper.js";

export interface AgentCheckpointState {
  currentStep: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
  missionId: string;
  taskId?: number;
  maxStepsPerTask: number;
}

export class CheckpointManager {
  private readonly checkpointIntervalSteps = 5;

  public shouldCheckpoint(iteration: number): boolean {
    return iteration > 0 && iteration % this.checkpointIntervalSteps === 0;
  }

  public async writeCheckpoint(params: {
    missionId: string;
    taskId: number;
    iteration: number;
    agentState: AgentCheckpointState;
    taskStateJson: string;
    sandboxStateJson?: string;
    tokenSnapshotJson?: string;
    budgetSnapshotJson?: string;
    interruptionReason?: string;
  }): Promise<void> {
    const tokenSnapshot = JSON.stringify({
      inputTokens: params.agentState.inputTokens,
      outputTokens: params.agentState.outputTokens,
      startedAt: params.agentState.startedAt
    });
    const budgetSnapshot = JSON.stringify({
      allocated: 50000,
      consumed: params.agentState.inputTokens + params.agentState.outputTokens
    });
    const checkpointParams: {
      missionId: string;
      taskId: number;
      loopIteration: number;
      agentStateJson: string;
      taskStateJson: string;
      sandboxStateJson?: string;
      tokenSnapshotJson?: string;
      budgetSnapshotJson?: string;
      interruptionReason?: string;
    } = {
      missionId: params.missionId,
      taskId: params.taskId,
      loopIteration: params.iteration,
      agentStateJson: JSON.stringify(params.agentState),
      taskStateJson: params.taskStateJson
    };
    if (params.sandboxStateJson !== undefined) checkpointParams.sandboxStateJson = params.sandboxStateJson;
    checkpointParams.tokenSnapshotJson = tokenSnapshot;
    checkpointParams.budgetSnapshotJson = budgetSnapshot;
    if (params.interruptionReason !== undefined) checkpointParams.interruptionReason = params.interruptionReason;
    dbHelper.createMissionCheckpoint(checkpointParams);
    console.error("[CHECKPOINT_MANAGER] Wrote checkpoint", { missionId: params.missionId, iteration: params.iteration });
  }

  public getLatestCheckpoint(missionId: string): { agentState: AgentCheckpointState; taskStateJson: string } | null {
    const row = dbHelper.getLatestCheckpoint(missionId);
    if (!row) return null;
    try {
      const agentState: AgentCheckpointState = JSON.parse(row.agent_state_json as string);
      const taskStateJson = row.task_state_json as string;
      return { agentState, taskStateJson };
    } catch {
      console.error("[CHECKPOINT_MANAGER] Corrupt checkpoint, discarding", { missionId });
      return null;
    }
  }

  public getAllCheckpoints(missionId: string): AgentCheckpointState[] {
    const rows = dbHelper.getCheckpointsByMission(missionId);
    return rows
      .map((row) => {
        try {
          return JSON.parse(row.agent_state_json as string) as AgentCheckpointState;
        } catch {
          return null;
        }
      })
      .filter((s): s is AgentCheckpointState => s !== null);
  }
}

export const checkpointManager = new CheckpointManager();
