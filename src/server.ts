import dotenv from "dotenv";
import { fetchWeb } from "./tools/fetchWeb.js";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { browshManager } from "./browshManager.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

// Define the tool schema using the pattern from the sample code.
// This provides a structured and validated way to declare your tool's capabilities.
const FetchWebTool = ToolSchema.parse({
  name: "fetch_web",
  title: "Fetch Web (plain, html, markdown)",
  description:
    "Fetch a web page and return its content as plain text, HTML, or Markdown. Uses a JS-capable browser for dynamic sites.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The HTTP/HTTPS web URL to fetch",
      },
      type: {
        type: "string",
        enum: ["plain", "html", "markdown"],
        description: "The output type: plain, html, or markdown",
      },
    },
    required: ["url", "type"],
  },
});

async function runServer() {
  const server = new Server(
    {
      name: "blowsh-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Set up a request handler for listing available tools.
  // This is a standard part of the MCP that allows clients to discover what tools the server offers.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [FetchWebTool],
    };
  });

  // Set up a request handler for calling tools.
  // This is where the logic for executing your tool will reside.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === FetchWebTool.name) {
      // It's good practice to validate the incoming arguments against a schema.
      const inputSchema = z.object({
        url: z.string(),
        type: z.enum(["plain", "html", "markdown"]),
      });

      try {
        const { url, type } = inputSchema.parse(args);
        const result = await fetchWeb({ url, type });
        return { content: [{ type: "text", text: result }] };
      } catch (error) {
        // Handle potential validation or execution errors gracefully.
        const errorMessage =
          error instanceof Error ? error.message : "An unknown error occurred.";
        return {
          content: [
            {
              type: "text",
              text: `Error executing fetch_web: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    }

    // If the requested tool is not found, return an error.
    return {
      content: [{ type: "text", text: `Tool '${name}' not found.` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("blowsh-mcp MCP server running on stdio");

  const shutdown = async (signal?: string | Error) => {
    try {
      await browshManager.shutdown();
      if (signal) {
        console.error(`Gracefully shutting down (reason: ${signal})`);
      }
    } catch (e) {
      console.error("Shutdown error:", e);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT").then(() => process.exit(0)));
  process.on("SIGTERM", () => shutdown("SIGTERM").then(() => process.exit(0)));
  process.on("exit", () => {
    shutdown("process exit");
  });
  process.on("uncaughtException", (err) => {
    shutdown(err).then(() => {
      process.exit(1);
    });
  });
  process.on("unhandledRejection", (reason) => {
    shutdown(reason instanceof Error ? reason : new Error(String(reason))).then(
      () => {
        process.exit(1);
      }
    );
  });
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
