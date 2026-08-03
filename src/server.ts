import dotenv from "dotenv";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { browshManager } from "./browshManager.js";
import { toFetchErrorMessage } from "./errors.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fetchWeb } from "./tools/fetchWeb.js";
import { searchWeb } from "./tools/searchWeb.js";
import { extractLinks } from "./tools/extractLinks.js";
import { fetchWebBatch } from "./tools/fetchWebBatch.js";

dotenv.config({ quiet: true });

const tools = [
  ToolSchema.parse({
    name: "fetch_web",
    title: "Fetch Web (plain, html, markdown, pdf)",
    description:
      "Fetch a web page and return its content as plain text, HTML, Markdown, or PDF-extracted text after full JS rendering. " +
      "Use `type` to select the output shape; `selector` (CSS) to extract only the matched element; " +
      "`max_chars` to cap output length; `wait_ms` to keep polling until the page's JavaScript has settled. " +
      "`type: \"pdf\"` downloads the PDF directly (SSRF-guarded, 20 MB cap) and extracts text via pdftotext — " +
      "`selector`, `max_chars`, and `wait_ms` are ignored for PDFs.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The HTTP/HTTPS web URL to fetch" },
        type: { type: "string", enum: ["plain", "html", "markdown", "pdf"], description: "Output type: plain, html, markdown, or pdf (text)" },
        selector: { type: "string", description: "Optional CSS selector; only the matched element is returned (ignored for pdf)" },
        max_chars: { type: "number", description: "Optional cap on output length in characters (ignored for pdf)" },
        wait_ms: { type: "number", description: "Optional JS settle polling budget in ms (default 0 = single render; ignored for pdf)" },
      },
      required: ["url", "type"],
    },
  }),
  ToolSchema.parse({
    name: "search_web",
    title: "Search the web",
    description:
      "Search the web through a rendered search engine and return ranked results (title, url, snippet). " +
      "Use to discover pages, then feed URLs to fetch_web/extract_links.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "number", description: "Max results to return (1-30, default 10)" },
        page: { type: "number", description: "Result page (1-10, default 1); offsets are synthesized per engine" },
        enrich: { type: "boolean", description: "When true, top-3 snippets are replaced with fetched markdown (best-effort)" },
      },
      required: ["query"],
    },
  }),
  ToolSchema.parse({
    name: "extract_links",
    title: "Extract links from a page",
    description:
      "Return the hyperlinks (text + absolute URL) found on the JS-rendered page. " +
      "Useful for following navigation without fetching the full DOM.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The HTTP/HTTPS web URL" },
        limit: { type: "number", description: "Max links to return (1-200, default 50)" },
      },
      required: ["url"],
    },
  }),
  ToolSchema.parse({
    name: "fetch_web_batch",
    title: "Fetch multiple web pages",
    description:
      "Fetch up to 10 URLs in one call, reusing the render cache. Returns per-URL results; a failing " +
      "URL does not fail the whole batch.",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "1-10 HTTP/HTTPS URLs" },
        type: { type: "string", enum: ["plain", "html", "markdown"], description: "Output type" },
        selector: { type: "string", description: "Optional CSS selector applied to each page" },
        max_chars: { type: "number", description: "Optional per-page cap on output length" },
        wait_ms: { type: "number", description: "Optional JS settle polling budget (ms)" },
      },
      required: ["urls", "type"],
    },
  }),
] as const;

type ToolName = (typeof tools)[number]["name"];

const selectors = {
  fetch_web: z.object({
    url: z.string(),
    type: z.enum(["plain", "html", "markdown", "pdf"]),
    selector: z.string().optional(),
    max_chars: z.number().int().min(100).max(2_000_000).optional(),
    wait_ms: z.number().int().min(0).max(60_000).optional(),
  }),
  search_web: z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(30).optional(),
    page: z.number().int().min(1).max(10).optional(),
    enrich: z.boolean().optional(),
  }),
  extract_links: z.object({
    url: z.string(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  fetch_web_batch: z.object({
    urls: z.array(z.string()).min(1).max(10),
    type: z.enum(["plain", "html", "markdown"]),
    selector: z.string().optional(),
    max_chars: z.number().int().min(100).max(2_000_000).optional(),
    wait_ms: z.number().int().min(0).max(60_000).optional(),
  }),
} satisfies Record<ToolName, z.ZodType>;

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: false };
}

function errorResponse(error: unknown) {
  return { content: [{ type: "text" as const, text: toFetchErrorMessage(error) }], isError: true };
}

async function route(name: ToolName, args: unknown): Promise<string> {
  switch (name) {
    case "fetch_web": {
      const { url, type, selector, max_chars, wait_ms } = selectors.fetch_web.parse(args);
      return fetchWeb({ url, type, selector, max_chars, wait_ms });
    }
    case "search_web": {
      const { query, max_results, page, enrich } = selectors.search_web.parse(args);
      return JSON.stringify(
        await searchWeb(query, max_results ?? 10, page ?? 1, enrich ?? false),
        null,
        2
      );
    }
    case "extract_links": {
      const { url, limit } = selectors.extract_links.parse(args);
      return JSON.stringify(await extractLinks(url, limit), null, 2);
    }
    case "fetch_web_batch": {
      const { urls, type, selector, max_chars, wait_ms } = selectors.fetch_web_batch.parse(args);
      return JSON.stringify(await fetchWebBatch({ urls, type, selector, max_chars, wait_ms }), null, 2);
    }
    default:
      throw new Error(`Unhandled tool: ${name}`);
  }
}

async function runServer() {
  const server = new Server(
    {
      name: "blowsh-mcp",
      version: "2.1.0",
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.slice() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const toolName = name as ToolName;
    if (!(toolName in selectors)) {
      return errorResponse(new Error(`Tool '${name}' not found.`));
    }
    try {
      return textResponse(await route(toolName, request.params.arguments));
    } catch (error) {
      return errorResponse(error);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("blowsh-mcp MCP server running on stdio");

  const shutdown = async (signal?: string | Error) => {
    try {
      await browshManager.shutdown();
      if (signal) console.error(`Gracefully shutting down (reason: ${signal})`);
    } catch (e) {
      console.error("Shutdown error:", e);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT").then(() => process.exit(0)));
  process.on("SIGTERM", () => shutdown("SIGTERM").then(() => process.exit(0)));
  process.on("exit", () => void shutdown("process exit"));
  process.on("uncaughtException", (err) => {
    void shutdown(err).then(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    void shutdown(reason instanceof Error ? reason : new Error(String(reason))).then(() => process.exit(1));
  });
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});