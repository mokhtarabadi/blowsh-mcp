/** Fetch error with optional HTTP status code, thrown instead of returned as strings. */
export class FetchError extends Error {
  readonly statusCode?: number;
  readonly url?: string;

  constructor(message: string, opts: { statusCode?: number; url?: string } = {}) {
    super(message);
    this.name = "FetchError";
    this.statusCode = opts.statusCode;
    this.url = opts.url;
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