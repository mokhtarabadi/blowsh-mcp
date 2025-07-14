import { spawn } from 'child_process';

/**
 * Wrapper for the html2markdown CLI tool.
 * Converts HTML to Markdown using the html2markdown binary.
 *
 * @param html The HTML string to convert.
 * @param options Optional CLI options (e.g., domain, plugins).
 * @returns The converted Markdown string.
 */
export async function html2markdownConvert(html: string, options: { domain?: string, plugins?: string[] } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const args: string[] = [];
    if (options.domain) {
      args.push(`--domain=${options.domain}`);
    }
    if (options.plugins) {
      for (const plugin of options.plugins) {
        args.push(`--plugin-${plugin}`);
      }
    }
    const bin = process.env.HTML2MARKDOWN_PATH || 'html2markdown';
    const proc = spawn(bin, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `${bin} exited with code ${code}`));
      }
    });
    proc.stdin.write(html);
    proc.stdin.end();
  });
}
