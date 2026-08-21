const tails = new Map<string, Promise<void>>();

/** Process-local only: Drive cannot provide cross-instance create-if-absent. */
export async function withKeyedLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;
  try { return await operation(); } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
