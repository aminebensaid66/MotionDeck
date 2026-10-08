#!/usr/bin/env node
import { VERSION } from "./version.js";

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  console.log(VERSION);
  process.exit(0);
}
if (arg === "doctor" || arg === "--doctor") {
  await import("./doctor.js");
  process.exit(process.exitCode ?? 0);
}
if (arg === "--help" || arg === "-h") {
  console.log(`motiondeck ${VERSION}
MCP server (stdio) for creating reveal.js presentations.

Usage:
  motiondeck            Start the MCP server (your AI client runs this)
  motiondeck doctor     Check Node, Chrome, ffmpeg and settings

Environment:
  MOTIONDECK_HOME             Storage folder (default ~/motiondeck)
  MOTIONDECK_SECURITY_MODE    safe (default), strict or trusted
  MOTIONDECK_ASSET_ROOTS      Allowed local asset folders in strict mode
  MOTIONDECK_REMOTE_HOSTS     Comma-separated HTTPS asset hosts allowed in strict mode
  MOTIONDECK_CHROME           Chrome/Chromium/Edge executable for rendering
  MOTIONDECK_PREVIEW_PORT     Fixed preview port (default random)
  MOTIONDECK_ALLOW_BUILTIN_CDN 1 to load fonts, Mermaid and KaTeX from CDNs in strict mode
  MOTIONDECK_UNRESTRICTED_OUTPUT 1 in trusted mode to export outside the data directory
  MOTIONDECK_NO_SANDBOX       1 only when Chromium sandbox cannot run`);
  process.exit(0);
}

const [{ StdioServerTransport }, { createServer }] = await Promise.all([
  import("@modelcontextprotocol/sdk/server/stdio.js"),
  import("./server.js"),
]);

const server = createServer();
await server.connect(new StdioServerTransport());
