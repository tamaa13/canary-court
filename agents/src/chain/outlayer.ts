/** OutLayer testnet queue awareness (public API): only 2 shared executors, NEAR yield timeout = 200 blocks. */
const API = process.env.OUTLAYER_API || 'https://testnet-api.outlayer.ai';

async function idleExecutors(): Promise<{ idle: number; total: number } | null> {
  try {
    const ws = (await (await fetch(`${API}/public/workers`, { signal: AbortSignal.timeout(8000) })).json()) as { worker_id: string; status: string; current_task_id: string | null }[];
    const ex = ws.filter((w) => w.worker_id.includes('executor') && w.status === 'online');
    return { idle: ex.filter((w) => !w.current_task_id).length, total: ex.length };
  } catch {
    return null; // API unreachable: don't block on it
  }
}

/** Wait until at least one executor is idle; false if the queue stays busy longer than `maxMs`. */
export async function waitForIdleExecutor(maxMs = 90_000): Promise<boolean> {
  const end = Date.now() + maxMs;
  for (;;) {
    const s = await idleExecutors();
    if (!s || s.idle > 0) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
