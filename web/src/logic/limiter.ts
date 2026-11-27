export type Limiter = <T>(task: () => T | PromiseLike<T>) => Promise<T>;

/**
 * A task starts once fewer than `limit` earlier tasks are still running. Hold a slot only around
 * the request itself: a task that waits on the same limiter from inside its slot can deadlock it.
 */
export function createLimiter(limit: number): Limiter {
    let active = 0;
    const queue: (() => void)[] = [];
    const next = () => {
        if (active >= limit) return;
        const start = queue.shift();
        if (!start) return;
        active++;
        start();
    };
    return <T>(task: () => T | PromiseLike<T>) =>
        new Promise<T>((resolve, reject) => {
            queue.push(() => {
                Promise.resolve()
                    .then(task)
                    .then(resolve, reject)
                    .finally(() => {
                        active--;
                        next();
                    });
            });
            next();
        });
}
