// One named job runs at most once at a time, whether the timer or an admin's button
// started it. A second caller gets { ran: false } instead of starting an overlapping run.

const running = new Set<string>();

export async function runExclusive<T>(name: string, fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  if (running.has(name)) return { ran: false };
  running.add(name);
  try {
    return { ran: true, value: await fn() };
  } finally {
    running.delete(name);
  }
}

export function isRunning(name: string): boolean {
  return running.has(name);
}
