/** Race a promise against a timeout. The timer is always cleared, so it never keeps the process (or a test run) alive. */
export async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(onTimeout), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}
