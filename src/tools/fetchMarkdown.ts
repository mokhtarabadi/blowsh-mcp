import { browshManager } from '../browshManager.js';
import TurndownService from 'turndown';
import { load } from 'cheerio';

/**
 * Fetch a live web page, execute all JavaScript, and return a Markdown summary of its DOM.
 *
 * @tool
 * @doc
 * For AIs and agents: Use this tool to get a Markdown snapshot of any webpage _as rendered in a real browser_.
 * This is ideal for large-context summarization, semantic search, data extraction, or sending readable site extracts to LLMs.
 * Uses JS rendering, then robust Markdown conversion. AI clients receive clean markdown; links, structure, and most elements will be preserved.
 * If the page is not a valid HTML site or fails to load, an error string will be returned.
 *
 * @param {Object} params
 * @param {string} params.url - The HTTPS or HTTP URL to fetch. Must be http(s)://
 * @returns {Promise<string>} Clean Markdown version of the requested page, or a clear error string.
 */
export async function fetch_markdown({ url }: { url: string }): Promise<string> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Error: URL must start with http:// or https://';
  }
  try {
    await browshManager.ensureStarted();
    const html = await browshManager.fetchDom(url);

    // Debug dump: helps diagnose bad input from Browsh (catch to avoid leaking ultra-long HTML too much)
    if (process.env.NODE_ENV !== "production") {
      try {
        // Print first 1000 chars for brief inspection
        console.error('fetchMarkdown DEBUG html:', html.slice(0, 1000));
      } catch {}
    }

    // Use cheerio to extract the body HTML, if it exists
    let mainHtml = html;
    try {
      const $ = load(html);
      const body = $("body");
      if (body.length > 0) {
        mainHtml = body.html() || "";
      }
    } catch (e) {
      // If cheerio explodes, log and fallback to all HTML
      if (process.env.NODE_ENV !== "production") {
        console.error('fetchMarkdown cheerio error:', e);
      }
    }

    const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', hr: '---' });
    const markdown = turndownService.turndown(mainHtml);
    return markdown;
  } catch (e: any) {
    return `Markdown conversion failed: ${e.message}\n${e.stack ?? ''}`;
  }
}