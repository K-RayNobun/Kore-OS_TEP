export interface Session {
  id: string;
  missionId: string;
  taskId?: number;
  priority: number;
  createdAt: number;
}

export class IpcSessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly maxAgeMs = 24 * 60 * 60 * 1000;

  public createSession(missionId: string, taskId: number | undefined, priority: number): string {
    const id = `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const session: Session = {
      id,
      missionId,
      priority,
      createdAt: Date.now()
    };
    if (taskId !== undefined) {
      session.taskId = taskId;
    }
    this.sessions.set(id, session);
    return id;
  }

  public resolveSession(sessionId: string): Session | undefined {
    const s = this.sessions.get(sessionId);
    if (!s) return undefined;
    if (Date.now() - s.createdAt > this.maxAgeMs) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    return s;
  }

  public cleanupStaleSessions(maxAgeMs = this.maxAgeMs): void {
    const now = Date.now();
    for (const [id, s] of this.sessions.entries()) {
      if (now - s.createdAt > maxAgeMs) {
        this.sessions.delete(id);
      }
    }
  }

  public getAll(): Session[] {
    this.cleanupStaleSessions();
    return Array.from(this.sessions.values());
  }
}
