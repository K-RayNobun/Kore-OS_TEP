export type EngineState = "IDLE" | "RUNNING" | "AWAITING_HUMAN" | "COMPLETED";

export interface StateChangePayload {
  state: EngineState;
  mission_id?: string;
  task_id?: number;
  detail?: string;
}

export class EngineStateMachine {
  private state: EngineState = "IDLE";
  private readonly ipcBroadcaster: ((frame: Record<string, unknown>) => void) | null;
  private readonly missions = new Map<string, EngineState>();

  constructor(ipcBroadcaster: ((frame: Record<string, unknown>) => void) | null = null) {
    this.ipcBroadcaster = ipcBroadcaster;
  }

  public getGlobalState(): EngineState {
    return this.state;
  }

  public getMissionState(missionId: string): EngineState {
    return this.missions.get(missionId) || "IDLE";
  }

  public setGlobalState(newState: EngineState, payload?: Partial<StateChangePayload>): void {
    if (this.state === newState) return;
    const previous = this.state;
    this.state = newState;
    this.emit({ state: newState, ...payload });
  }

  public setMissionState(missionId: string, newState: EngineState, payload?: Partial<StateChangePayload>): void {
    const previous = this.missions.get(missionId);
    if (previous === newState) return;
    this.missions.set(missionId, newState);
    this.emit({ state: newState, mission_id: missionId, ...payload });
    const anyMissionRunning = Array.from(this.missions.values()).some((s) => s === "RUNNING" || s === "AWAITING_HUMAN");
    if (!anyMissionRunning) {
      this.state = "IDLE";
    } else if (newState === "AWAITING_HUMAN") {
      this.state = "AWAITING_HUMAN";
    } else {
      this.state = "RUNNING";
    }
  }

  public resolveMission(missionId: string): void {
    this.missions.delete(missionId);
    const anyRunning = Array.from(this.missions.values()).some((s) => s === "RUNNING" || s === "AWAITING_HUMAN");
    this.state = anyRunning ? "RUNNING" : "IDLE";
    this.emit({ state: this.state });
  }

  private emit(payload: StateChangePayload): void {
    this.ipcBroadcaster?.({ type: "state_change", payload });
  }
}
