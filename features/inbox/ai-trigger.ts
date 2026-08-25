/**
 * Run at most {@link limit} {@link operation} calls in parallel over the
 * {@link items} array, preserving the original order of completion callbacks.
 * Errors from one item never abort the remaining work.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  operation: (item: T, index: number) => Promise<R>,
  onResult: (index: number, result: R) => void,
): Promise<void> {
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let worker = 0; worker < safeLimit; worker += 1) {
    workers.push((async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        try {
          const result = await operation(items[index]!, index);
          onResult(index, result);
        } catch {
          // Each operation is responsible for reporting its own failure via onResult.
        }
      }
    })());
  }
  await Promise.all(workers);
}
