import * as dbHelper from "./database_helper.js";

const DEFAULT_POOL_TOKENS = 100000;
const MINIMUM_RESERVE_RATIO = 0.1;

export class BudgetPool {
  private totalAllocated = 0;
  private consumedByMission = new Map<string, number>();

  public initialize(totalTokens = DEFAULT_POOL_TOKENS): void {
    this.totalAllocated = totalTokens;
    this.consumedByMission.clear();
  }

  public allocate(missionId: string, tokens: number): boolean {
    const currentConsumed = this.consumedByMission.get(missionId) || 0;
    const newConsumed = currentConsumed + tokens;
    if (newConsumed > this.totalAllocated * (1 - MINIMUM_RESERVE_RATIO)) {
      console.error("[BUDGET_POOL] Refused allocation: insufficient reserve", { missionId, requested: tokens, total: this.totalAllocated, currentConsumed });
      return false;
    }
    this.consumedByMission.set(missionId, newConsumed);
    console.error("[BUDGET_POOL] Allocated", { missionId, tokens, totalConsumed: newConsumed, remaining: this.remaining() });
    return true;
  }

  public consume(missionId: string, tokens: number): void {
    const current = this.consumedByMission.get(missionId) || 0;
    this.consumedByMission.set(missionId, current + tokens);
    const entry = dbHelper.getMissionQueueEntry(missionId);
    if (entry) {
      dbHelper.updateMissionQueueStatus(missionId, entry.status, { budgetConsumed: (current + tokens) });
    }
  }

  public release(missionId: string): void {
    this.consumedByMission.delete(missionId);
    const entry = dbHelper.getMissionQueueEntry(missionId);
    if (entry) {
      dbHelper.updateMissionQueueStatus(missionId, entry.status, { budgetConsumed: 0 });
    }
  }

  public remaining(): number {
    const totalConsumed = Array.from(this.consumedByMission.values()).reduce((a, b) => a + b, 0);
    return Math.max(0, this.totalAllocated - totalConsumed);
  }

  public exhausted(requiredTokens: number = 0): boolean {
    return this.remaining() < requiredTokens;
  }

  public getConsumed(missionId: string): number {
    return this.consumedByMission.get(missionId) || 0;
  }

  public getTotalAllocated(): number {
    return this.totalAllocated;
  }

  public refill(additionalTokens: number): void {
    this.totalAllocated += additionalTokens;
    console.error("[BUDGET_POOL] Refilled", { newTotal: this.totalAllocated, remaining: this.remaining() });
  }

  public getMissionBudgetStatus(missionId: string): { allocated: number; consumed: number; remaining: number } {
    const consumed = this.consumedByMission.get(missionId) || 0;
    const entry = dbHelper.getMissionQueueEntry(missionId);
    const allocated = entry?.budget_allocated_tokens || 50000;
    return { allocated, consumed, remaining: Math.max(0, allocated - consumed) };
  }

  public getReserveTokens(): number {
    return Math.round(this.totalAllocated * MINIMUM_RESERVE_RATIO);
  }

  public getAllocations(): { missionId: string; allocated: number; consumed: number }[] {
    const result: { missionId: string; allocated: number; consumed: number }[] = [];
    for (const [missionId, consumed] of this.consumedByMission.entries()) {
      const entry = dbHelper.getMissionQueueEntry(missionId);
      const allocated = entry?.budget_allocated_tokens || 50000;
      result.push({ missionId, allocated, consumed });
    }
    return result;
  }

  public toDto(burnRatePerMin: number, ceilActive: boolean): Record<string, unknown> {
    return {
      totalTokens: this.totalAllocated,
      consumedTokens: Array.from(this.consumedByMission.values()).reduce((a, b) => a + b, 0),
      reserveTokens: this.getReserveTokens(),
      allocations: this.getAllocations(),
      burnRatePerMin: Math.round(burnRatePerMin * 100) / 100,
      ceilActive
    };
  }

  public isCeilingActive(ceilActiveFlag: boolean): boolean {
    return ceilActiveFlag && this.exhausted();
  }

  public gateMissionSpawn(ceilActiveFlag: boolean): boolean {
    return !this.isCeilingActive(ceilActiveFlag);
  }
}
