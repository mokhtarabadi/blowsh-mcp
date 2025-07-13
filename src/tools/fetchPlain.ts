import { browshManager } from '../browshManager.js';

/**
 * Fetches a plain-text rendering of the provided URL using Browsh (a full JavaScript-capable terminal browser).
 *
 * @param {Object} params
 * @param {string} params.url - The web URL to be rendered via Browsh and returned in raw plain text form.
 * @returns {Promise<string>} The page content rendered as plain text, or a detailed error message.
 * @tool
 * @doc
 * This tool enables AI agents to fetch web pages that require JavaScript rendering. It launches Browsh in HTTP server mode on the first request, keeps it alive for the server's lifetime, and uses it to return any requested page as a `lynx --dump`-style plain text (JS-enabled).
 */
export async function fetch_plain({ url }: { url: string }): Promise<string> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Error: URL must start with http:// or https://';
  }
  try {
    await browshManager.ensureStarted();
    return await browshManager.fetchPlain(url);
  } catch (e: any) {
    return `Browsh fetch failed: ${e.message}\n${e.stack ?? ''}`;
  }
}