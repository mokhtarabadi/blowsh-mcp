import axios from "axios";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { FetchError } from "../errors.js";
import { assertSafeUrl } from "../ssrf.js";

/** Default cap for PDF downloads (20 MB). Overridable via PDF_MAX_BYTES. */
const PDF_MAX_BYTES = Number(process.env.PDF_MAX_BYTES) || 20_971_520;

/**
 * Downloads a PDF (SSRF-guarded) and extracts its text via the `pdftotext`
 * CLI (poppler-utils). The raw bytes are streamed through a size-tracking
 * PassThrough — if the accumulated size exceeds the cap, the download is
 * aborted and the pdftotext process is killed to bound memory usage.
 *
 * Safety properties:
 * - `assertSafeUrl` runs BEFORE any network I/O (SSRF guard first).
 * - Content-Type must be `application/pdf`; anything else is rejected.
 * - `Content-Length` (when present) is checked up-front; streaming also
 *   enforces the cap for servers that omit the header.
 * - pdftotext is passive text extraction — it does not execute page scripts.
 *
 * @param url The HTTP(S) URL of the PDF document.
 * @param maxBytes Optional override of the size cap (bytes).
 * @returns The extracted plain text.
 * @throws {FetchError} On non-PDF content, size violations, download
 *   failures, or pdftotext failures. Never returns error strings.
 */
export async function extractPdf(url: string, maxBytes?: number): Promise<string> {
  await assertSafeUrl(url);
  const effectiveMax = maxBytes ?? PDF_MAX_BYTES;

  const response = await axios.get<NodeJS.ReadableStream>(url, {
    responseType: "stream",
    timeout: 30_000,
    maxRedirects: 5,
  });

  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/pdf")) {
    throw new FetchError(
      `URL did not return a PDF (Content-Type: ${contentType || "unknown"})`,
      { url }
    );
  }

  const lengthHeader = Number(response.headers["content-length"]);
  if (Number.isFinite(lengthHeader) && lengthHeader > effectiveMax) {
    throw new FetchError(`PDF exceeds maximum size of ${effectiveMax} bytes`, {
      url,
    });
  }

  const stream = response.data;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let received = 0;
    let stdout = "";
    let stderr = "";

    const proc = spawn("pdftotext", ["-", "-"]);
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(
        new FetchError(
          `pdftotext unavailable: ${err.message} (is poppler-utils installed?)`,
          { url }
        )
      );
    });
    proc.on("close", (code) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        resolve(stdout);
      } else {
        settled = true;
        reject(
          new FetchError(
            `PDF text extraction failed: ${stderr.trim() || `pdftotext exited with code ${code}`}`,
            { url }
          )
        );
      }
    });

    const tracker = new PassThrough();
    tracker.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > effectiveMax && !settled) {
        settled = true;
        proc.kill("SIGKILL");
        reject(new FetchError(`PDF exceeds maximum size of ${effectiveMax} bytes`, { url }));
      }
    });
    tracker.on("error", () => {
      /* downstream abort — ignore to avoid unhandled stream errors */
    });

    stream.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new FetchError(`PDF download failed: ${err.message}`, { url }));
    });

    tracker.pipe(proc.stdin);
    stream.pipe(tracker);
  });
}