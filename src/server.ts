import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BaseSlideSchema, SettingsSchema, SlideSchema, type Deck, type Slide } from "./schema.js";
import { deleteDeck, exportsDir, homeDir, listDecks, loadDeck, newId, saveDeck } from "./store.js";
import { renderDeck, revealVersion, type AssetMode } from "./render.js";
import { findBrowser, htmlToPdf } from "./browser.js";
import { ensurePreviewServer } from "./preview.js";
import { screenshotSlides } from "./shots.js";
import { recordVideo } from "./video.js";
import { GUIDE } from "./guide.js";

export const VERSION = "0.3.0";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
});
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${errorText(e)}` }],
  isError: true,
});

function errorText(e: unknown): string {
  if (e instanceof z.ZodError) return `invalid input\n${z.prettifyError(e)}\nSee get_authoring_guide for the slide and settings reference.`;
  return e instanceof Error ? e.message : String(e);
}

function wrap<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return ok(await fn(args));
    } catch (e) {
      return fail(e);
    }
  };
}

function resolveOut(p: string): string {
  return path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir()));
}

async function writeHtml(deck: Deck, file = path.join(exportsDir(), `${deck.id}.html`), assets: AssetMode = "inline") {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, await renderDeck(deck, { assets }));
  return file;
}

async function withTempHtml<T>(deck: Deck, fn: (file: string) => Promise<T>): Promise<T> {
  const tmp = path.join(os.tmpdir(), `reveal-mcp-${deck.id}-${process.pid}-${Date.now()}.html`);
  await writeHtml(deck, tmp, "inline");
  try {
    return await fn(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

function countSlides(slides: Slide[]): number {
  return slides.reduce((n, s) => n + 1 + (s.verticalSlides?.length ?? 0), 0);
}

/** Labels ("3", "3.1") of top-level slides [from, to) and their vertical children. */
function labels(slides: Slide[], from = 0, to = slides.length): string[] {
  const out: string[] = [];
  for (let i = from; i < to; i++) {
    out.push(String(i));
    slides[i]?.verticalSlides?.forEach((_, j) => out.push(`${i}.${j + 1}`));
  }
  return out;
}

/** Text-only layout check of the given slides, so the model learns about problems without spending image tokens. */
async function autoCheck(deck: Deck, only: string[]) {
  if (process.env.REVEAL_MCP_AUTOCHECK === "0" || !only.length || !findBrowser()) return undefined;
  try {
    const { shots } = await withTempHtml(deck, (file) =>
      screenshotSlides(file, {
        deckWidth: deck.settings.width ?? 1280,
        deckHeight: deck.settings.height ?? 720,
        imageWidth: 960,
        only,
        images: false,
      })
    );
    const issues = shots.filter((s) => s.issues.length).map((s) => ({ slide: s.slide, issues: s.issues }));
    return issues.length ? issues : "none";
  } catch {
    return undefined;
  }
}

async function commit(deck: Deck, changed?: string[]) {
  await saveDeck(deck);
  const file = await writeHtml(deck);
  const issues = await autoCheck(deck, changed ?? labels(deck.slides));
  return {
    id: deck.id,
    slides: countSlides(deck.slides),
    htmlPath: file,
    ...(issues === undefined ? {} : { layoutIssues: issues }),
  };
}

function outline(deck: Deck) {
  const name = (s: Slide | (typeof deck.slides)[number]) =>
    s.title ?? (s.component ? `[${s.component.type}]` : (s.content ?? "").split("\n").find((l) => l.trim())?.slice(0, 50) ?? "");
  return labels(deck.slides).map((l) => {
    const [h, v] = l.split(".").map(Number);
    const s = v ? deck.slides[h].verticalSlides![v - 1] : deck.slides[h];
    return `${l}: ${name(s)}${s.layout ? ` (${s.layout})` : ""}`;
  });
}

/** Parses "3" / "3.1" into indexes and checks they exist. */
function locate(deck: Deck, label: string): { h: number; v: number } {
  const m = String(label).match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) throw new Error(`Slide must look like "3" or "3.1", got "${label}".`);
  const h = Number(m[1]);
  const v = Number(m[2] ?? 0);
  if (h >= deck.slides.length) throw new Error(`No slide ${h}; the deck has slides 0-${deck.slides.length - 1}.`);
  if (v && !deck.slides[h].verticalSlides?.[v - 1]) throw new Error(`Slide ${h} has no vertical slide ${v}.`);
  return { h, v };
}

const idArg = z.string().describe("Presentation id");
const slideArg = z.string().describe('"3" = top-level slide 3 (0-based); "3.1" = first vertical slide under it');
const slidesArg = z
  .array(z.record(z.string(), z.unknown()))
  .describe(
    "Slide objects. Fields: title, subtitle, content (markdown/HTML), layout (title|section|center|columns|image-left|image-right|fullscreen), columns, image, component ({type:stats|timeline|cards|quote|comparison|steps|chart|diagram,...}), code, listFragments, fragments, notes, background, transition, autoAnimate, duration, className, verticalSlides. Full reference: get_authoring_guide."
  );
const settingsArg = z
  .record(z.string(), z.unknown())
  .describe("Optional: theme, motion (none|subtle|lively), brand {primary, logo, font, headingFont}, transition, slideNumber, width, height, customCss… (see guide)");

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "reveal-mcp", version: VERSION },
    {
      instructions:
        "Builds animated reveal.js decks and exports HTML, PDF or video. Read get_authoring_guide once, then create the whole deck in one create_presentation call using a preset and components (they look designed and cost few tokens). Edits return layoutIssues; fix them. Use screenshot_slides only when you need to see the design. Tell the user the htmlPath.",
    }
  );

  server.registerTool(
    "create_presentation",
    {
      description: "Create a deck from all its slides in one call. Writes the HTML and returns its path plus layout issues found.",
      inputSchema: {
        title: z.string(),
        preset: z.enum(["aurora", "corporate", "minimal", "bold", "sunset", "glass"]).optional().describe("Designed look (recommended)"),
        slides: slidesArg,
        settings: settingsArg.optional(),
      },
    },
    wrap(async ({ title, preset, slides, settings }) => {
      const now = new Date().toISOString();
      const parsed = SettingsSchema.parse({ ...(settings ?? {}), ...(preset ? { preset } : {}) });
      const deck: Deck = { id: newId(title), title, createdAt: now, updatedAt: now, settings: parsed, slides: z.array(SlideSchema).parse(slides) };
      return commit(deck);
    })
  );

  server.registerTool(
    "add_slides",
    {
      description: "Insert slides (default: at the end).",
      inputSchema: {
        id: idArg,
        slides: z.array(z.record(z.string(), z.unknown())).describe("Same slide objects as create_presentation"),
        at: z.number().int().min(0).optional().describe("0-based position"),
      },
    },
    wrap(async ({ id, slides, at }) => {
      const deck = await loadDeck(id);
      const pos = Math.min(at ?? deck.slides.length, deck.slides.length);
      const parsed = z.array(SlideSchema).min(1).parse(slides);
      deck.slides.splice(pos, 0, ...parsed);
      return commit(deck, labels(deck.slides, pos, pos + parsed.length));
    })
  );

  server.registerTool(
    "update_slide",
    {
      description: "Merge fields into one slide (null removes a field), or replace it entirely with replace=true.",
      inputSchema: { id: idArg, slide: slideArg, set: z.record(z.string(), z.unknown()), replace: z.boolean().optional() },
    },
    wrap(async ({ id, slide, set, replace }) => {
      const deck = await loadDeck(id);
      const { h, v } = locate(deck, slide);
      const top = deck.slides[h];
      const target = (v ? top.verticalSlides![v - 1] : top) as Record<string, unknown>;
      const merged: Record<string, unknown> = replace ? { ...set } : { ...target, ...set };
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (v) {
        top.verticalSlides![v - 1] = BaseSlideSchema.parse(merged);
      } else {
        if (replace && top.verticalSlides && !("verticalSlides" in set)) merged.verticalSlides = top.verticalSlides;
        deck.slides[h] = SlideSchema.parse(merged);
      }
      return commit(deck, v ? [slide] : labels(deck.slides, h, h + 1));
    })
  );

  server.registerTool(
    "remove_slide",
    {
      description: "Delete a slide.",
      inputSchema: { id: idArg, slide: slideArg },
      annotations: { destructiveHint: true },
    },
    wrap(async ({ id, slide }) => {
      const deck = await loadDeck(id);
      const { h, v } = locate(deck, slide);
      if (v) deck.slides[h].verticalSlides!.splice(v - 1, 1);
      else deck.slides.splice(h, 1);
      return { ...(await commit(deck, [])), outline: outline(deck) };
    })
  );

  server.registerTool(
    "move_slide",
    {
      description: "Move a top-level slide to a new position.",
      inputSchema: { id: idArg, from: z.number().int().min(0), to: z.number().int().min(0) },
    },
    wrap(async ({ id, from, to }) => {
      const deck = await loadDeck(id);
      locate(deck, String(from));
      const [s] = deck.slides.splice(from, 1);
      deck.slides.splice(Math.min(to, deck.slides.length), 0, s);
      return { ...(await commit(deck, [])), outline: outline(deck) };
    })
  );

  server.registerTool(
    "update_settings",
    {
      description: "Change deck-wide settings (merged; null removes) and/or the title.",
      inputSchema: { id: idArg, title: z.string().optional(), settings: settingsArg.optional() },
    },
    wrap(async ({ id, title, settings }) => {
      const deck = await loadDeck(id);
      if (title) deck.title = title;
      const merged: Record<string, unknown> = { ...deck.settings, ...(settings ?? {}) };
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      deck.settings = SettingsSchema.parse(merged);
      return { ...(await commit(deck)), settings: deck.settings };
    })
  );

  server.registerTool(
    "get_presentation",
    {
      description: "Outline of a deck (default), one slide's full JSON (slide), or the whole deck (full=true).",
      inputSchema: { id: idArg, slide: slideArg.optional(), full: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ id, slide, full }) => {
      const deck = await loadDeck(id);
      if (full) return deck;
      if (slide) {
        const { h, v } = locate(deck, slide);
        return v ? deck.slides[h].verticalSlides![v - 1] : deck.slides[h];
      }
      return { id, title: deck.title, settings: deck.settings, outline: outline(deck) };
    })
  );

  server.registerTool(
    "list_presentations",
    { description: "List saved decks, newest first.", inputSchema: {}, annotations: { readOnlyHint: true } },
    wrap(async () =>
      (await listDecks()).map((d) => ({ id: d.id, title: d.title, slides: countSlides(d.slides), updatedAt: d.updatedAt.slice(0, 16) }))
    )
  );

  server.registerTool(
    "delete_presentation",
    { description: "Delete a deck.", inputSchema: { id: idArg }, annotations: { destructiveHint: true } },
    wrap(async ({ id }) => {
      await loadDeck(id);
      await deleteDeck(id);
      await fs.rm(path.join(exportsDir(), `${id}.html`), { force: true });
      return { deleted: id };
    })
  );

  server.registerTool(
    "screenshot_slides",
    {
      description:
        "See slides as images (final state) plus layout checks. images: sheet (default, one small overview image), each (one image per slide, costs more), none.",
      inputSchema: {
        id: idArg,
        slides: z.array(z.string()).optional().describe('e.g. ["2","5.1"]; default all'),
        images: z.enum(["sheet", "each", "none"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, slides, images = "sheet" }) => {
      try {
        const deck = await loadDeck(id);
        const result = await withTempHtml(deck, (file) =>
          screenshotSlides(file, {
            deckWidth: deck.settings.width ?? 1280,
            deckHeight: deck.settings.height ?? 720,
            imageWidth: images === "each" ? 800 : 640,
            only: slides,
            sheet: images === "sheet",
            images: images !== "none",
          })
        );
        const dir = path.join(exportsDir(), `${deck.id}-screenshots`);
        if (images !== "none") {
          await fs.rm(dir, { recursive: true, force: true });
          await fs.mkdir(dir, { recursive: true });
          await Promise.all(result.shots.map((s) => fs.writeFile(path.join(dir, `slide-${s.slide}.jpg`), s.jpeg)));
          if (result.sheet) await fs.writeFile(path.join(dir, "sheet.jpg"), result.sheet);
        }
        const issues = result.shots.filter((s) => s.issues.length).map((s) => ({ slide: s.slide, issues: s.issues }));
        const summary = {
          checked: result.shots.map((s) => s.slide),
          layoutIssues: issues.length ? issues : "none",
          ...(images !== "none" ? { savedTo: dir } : {}),
        };
        const imgs =
          images === "sheet" && result.sheet
            ? [result.sheet]
            : images === "each"
              ? result.shots.map((s) => s.jpeg)
              : [];
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(summary) },
            ...imgs.map((b) => ({ type: "image" as const, data: b.toString("base64"), mimeType: "image/jpeg" })),
          ],
        };
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "export_presentation",
    {
      description:
        "Export to html (offline single file), pdf, or video: mp4/webm/gif records the deck playing with all motion (real time, ~3s per slide).",
      inputSchema: {
        id: idArg,
        format: z.enum(["html", "pdf", "mp4", "webm", "gif"]),
        outputPath: z.string().optional(),
        resolution: z.enum(["720p", "1080p", "square", "vertical"]).optional().describe("video; default 1080p"),
        slideDuration: z.number().int().min(500).max(60000).optional().describe("video ms per slide; default 3000"),
        fragmentDuration: z.number().int().min(200).max(30000).optional().describe("video ms per fragment; default 1500"),
      },
    },
    async ({ id, format, outputPath, resolution = "1080p", slideDuration, fragmentDuration }, extra) => {
      try {
        const deck = await loadDeck(id);
        const out = outputPath ? resolveOut(outputPath) : path.join(exportsDir(), `${deck.id}.${format}`);
        await fs.mkdir(path.dirname(out), { recursive: true });
        let videoInfo = {};
        if (format === "html") {
          await writeHtml(deck, out, "inline");
        } else if (format === "pdf") {
          await withTempHtml(deck, (file) => htmlToPdf(file, out, deck.settings.width ?? 1280, deck.settings.height ?? 720));
        } else {
          const size = { "720p": [1280, 720], "1080p": [1920, 1080], square: [1080, 1080], vertical: [1080, 1920] }[resolution];
          const token = extra?._meta?.progressToken;
          const r = await withTempHtml(deck, (file) =>
            recordVideo(file, out, {
              format,
              width: size[0],
              height: size[1],
              slideDuration,
              fragmentDuration,
              onProgress: (progress, total, message) => {
                if (token === undefined) return;
                extra
                  .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress, total, message } })
                  .catch(() => {});
              },
            })
          );
          videoInfo = { seconds: r.seconds, steps: r.steps };
        }
        const { size: bytes } = await fs.stat(out);
        return ok({ path: out, bytes, ...videoInfo });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "preview_presentation",
    {
      description: "Local URL that always serves the latest version of a deck.",
      inputSchema: { id: idArg },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ id }) => {
      await loadDeck(id);
      const port = await ensurePreviewServer();
      return { url: `http://127.0.0.1:${port}/${encodeURIComponent(id)}` };
    })
  );

  server.registerTool(
    "get_authoring_guide",
    {
      description: "Reference for slide fields, components, presets and motion. Read once before building.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => ok(`${GUIDE}\n(reveal.js ${revealVersion})`)
  );

  server.registerResource(
    "authoring-guide",
    "reveal://guide",
    { title: "reveal.js authoring guide", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDE }] })
  );

  server.registerPrompt(
    "make_presentation",
    {
      title: "Make a presentation",
      description: "Build a polished, animated reveal.js deck about a topic.",
      argsSchema: {
        topic: z.string().describe("What the presentation is about"),
        audience: z.string().optional(),
        slides: z.string().optional().describe("Approximate number of slides"),
        style: z.string().optional().describe("Visual style, e.g. 'dark minimal', 'playful', 'corporate'"),
      },
    },
    ({ topic, audience, slides, style }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Create a reveal.js presentation about: ${topic}.`,
              audience ? `Audience: ${audience}.` : "",
              `Length: about ${slides ?? "10"} slides.`,
              style ? `Visual style: ${style}.` : "",
              "Read get_authoring_guide, then call create_presentation once with a preset and all slides.",
              "Mix components (stats, timeline, cards, chart, comparison, steps, quote) with short text slides, use section slides between parts, and add speaker notes.",
              "Fix any layoutIssues returned, then tell me the htmlPath and offer PDF or MP4 export.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    })
  );

  return server;
}
