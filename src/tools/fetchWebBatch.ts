import { fetchWeb, type FetchWebOptions } from "./fetchWeb.js";
import { FetchError, toFetchErrorMessage } from "../errors.js";

export interface BatchItem {
  url: string;
  ok: boolean;
  content?: string;
  error?: string;
}

/**
 * Fetches multiple URLs sequentially (reusing the single Browsh instance and
 * the render cache). Returns per-URL results so one failure never kills the batch.
 * D1: an optional per-item deadline_ms bounds each item (slow items fail fast
 * with ok:false instead of stalling the whole batch); the remaining parity
 * options (focus/toc/section/archive/...) stay single-fetch-only by contract.
 */
export async function fetchWebBatch(opts: {
  urls: string[];
  type: FetchWebOptions["type"];
  selector?: string;
  max_chars?: number;
  wait_ms?: number;
  deadline_ms?: number;
}): Promise<BatchItem[]> {
  const { urls, type, selector, max_chars, wait_ms, deadline_ms } = opts;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 10) {
    throw new FetchError("urls must be a non-empty array of at most 10 URLs");
  }

  const results: BatchItem[] = [];
  for (const url of urls) {
    try {
      const content = await fetchWeb({ url, type, selector, max_chars, wait_ms, deadline_ms });
      results.push({ url, ok: true, content });
    } catch (e) {
      results.push({ url, ok: false, error: toFetchErrorMessage(e) });
    }
  }
  return results;
}