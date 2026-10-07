#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "./server.js";

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  console.log(VERSION);
  process.exit(0);
}
if (arg === "--help" || arg === "-h") {
  console.log(`reveal-mcp ${VERSION}
MCP server (stdio) for creating reveal.js presentations.

Environment:
  REVEAL_MCP_HOME          Storage folder (default ~/reveal-mcp)
  REVEAL_MCP_CHROME        Chrome/Chromium/Edge executable for PDF export
  REVEAL_MCP_PREVIEW_PORT  Fixed port for the preview server (default random)`);
  process.exit(0);
}

const server = createServer();
await server.connect(new StdioServerTransport());
