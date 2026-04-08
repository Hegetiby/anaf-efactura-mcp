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
    const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
    const port = parseInt(process.env.MCP_PORT || "3800", 10);
    const transports = new Map();

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", name, uptime: process.uptime() }));
        return;
      }

      if (url.pathname === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/message", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        res.on("close", () => { transports.delete(sessionId); console.error(`[${name}] Session closed: ${sessionId}`); });
        await server.connect(transport);
        console.error(`[${name}] SSE session: ${sessionId}`);
        return;
      }

      if (url.pathname === "/message" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = transports.get(sessionId);
        if (!transport) { res.writeHead(404); res.end("Session not found"); return; }
        await transport.handlePostMessage(req, res);
        return;
      }

      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name, transport: "sse", endpoints: { sse: "/sse", message: "/message", health: "/health" }, active_sessions: transports.size }));
        return;
      }

      res.writeHead(404); res.end("Not found");
    });

    httpServer.listen(port, "0.0.0.0", () => { console.error(`[${name}] SSE on port ${port}`); });
    for (const sig of ["SIGINT", "SIGTERM"]) {
      process.on(sig, () => { for (const t of transports.values()) t.close?.(); httpServer.close(() => process.exit(0)); });
    }
    return;
  }

  throw new Error(`Unknown MCP_TRANSPORT: ${mode}`);
}
