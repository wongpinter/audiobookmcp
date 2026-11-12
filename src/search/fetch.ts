export interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
}

export function parseTimeoutMs(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSignal(
  initSignal: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal | undefined; timeout: Promise<never> | undefined; cleanup: () => void } {
  if (!timeoutMs || timeoutMs <= 0) {
    return { signal: initSignal ?? undefined, timeout: undefined, cleanup: () => {} };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Request timed out after ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  let onAbort: (() => void) | undefined;
  if (initSignal) {
    if (initSignal.aborted) {
      controller.abort(initSignal.reason);
    } else {
      onAbort = () => controller.abort(initSignal.reason);
      initSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    timeout,
    cleanup: () => {
      clearTimeout(timer);
      if (onAbort && initSignal) initSignal.removeEventListener("abort", onAbort);
    },
  };
}

export async function fetchWithRateLimitRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  retriesOrOptions: number | FetchOptions = 2,
): Promise<Response> {
  const opts: FetchOptions = typeof retriesOrOptions === "number" ? { retries: retriesOrOptions } : retriesOrOptions;
  const retries = Math.max(0, Math.floor(opts.retries ?? 2));
  const timeoutMs = opts.timeoutMs;

  let lastNetworkError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { signal, timeout, cleanup } = buildSignal(init?.signal, timeoutMs);
    try {
      const request = (async () => {
        const response = await fetch(input, { ...init, signal });
        const retry = isRetryableStatus(response.status) && attempt < retries;
        if (retry || response.status === 204 || response.status === 205 || response.status === 304) {
          return { response, retry };
        }
        const body = await response.arrayBuffer();
        return {
          response: new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
          retry: false,
        };
      })();
      const result = timeout ? await Promise.race([request, timeout]) : await request;
      cleanup();
      if (!result.retry) return result.response;
      void result.response.body?.cancel().catch(() => undefined);
    } catch (error) {
      cleanup();
      lastNetworkError = error;
      if (init?.signal?.aborted || attempt >= retries) throw error;
    }
    if (init?.signal?.aborted) throw init.signal.reason ?? new Error("Request aborted");
    await delay(Math.min(1000 * (attempt + 1), 2000));
  }
  if (lastNetworkError) throw lastNetworkError;
  throw new Error("fetchWithRateLimitRetry exhausted retries");
}
