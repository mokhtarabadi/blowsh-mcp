import { browshManager } from '../browshManager.js';
import TurndownService from 'turndown';
import { load } from 'cheerio';

/**
 * Fetches a web page and returns content in the requested format: plain, html, or markdown.
 * @param {Object} params
 * @param {string} params.url - The web URL to fetch (must start with http:// or https://)
 * @param {string} params.type - The output type: 'plain', 'html', or 'markdown'
 * @returns {Promise<string>} The page content in the requested format, or an error message.
 */
export async function fetchWeb({ url, type }: { url: string, type: 'plain' | 'html' | 'markdown' }): Promise<string> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'Error: URL must start with http:// or https://';
  }
  try {
    await browshManager.ensureStarted();
    if (type === 'plain') {
      return await browshManager.fetchPlain(url);
    } else if (type === 'html') {
      return await browshManager.fetchDom(url);
    } else if (type === 'markdown') {
      const html = await browshManager.fetchDom(url);
      let mainHtml = html;
      try {
        const $ = load(html);
        const body = $("body");
        if (body.length > 0) {
          mainHtml = body.html() || "";
        }
      } catch {}
      const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', hr: '---' });
      return turndownService.turndown(mainHtml);
    } else {
      return 'Error: Unknown type. Use one of: plain, html, markdown.';
    }
  } catch (e: any) {
    return `Fetch failed: ${e.message}\n${e.stack ?? ''}`;
  }
}
