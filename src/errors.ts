/** Fetch error with optional HTTP status code, thrown instead of returned as strings. */
export class FetchError extends Error {
  readonly statusCode?: number;
  readonly url?: string;
  code?: string;

  constructor(message: string, opts: { statusCode?: number; url?: string; code?: string } = {}) {
    super(message);
    this.name = "FetchError";
    this.statusCode = opts.statusCode;
    this.url = opts.url;
    this.code = opts.code;
  }
}

export function toFetchErrorMessage(error: unknown): string {
  if (error instanceof FetchError) {
    const base = `${error.name}: ${error.message}`;
    return error.statusCode ? `${base} [http ${error.statusCode}]` : base;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** Stable code attached to deadline-expiry errors (fetch + search share it). */
export const DEADLINE_HIT_CODE = "deadline.hit";

export function createDeadlineError(message: string, url?: string): FetchError {
  return new FetchError(message, url === undefined ? { code: DEADLINE_HIT_CODE } : { url, code: DEADLINE_HIT_CODE });
}

export function isDeadlineHitError(e: unknown): boolean {
  return e instanceof FetchError && e.code === DEADLINE_HIT_CODE;
}