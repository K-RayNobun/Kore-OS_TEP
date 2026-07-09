// src/utils/task_queue.ts

export class ConcurrencyLimiter {
    private activeCount = 0;
    private readonly maxConcurrency: number;
    private queue: Array<() => void> = [];

    constructor(maxConcurrency: number) {
        this.maxConcurrency = maxConcurrency;
    }

    public async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.activeCount >= this.maxConcurrency) {
            await new Promise<void>(resolve => this.queue.push(resolve));
        }
        this.activeCount++;
        try {
            return await fn();
        } finally {
            this.activeCount--;
            if (this.queue.length > 0) {
                this.queue.shift()!();
            }
        }
    }
}

export const heavyTaskQueue = new ConcurrencyLimiter(2);
