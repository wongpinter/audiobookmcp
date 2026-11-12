export class SearchProviderHttpError extends Error {
  constructor(readonly provider: string, readonly status: number) {
    super(`${provider} returned HTTP ${status}`);
    this.name = "SearchProviderHttpError";
  }
}

export function isRetryableSearchProviderError(error: unknown): boolean {
  if (!(error instanceof SearchProviderHttpError)) return false;
  return error.status === 408 || error.status === 429 ||
    (error.status >= 500 && error.status <= 599);
}
