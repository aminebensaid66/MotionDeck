import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(path.join(tmpdir(), "reveal-mcp-test-"));

async function connect() {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "dist/index.js")],
      env: { ...process.env, REVEAL_MCP_HOME: home },
    })
  );
  return client;
}

const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  assert.ok(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
  const text = r.content[0].text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

test("full deck lifecycle", async (t) => {
  const client = await connect();
  t.after(async () => {
    await client.close();
    if (!process.env.KEEP) rmSync(home, { recursive: true, force: true });
  });

  const tools = (await client.listTools()).tools.map((x) => x.name).sort();
  assert.deepEqual(tools, [
    "add_slides",
    "create_presentation",
    "delete_presentation",
    "export_presentation",
    "export_video",
    "get_authoring_guide",
    "get_presentation",
    "list_presentations",
    "move_slide",
    "preview_presentation",
    "remove_slide",
    "screenshot_slides",
    "update_presentation_settings",
    "update_slide",
  ]);

  const guide = await call(client, "get_authoring_guide");
  assert.match(guide, /auto-animate/i);

  const created = await call(client, "create_presentation", {
    title: "Motion Demo",
    theme: "night",
    transition: "convex",
    slideNumber: "c/t",
    slides: [
      {
        layout: "title",
        title: "Motion **Demo**",
        subtitle: "Built with reveal-mcp",
        content: '<p class="anim-fade-up" style="--delay:.3s">Hello</p>',
        background: { gradient: "linear-gradient(135deg, #667eea, #764ba2)" },
        notes: "Welcome everyone",
      },
      { title: "Agenda", content: "- One\n- Two\n- Three", listFragments: "fade-up" },
      {
        autoAnimate: true,
        format: "html",
        content: '<div data-id="box" style="width:100px;height:100px;background:#e74c3c"></div>',
      },
      {
        autoAnimate: true,
        format: "html",
        content: '<div data-id="box" style="width:400px;height:200px;background:#3498db"></div>',
      },
      {
        title: "Code",
        code: { language: "js", code: "const a = 1;\nconst b = a < 2;", lineNumbers: "|1|2" },
        fragments: [{ content: "Step *one*", effect: "highlight-red" }],
      },
      {
        title: "Columns",
        layout: "columns",
        columns: ["### Left\nText", "### Right\n```py [1]\nprint('x')\n```"],
        verticalSlides: [{ title: "Down", content: "$$ e^{i\\pi} + 1 = 0 $$" }],
      },
    ],
  });
  assert.equal(created.slides, 7);
  assert.ok(existsSync(created.htmlPath));

  let html = readFileSync(created.htmlPath, "utf8");
  assert.match(html, /<title>Motion Demo<\/title>/);
  assert.match(html, /data-auto-animate/);
  assert.match(html, /class="fragment fade-up"/);
  assert.match(html, /data-line-numbers="\|1\|2"/);
  assert.match(html, /const a = 1;\nconst b = a &lt; 2;/);
  assert.match(html, /RevealHighlight/);
  assert.match(html, /RevealMath\.KaTeX/);
  assert.match(html, /<aside class="notes"><p>Welcome everyone<\/p>/);
  assert.match(html, /"transition":"convex"/);
  assert.match(html, /data-background-gradient=/);
  assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/);

  const id = created.id;
  await call(client, "add_slides", { id, slides: [{ title: "The End", className: "anim-zoom-in" }], position: 1 });
  let outline = (await call(client, "get_presentation", { id, outlineOnly: true })).outline;
  assert.equal(outline[1].title, "The End");
  await call(client, "move_slide", { id, from: 1, to: 99 });
  outline = (await call(client, "get_presentation", { id, outlineOnly: true })).outline;
  assert.equal(outline.at(-1).title, "The End");

  await call(client, "update_slide", { id, index: 1, slide: { title: "Agenda (updated)", listFragments: null } });
  await call(client, "update_slide", { id, index: 5, verticalIndex: 1, slide: { title: "Down (updated)" } });
  const deck = await call(client, "get_presentation", { id });
  assert.equal(deck.slides[1].title, "Agenda (updated)");
  assert.equal(deck.slides[1].listFragments, undefined);
  assert.equal(deck.slides[5].verticalSlides[0].title, "Down (updated)");

  await call(client, "remove_slide", { id, index: deck.slides.length - 1 });
  await call(client, "update_presentation_settings", { id, theme: "dracula", customCss: ".reveal h2{color:hotpink}" });
  html = readFileSync(created.htmlPath, "utf8");
  assert.match(html, /hotpink/);
  assert.doesNotMatch(html, /The End/);

  const cdn = await call(client, "export_presentation", {
    id,
    assets: "cdn",
    outputPath: path.join(home, "out", "cdn.html"),
  });
  assert.ok(cdn.bytes < 60_000, `cdn export should be small, got ${cdn.bytes}`);
  assert.match(readFileSync(cdn.path, "utf8"), /cdn\.jsdelivr\.net\/npm\/reveal\.js@/);

  const preview = await call(client, "preview_presentation", { id });
  const res = await fetch(preview.url);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Agenda \(updated\)/);

  if (!process.env.SKIP_PDF) {
    const pdf = await call(client, "export_presentation", { id, format: "pdf" });
    const head = readFileSync(pdf.path).subarray(0, 5).toString();
    assert.equal(head, "%PDF-");
  }

  // Screenshots: an overflowing slide must be flagged, a clean one must not.
  await call(client, "add_slides", {
    id,
    slides: [{ title: "Overflow", content: Array.from({ length: 20 }, (_, i) => `- Line ${i}`).join("\n") }],
  });
  const shotRes = await client.callTool({ name: "screenshot_slides", arguments: { id, mode: "individual", slides: ["0", "6"] } });
  assert.ok(!shotRes.isError, shotRes.content[0].text);
  const shot = JSON.parse(shotRes.content[0].text);
  assert.deepEqual(shot.slides, ["0", "6"]);
  assert.equal(shotRes.content.filter((c) => c.type === "image").length, 2);
  assert.equal(shot.issues.length, 1);
  assert.equal(shot.issues[0].slide, "6");
  assert.match(shot.issues[0].issues[0], /overflows/);
  const sheet = await client.callTool({ name: "screenshot_slides", arguments: { id, mode: "sheet" } });
  assert.equal(sheet.content.filter((c) => c.type === "image").length, 1);
  assert.ok(existsSync(path.join(JSON.parse(sheet.content[0].text).savedTo, "sheet.jpg")));

  if (!process.env.SKIP_VIDEO) {
    const small = await call(client, "create_presentation", {
      title: "Tiny video",
      slides: [{ title: "One", fragments: [{ content: "frag" }] }, { title: "Two", duration: 600 }],
    });
    for (const format of ["mp4", "gif"]) {
      const v = await call(client, "export_video", {
        id: small.id,
        format,
        resolution: "720p",
        slideDuration: 700,
        fragmentDuration: 400,
      });
      assert.equal(v.steps, 3);
      assert.ok(v.bytes > 1000);
      const magic = readFileSync(v.path).subarray(0, 12).toString("latin1");
      assert.ok(format === "gif" ? magic.startsWith("GIF8") : magic.includes("ftyp"), `bad ${format} header`);
    }
    await call(client, "delete_presentation", { id: small.id });
  }

  const bad = await client.callTool({ name: "get_presentation", arguments: { id: "nope-000000" } });
  assert.ok(bad.isError);

  const list = await call(client, "list_presentations");
  assert.equal(list.presentations.length, 1);
  await call(client, "delete_presentation", { id });
  assert.equal((await call(client, "list_presentations")).presentations.length, 0);
});
