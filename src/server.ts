import dotenv from "dotenv";
import { fetchWeb } from "./tools/fetchWeb.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

dotenv.config();

const server = new McpServer({
  name: "blowsh-mcp",
  version: "1.0.0"
});

server.registerTool(
  "fetch_web",
  {
    title: "Fetch Web (plain, html, markdown)",
    description: "Fetch a web page and return its content as plain text, HTML, or Markdown. Uses a JS-capable browser for dynamic sites.",
    inputSchema: {
      url: z.string().describe("The HTTP/HTTPS web URL to fetch"),
      type: z.enum(["plain", "html", "markdown"]).describe("The output type: plain, html, or markdown")
    }
  },
  async ({ url, type }: { url: string, type: 'plain' | 'html' | 'markdown' }) => {
    const result = await fetchWeb({ url, type });
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