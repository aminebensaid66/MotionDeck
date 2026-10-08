#!/usr/bin/env node
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { findBrowser } from "./browser.js";
import { findFfmpeg } from "./video.js";
import { assetRoots, securityMode } from "./security.js";
import { VERSION } from "./version.js";

const require = createRequire(import.meta.url);
const configuredHome = process.env.MOTIONDECK_HOME
  ? path.resolve(process.env.MOTIONDECK_HOME.replace(/^~(?=$|[\\/])/, os.homedir()))
  : path.join(os.homedir(), "motiondeck");
const runtimePackages = ["@modelcontextprotocol/sdk", "marked", "puppeteer-core", "reveal.js", "sanitize-html", "zod"];
const dependencies = Object.fromEntries(
  runtimePackages.map((name) => {
    try {
      require.resolve(name);
      return [name, true];
    } catch {
      return [name, false];
    }
  })
);
const nodeMajor = Number(process.versions.node.split(".")[0]);
const result = {
  motiondeck: VERSION,
  node: process.versions.node,
  nodeSupported: nodeMajor >= 22,
  securityMode: securityMode(),
  home: configuredHome,
  assetRoots: assetRoots(),
  browser: findBrowser() ?? null,
  ffmpeg: findFfmpeg() ?? null,
  dependencies,
};
console.log(JSON.stringify(result, null, 2));
if (!result.nodeSupported || Object.values(dependencies).some((ok) => !ok)) process.exitCode = 1;
