import dotenv from "dotenv";
import { fetch_plain } from "./tools/fetchPlain.js";
import { fetch_html } from "./tools/fetchHtml.js";
import { fetch_markdown } from "./tools/fetchMarkdown.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

dotenv.config();

const server = new McpServer({
  name: "blowsh-mcp",
  version: "1.0.0"
});

// Register the fetch_plain tool
server.registerTool(
  "fetch_plain",
  {
    title: "Fetch Plain (AI-optimized web plain text)",
    description: "Render any dynamic web page in a JS-capable browser and extract main readable terminal text for summarization and search.",
    inputSchema: {
      url: z.string().describe("The HTTP/HTTPS web URL to fetch")
    }
  },
  async ({ url }: { url: string }) => {
    const result = await fetch_plain({ url });
    return { content: [{ type: "text", text: result }] };
  }
);

// Register the fetch_html tool
server.registerTool(
  "fetch_html",
  {
    title: "Fetch HTML (post-JS/DOM)",
    description: "Get the full, rendered HTML (DOM) of a web page, after all JavaScript, for parsing, scraping, or markup analysis.",
    inputSchema: {
      url: z.string().describe("The HTTP/HTTPS web URL to fetch")
    }
  },
  async ({ url }: { url: string }) => {
    const result = await fetch_html({ url });
    return { content: [{ type: "text", text: result }] };
  }
);

// Register the fetch_markdown tool
server.registerTool(
  "fetch_markdown",
  {
    title: "Fetch Markdown",
    description: "Get Markdown generated from a full JS-rendered DOM. Ideal for LLM context ingestion, semantic search, and AI markdown workflows.",
    inputSchema: {
      url: z.string().describe("The HTTP/HTTPS web URL to fetch")
    }
  },
  async ({ url }: { url: string }) => {
    const result = await fetch_markdown({ url });
    return { content: [{ type: "text", text: result }] };
  }
);

import { browshManager } from "./browshManager.js";

async function runServer() {
  // Setup shutdown on all termination signals
  const shutdown = async (signal?: string|Error) => {
    try {
      await browshManager.shutdown();
      if (signal) {
        console.error(`Gracefully shutting down (reason: ${signal})`);
      }
    } catch (e) {
      console.error("Shutdown error:", e);
    }
  };

  // Trap SIGINT/SIGTERM and process exit
  process.on("SIGINT", () => shutdown("SIGINT").then(() => process.exit(0)));
  process.on("SIGTERM", () => shutdown("SIGTERM").then(() => process.exit(0)));
  process.on("exit", () => { shutdown("process exit"); });
  process.on("uncaughtException", (err) => {
    shutdown(err).then(() => { process.exit(1); });
  });
  process.on("unhandledRejection", (reason) => {
    shutdown(reason instanceof Error ? reason : new Error(String(reason))).then(() => { process.exit(1); });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error("blowsh-mcp MCP server running on stdio");
}

runServer().catch(error => {
  // eslint-disable-next-line no-console
  console.error("Fatal error running server:", error);
  process.exit(1);
});