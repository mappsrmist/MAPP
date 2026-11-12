import "server-only";

/**
 * Admission gate (a small in-process queue). At most `maxActive` jobs run at once; extra callers wait
 * their turn in FIFO order. A caller that waits longer than `maxWaitMs`, or arrives when `maxQueue` are
 * already waiting, gets `null` so the route can answer "busy, retry" instead of piling more load on the
 * database. This keeps a login rush from overwhelming a small Supabase instance.
 */
export function createGate(maxActive: number, maxWaitMs: number, maxQueue: number) {
  let active = 0;
  const waiting: { start: () => void }[] = [];

  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next.start();
  };

  return {
    async run<T>(job: () => Promise<T>): Promise<T | null> {
      if (active >= maxActive) {
        if (waiting.length >= maxQueue) return null;
        const admitted = await new Promise<boolean>((resolve) => {
          const entry = {
            start: () => {
              clearTimeout(timer);
              active++;
              resolve(true);
            },
          };
          const timer = setTimeout(() => {
            const i = waiting.indexOf(entry);
            if (i >= 0) waiting.splice(i, 1);
            resolve(false);
          }, maxWaitMs);
          waiting.push(entry);
        });
        if (!admitted) return null;
      } else {
        active++;
      }
      try {
        return await job();
      } finally {
        release();
      }
    },
    stats: () => ({ active, waiting: waiting.length }),
  };
}
