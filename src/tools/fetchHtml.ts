import { browshManager } from '../browshManager.js';

/**
 * Fetches a JS-rendered HTML (DOM) of the provided URL using Browsh.
 *
 * @param {Object} params
 * @param {string} params.url - The web URL to be rendered via Browsh and returned as HTML (fully JavaScript-executed DOM).
 * @returns {Promise<string>} The HTML DOM as a string, or a detailed error message.
 * @tool
 * @doc
 * This tool enables AI agents to fetch the DOM of web pages after full JavaScript execution.
 * Browsers requiring JS, modern dynamic sites, and SPAs are supported.
 * Useful for scraping, parsing, or extracting DOM elements and attributes.
 */
export async function fetch_html({ url }: { url: string }): Promise<string> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Error: URL must start with http:// or https://';
  }
  try {
    await browshManager.ensureStarted();
    return await browshManager.fetchDom(url);
  } catch (e: any) {
    return `Browsh fetch failed: ${e.message}\n${e.stack ?? ''}`;
  }
}