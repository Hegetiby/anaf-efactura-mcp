import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "http";

export async function connectTransport(server, opts = {}) {
  const mode = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();
  const name = opts.name || "mcp-server";

  if (mode === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[${name}] Connected via stdio`);
    return;
  }

  if (mode === "sse") {
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const port = parseInt(process.env.MCP_PORT || "3800", 10);

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", name, uptime: process.uptime() }));
        return;
      }

      if (url.pathname === "/.well-known/mcp/server-card.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name, transport: { type: "http", url: "/mcp" } }));
        return;
      }

      if (url.pathname === "/mcp") {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name, transport: "streamable-http", endpoint: "/mcp" }));
        return;
      }

      res.writeHead(404); res.end("Not found");
    });

    httpServer.listen(port, "0.0.0.0", () => { console.error(`[${name}] Streamable HTTP on port ${port}`); });
    for (const sig of ["SIGINT", "SIGTERM"]) {
      process.on(sig, () => { httpServer.close(() => process.exit(0)); });
    }
    return;
  }

  throw new Error(`Unknown MCP_TRANSPORT: ${mode}`);
}
