import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(path.join(tmpdir(), "motiondeck-test-"));

async function connect(env = {}) {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "dist/index.js")],
      env: { ...process.env, MOTIONDECK_HOME: home, ...env },
    })
  );
  return client;
}

const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
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

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((x) => x.name).sort(), [
    "add_slides",
    "create_presentation",
    "delete_presentation",
    "export_presentation",
    "get_authoring_guide",
    "get_presentation",
    "list_presentations",
    "move_slide",
    "preview_presentation",
    "remove_slide",
    "screenshot_slides",
    "update_settings",
    "update_slide",
  ]);
  // Tool definitions are sent with every model request, so keep them small.
  const toolChars = JSON.stringify(tools).length;
  assert.ok(toolChars < 9000, `tool definitions grew to ${toolChars} chars`);

  assert.match(await call(client, "get_authoring_guide"), /component/i);

  const created = await call(client, "create_presentation", {
    title: "Motion Demo",
    settings: { theme: "night", transition: "convex", slideNumber: "c/t" },
    slides: [
      {
        layout: "title",
        title: "Motion **Demo**",
        subtitle: "Built with motiondeck",
        content: '<p class="anim-fade-up" style="--delay:.3s">Hello</p>',
        background: { gradient: "linear-gradient(135deg, #667eea, #764ba2)" },
        notes: "Welcome everyone",
      },
      { title: "Agenda", content: "- One\n- Two\n- Three", listFragments: "fade-up" },
      { autoAnimate: true, format: "html", content: '<div data-id="box" style="width:100px;height:100px;background:#e74c3c"></div>' },
      { autoAnimate: true, format: "html", content: '<div data-id="box" style="width:400px;height:200px;background:#3498db"></div>' },
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
  assert.equal(created.layoutIssues, "none");

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
  assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/);

  const id = created.id;

  // Bad input gets a readable validation error instead of being silently dropped.
  const bad = await client.callTool({ name: "add_slides", arguments: { id, slides: [{ titel: "typo" }] } });
  assert.ok(bad.isError);
  assert.match(bad.content[0].text, /titel/);

  await call(client, "add_slides", { id, slides: [{ title: "The End", className: "anim-zoom-in" }], at: 1 });
  let outline = (await call(client, "get_presentation", { id })).outline;
  assert.equal(outline[1], "1: The End");
  await call(client, "move_slide", { id, from: 1, to: 99 });
  outline = (await call(client, "get_presentation", { id })).outline;
  assert.match(outline.at(-1), /The End/);

  await call(client, "update_slide", { id, slide: "1", set: { title: "Agenda (updated)", listFragments: null } });
  await call(client, "update_slide", { id, slide: "5.1", set: { title: "Down (updated)" } });
  const one = await call(client, "get_presentation", { id, slide: "1" });
  assert.equal(one.title, "Agenda (updated)");
  assert.equal(one.listFragments, undefined);
  const deck = await call(client, "get_presentation", { id, full: true });
  assert.equal(deck.slides[5].verticalSlides[0].title, "Down (updated)");

  await call(client, "remove_slide", { id, slide: String(deck.slides.length - 1) });
  await call(client, "update_settings", { id, settings: { theme: "dracula", customCss: ".reveal h2{color:hotpink}" } });
  html = readFileSync(created.htmlPath, "utf8");
  assert.match(html, /hotpink/);
  assert.doesNotMatch(html, /The End/);

  const preview = await call(client, "preview_presentation", { id });
  const res = await fetch(preview.url);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Agenda \(updated\)/);

  // Layout problems are reported automatically, as text, on every edit.
  const added = await call(client, "add_slides", {
    id,
    slides: [{ title: "Overflow", content: Array.from({ length: 20 }, (_, i) => `- Line ${i}`).join("\n") }],
  });
  assert.equal(added.layoutIssues.length, 1);
  assert.equal(added.layoutIssues[0].slide, "6");
  assert.match(added.layoutIssues[0].issues[0], /overflows/);

  const each = await client.callTool({ name: "screenshot_slides", arguments: { id, images: "each", slides: ["0", "6"] } });
  assert.ok(!each.isError, each.content[0].text);
  assert.deepEqual(JSON.parse(each.content[0].text).checked, ["0", "6"]);
  assert.equal(each.content.filter((c) => c.type === "image").length, 2);
  const sheet = await client.callTool({ name: "screenshot_slides", arguments: { id } });
  assert.equal(sheet.content.filter((c) => c.type === "image").length, 1);
  assert.ok(existsSync(path.join(JSON.parse(sheet.content[0].text).savedTo, "sheet.jpg")));
  const none = await client.callTool({ name: "screenshot_slides", arguments: { id, images: "none" } });
  assert.equal(none.content.length, 1);

  if (!process.env.SKIP_PDF) {
    const pdf = await call(client, "export_presentation", { id, format: "pdf" });
    assert.equal(readFileSync(pdf.path).subarray(0, 5).toString(), "%PDF-");
  }
  const exported = await call(client, "export_presentation", { id, format: "html", outputPath: path.join(home, "out", "x.html") });
  assert.ok(existsSync(exported.path));

  const missing = await client.callTool({ name: "get_presentation", arguments: { id: "nope-000000" } });
  assert.ok(missing.isError);

  assert.equal((await call(client, "list_presentations")).length, 1);
  await call(client, "delete_presentation", { id });
  assert.equal((await call(client, "list_presentations")).length, 0);
});

test("presets and components", async (t) => {
  const client = await connect();
  t.after(() => client.close());
  const spec = JSON.parse(readFileSync(path.join(root, "examples/components.json"), "utf8"));
  for (const preset of ["aurora", "corporate", "minimal", "bold", "sunset", "glass"]) {
    const r = await call(client, "create_presentation", { ...spec, preset });
    assert.equal(r.layoutIssues, "none", `${preset}: ${JSON.stringify(r.layoutIssues)}`);
    const html = readFileSync(r.htmlPath, "utf8");
    for (const cls of ["rmcp-stats", "rmcp-bar", "rmcp-line", "rmcp-donut", "rmcp-timeline", "rmcp-cards", "rmcp-comparison", "rmcp-steps", "rmcp-quote", "mermaid"]) {
      assert.ok(html.includes(cls), `${preset} is missing ${cls}`);
    }
    assert.match(html, /data-count="2\.4"/);
    assert.match(html, /rmcp-motion-(subtle|lively)/);
    assert.match(html, /fonts\.googleapis\.com/);
    // Section slides get the preset's background.
    assert.match(html, /<section[^>]*data-background-(gradient|color)=[^>]*class="layout-section"/);
  }
  const bad = await client.callTool({
    name: "create_presentation",
    arguments: { title: "x", slides: [{ component: { type: "chart", kind: "pie", labels: ["a"], series: [{ values: [1] }] } }] },
  });
  assert.ok(bad.isError);
  assert.match(bad.content[0].text, /kind/);
});

test("video export", { skip: !!process.env.SKIP_VIDEO }, async (t) => {
  const client = await connect({ MOTIONDECK_AUTOCHECK: "0" });
  t.after(() => client.close());
  const small = await call(client, "create_presentation", {
    title: "Tiny video",
    preset: "bold",
    slides: [
      { title: "One", fragments: [{ content: "frag" }] },
      { title: "Two", duration: 600, component: { type: "stats", items: [{ value: 10, label: "x" }] } },
    ],
  });
  assert.equal(small.layoutIssues, undefined);
  for (const format of ["mp4", "gif"]) {
    const v = await call(client, "export_presentation", {
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
});
