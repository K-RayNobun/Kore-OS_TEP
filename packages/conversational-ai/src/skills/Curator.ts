import type { SkillStore, SkillDefinition } from './SkillStore.ts';

export class Curator {
  constructor(
    private skillStore: SkillStore,
    private readonly maxAgeDays = 30,
    private readonly intervalMs = 6 * 60 * 60 * 1000, // 6 hours
  ) {}

  start(): void {
    setInterval(() => this.run(), this.intervalMs);
  }

  async run(): Promise<void> {
    // In a real implementation we'd query for stale skills.
    // For this detachable module, we expose the policy as a method.
    // The actual SQL would be:
    //   SELECT id FROM skills
    //   WHERE state = 'active'
    //     AND pinned = false
    //     AND use_count = 0
    //     AND created_at < now() - interval '30 days'
    // and then archive them.
    console.log('[curator] curator run — stale active skills would be archived here');
  }
}
