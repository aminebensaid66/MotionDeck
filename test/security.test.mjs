import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function connect(home, mode = "safe") {
  const client = new Client({ name: "security-test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "dist/index.js")],
      env: {
        ...process.env,
        MOTIONDECK_HOME: home,
        MOTIONDECK_SECURITY_MODE: mode,
        MOTIONDECK_AUTOCHECK: "0",
      },
    })
  );
  return client;
}

async function raw(client, name, args = {}) {
  return client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 });
}

async function call(client, name, args = {}) {
  const r = await raw(client, name, args);
  assert.ok(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
  return JSON.parse(r.content[0].text);
}

/** Only the slide markup, not the inlined reveal.js bundle. */
function slidesOf(file) {
  const html = readFileSync(file, "utf8");
  const start = html.indexOf('<div class="slides">');
  return html.slice(start, html.indexOf("<script", start));
}

function errorText(r) {
  assert.ok(r.isError, `expected tool failure, got: ${r.content?.[0]?.text}`);
  return r.content?.[0]?.text ?? "";
}

test("safe mode blocks executable and filesystem escape hatches", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "motiondeck-security-"));
  const client = await connect(home);
  t.after(async () => {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  });

  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "js",
      slides: [{ title: "x" }],
      settings: { customJs: "fetch('https://evil.invalid')" },
    })),
    /customJs is disabled/i
  );

  const htmlDeck = await call(client, "create_presentation", {
    title: "html",
    slides: [
      {
        format: "html",
        content:
          '<div class="r-hstack anim-fade-up" style="gap:24px"><div data-id="a" onclick="alert(1)" style="width:80px"></div></div><script>alert(1)</script><iframe src="https://example.com"></iframe>',
      },
    ],
  });
  const sanitized = slidesOf(htmlDeck.htmlPath);
  assert.match(sanitized, /<div class="r-hstack anim-fade-up" style="gap:24px"><div data-id="a" style="width:80px"><\/div>/);
  assert.doesNotMatch(sanitized, /onclick|<script>alert\(1\)|<iframe/i);

  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "style url",
      slides: [{ content: '<span style="background:url(https://evil.invalid/x)">x</span>' }],
    })),
    /CSS construct/i
  );

  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "iframe",
      slides: [{ background: { iframe: "https://example.com" } }],
    })),
    /iframe.*disabled/i
  );

  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "css",
      slides: [{ title: "x" }],
      settings: { customCss: ".x{background:url(https://evil.invalid/x)}" },
    })),
    /CSS construct/i
  );

  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "css tag break",
      slides: [{ title: "x" }],
      settings: { customCss: "</style><script>alert(1)</script>" },
    })),
    /CSS construct/i
  );

  const remote = await call(client, "create_presentation", {
    title: "remote",
    slides: [{ image: "https://example.com/x.png", layout: "image-left" }],
  });
  assert.match(readFileSync(remote.htmlPath, "utf8"), /https:\/\/example\.com\/x\.png/);
  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "plain http",
      slides: [{ image: "http://example.com/x.png", layout: "image-left" }],
    })),
    /HTTPS/i
  );


  const assets = path.join(home, "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(
    path.join(assets, "pixel.png"),
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
  );
  const localAsset = await call(client, "create_presentation", {
    title: "local asset",
    slides: [{ title: "Asset", layout: "image-left", image: "pixel.png", content: "Allowed root" }],
  });
  assert.match(readFileSync(localAsset.htmlPath, "utf8"), /data:image\/png;base64,/i);

  // Any real image works by absolute path; a non-image file is refused even when named .png.
  const elsewhere = mkdtempSync(path.join(tmpdir(), "motiondeck-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  writeFileSync(path.join(elsewhere, "logo.png"), readFileSync(path.join(assets, "pixel.png")));
  writeFileSync(path.join(elsewhere, "id_rsa.png"), "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n");
  const absImage = await call(client, "create_presentation", {
    title: "absolute image",
    slides: [{ layout: "image-left", image: path.join(elsewhere, "logo.png"), content: "x" }],
  });
  assert.match(readFileSync(absImage.htmlPath, "utf8"), /data:image\/png;base64,/i);
  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "key as image",
      slides: [{ layout: "image-left", image: path.join(elsewhere, "id_rsa.png"), content: "x" }],
    })),
    /not a recognized image/i
  );
  const mdKey = await call(client, "create_presentation", {
    title: "key in markdown",
    slides: [{ content: `![k](${path.join(elsewhere, "id_rsa.png")})` }],
  });
  assert.doesNotMatch(slidesOf(mdKey.htmlPath), /secret|T1BFTlNTSCBQUklWQVRF/);

  // Code keeps its angle brackets (no double escaping); presets keep fonts and diagrams.
  const code = await call(client, "create_presentation", {
    title: "code",
    settings: { preset: "aurora" },
    slides: [
      { content: "```ts\nconst m: Map<string, number> = new Map();\n```\n\nInline `Array<T>`" },
      { component: { type: "diagram", code: "graph LR; A-->B" } },
    ],
  });
  const codeHtml = readFileSync(code.htmlPath, "utf8");
  assert.match(codeHtml, /Map&lt;string, number&gt;/);
  assert.match(codeHtml, /<code>Array&lt;T&gt;<\/code>/);
  assert.doesNotMatch(codeHtml, /&amp;lt;/);
  assert.match(codeHtml, /fonts\.googleapis\.com/);
  assert.match(codeHtml, /mermaid@11/);

  const safe = await call(client, "create_presentation", {
    title: "safe markdown",
    settings: { autoAnimateEasing: "</script><script>alert('config-injection')</script>" },
    slides: [{ title: "Safe", content: '<img src="x" onerror="alert(1)"> [bad](javascript:alert(1))' }],
  });
  const html = readFileSync(safe.htmlPath, "utf8");
  assert.doesNotMatch(html, /<img src="x"/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /Content-Security-Policy/i);
  assert.doesNotMatch(html, /<\/script><script>alert\('config-injection'\)<\/script>/i);

  const outside = path.join(home, "..", "outside.html");
  assert.match(
    errorText(await raw(client, "export_presentation", { id: safe.id, format: "html", outputPath: outside })),
    /must stay inside/i
  );


  if (process.platform !== "win32") {
    const exportRoot = path.join(home, "presentations");
    mkdirSync(exportRoot, { recursive: true });
    const outsideTarget = path.join(home, "outside-via-link.html");
    const link = path.join(exportRoot, "link.html");
    symlinkSync(outsideTarget, link);
    assert.match(
      errorText(await raw(client, "export_presentation", { id: safe.id, format: "html", outputPath: "link.html" })),
      /symbolic link/i
    );


    const outsideDir = path.join(home, "outside-dir");
    mkdirSync(outsideDir, { recursive: true });
    const dirLink = path.join(exportRoot, "linkdir");
    symlinkSync(outsideDir, dirLink, "dir");
    assert.match(
      errorText(await raw(client, "export_presentation", { id: safe.id, format: "html", outputPath: "linkdir/created/safe.html" })),
      /symbolic-link directories/i
    );
    assert.ok(!existsSync(path.join(outsideDir, "created")), "resolver must not create directories through a symlink");
  }

  const inside = await call(client, "export_presentation", { id: safe.id, format: "html", outputPath: "nested/safe.html" });
  assert.ok(existsSync(inside.path));
  assert.equal(inside.path, path.join(home, "presentations", "nested", "safe.html"));
});


test("safe mode refuses a symbolic-link export root", async (t) => {
  if (process.platform === "win32") return;
  const home = mkdtempSync(path.join(tmpdir(), "motiondeck-rootlink-"));
  const outside = mkdtempSync(path.join(tmpdir(), "motiondeck-outside-"));
  symlinkSync(outside, path.join(home, "presentations"), "dir");
  const client = await connect(home);
  t.after(async () => {
    await client.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  assert.match(
    errorText(await raw(client, "create_presentation", { title: "root link", slides: [{ title: "x" }] })),
    /export directory.*real directory.*symbolic link/i
  );
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual((await readdir(outside)).sort(), []);
});


test("strict mode limits assets to allowlisted hosts and asset roots", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "motiondeck-strict-"));
  const client = await connect(home, "strict");
  t.after(async () => {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  });
  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "remote",
      slides: [{ image: "https://example.com/x.png", layout: "image-left" }],
    })),
    /host 'example.com'.*not allowed/i
  );
  assert.match(
    errorText(await raw(client, "create_presentation", {
      title: "outside root",
      slides: [{ image: path.join(root, "docs", "presets.jpg"), layout: "image-left" }],
    })),
    /outside the allowed asset roots/i
  );
  const deck = await call(client, "create_presentation", {
    title: "no cdn",
    settings: { preset: "aurora" },
    slides: [{ component: { type: "diagram", code: "graph LR; A-->B" } }],
  });
  const html = readFileSync(deck.htmlPath, "utf8");
  assert.doesNotMatch(html, /fonts\.googleapis\.com|mermaid@11/);
});
