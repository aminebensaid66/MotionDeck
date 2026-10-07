import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BaseSlideSchema, SettingsShape, SlideSchema, type Deck, type Slide } from "./schema.js";
import { deleteDeck, exportsDir, homeDir, listDecks, loadDeck, newId, saveDeck } from "./store.js";
import { renderDeck, revealVersion, type AssetMode } from "./render.js";
import { htmlToPdf } from "./browser.js";
import { ensurePreviewServer } from "./preview.js";
import { screenshotSlides } from "./shots.js";
import { recordVideo } from "./video.js";
import { GUIDE } from "./guide.js";

export const VERSION = "0.2.0";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

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

function countSlides(slides: Slide[]): number {
  return slides.reduce((n, s) => n + 1 + (s.verticalSlides?.length ?? 0), 0);
}

async function commit(deck: Deck) {
  await saveDeck(deck);
  const file = await writeHtml(deck);
  return {
    id: deck.id,
    title: deck.title,
    slides: countSlides(deck.slides),
    htmlPath: file,
    url: pathToFileURL(file).href,
    next: "Call screenshot_slides to look at the result and fix any reported layout issues.",
  };
}

function outline(deck: Deck) {
  return deck.slides.map((s, i) => ({
    index: i,
    title: s.title ?? (s.content ?? "").split("\n").find((l) => l.trim())?.slice(0, 60) ?? "(untitled)",
    ...(s.verticalSlides?.length
      ? { verticalSlides: s.verticalSlides.map((v, j) => ({ index: j, title: v.title ?? "(untitled)" })) }
      : {}),
  }));
}

function checkIndex(deck: Deck, index: number) {
  if (index < 0 || index >= deck.slides.length) {
    throw new Error(`Slide index ${index} out of range (deck has ${deck.slides.length} top-level slides, 0-based).`);
  }
}

const idArg = z.string().describe("Presentation id returned by create_presentation / list_presentations");

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "reveal-mcp", version: VERSION },
    {
      instructions:
        "Create and edit reveal.js presentations (slides, themes, transitions, fragments, auto-animate, motion classes) and export them to standalone HTML, PDF or video (MP4/WebM/GIF). Call get_authoring_guide once for the full cheat sheet before building an ambitious deck. After creating or changing slides, call screenshot_slides to see them and fix any reported issues (overflowing text, broken images) before presenting the result. Always tell the user the htmlPath of the result.",
    }
  );

  server.registerTool(
    "create_presentation",
    {
      title: "Create presentation",
      description:
        "Create a new reveal.js presentation from a title, deck settings and an ordered list of slides. Writes a standalone HTML file right away and returns its path. Supports markdown, layouts, fragments, auto-animate, transitions, backgrounds, code highlighting, math and speaker notes.",
      inputSchema: {
        title: z.string().describe("Presentation title (used for the HTML <title> and the id)"),
        slides: z.array(SlideSchema).describe("Ordered slides"),
        ...SettingsShape,
      },
    },
    wrap(async ({ title, slides, ...settings }) => {
      const now = new Date().toISOString();
      const deck: Deck = { id: newId(title), title, createdAt: now, updatedAt: now, settings, slides };
      return commit(deck);
    })
  );

  server.registerTool(
    "list_presentations",
    {
      title: "List presentations",
      description: "List saved presentations, newest first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap(async () => {
      const decks = await listDecks();
      return {
        storage: homeDir(),
        presentations: decks.map((d) => ({
          id: d.id,
          title: d.title,
          slides: countSlides(d.slides),
          theme: d.settings.theme ?? "black",
          updatedAt: d.updatedAt,
          htmlPath: path.join(exportsDir(), `${d.id}.html`),
        })),
      };
    })
  );

  server.registerTool(
    "get_presentation",
    {
      title: "Get presentation",
      description:
        "Return a presentation's settings and slides. Use outlineOnly for a compact list of slide indexes and titles.",
      inputSchema: { id: idArg, outlineOnly: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ id, outlineOnly }) => {
      const deck = await loadDeck(id);
      if (outlineOnly) return { id, title: deck.title, settings: deck.settings, outline: outline(deck) };
      return deck;
    })
  );

  server.registerTool(
    "add_slides",
    {
      title: "Add slides",
      description: "Insert one or more slides into a presentation (at the end by default).",
      inputSchema: {
        id: idArg,
        slides: z.array(SlideSchema).min(1),
        position: z.number().int().min(0).optional().describe("0-based index to insert at; default appends"),
      },
    },
    wrap(async ({ id, slides, position }) => {
      const deck = await loadDeck(id);
      const at = Math.min(position ?? deck.slides.length, deck.slides.length);
      deck.slides.splice(at, 0, ...slides);
      return { ...(await commit(deck)), insertedAt: at };
    })
  );

  server.registerTool(
    "update_slide",
    {
      title: "Update slide",
      description:
        "Change one slide. By default the given fields are merged into the slide (set a field to null to remove it); with replace=true the slide is replaced entirely. Use verticalIndex to target a slide inside a vertical stack (0 = the stack's first slide).",
      inputSchema: {
        id: idArg,
        index: z.number().int().min(0).describe("0-based top-level slide index"),
        verticalIndex: z.number().int().min(0).optional(),
        slide: z
          .record(z.string(), z.unknown())
          .describe("Slide fields (same shape as in create_presentation). Null removes a field."),
        replace: z.boolean().optional(),
      },
    },
    wrap(async ({ id, index, verticalIndex, slide, replace }) => {
      const deck = await loadDeck(id);
      checkIndex(deck, index);
      const top = deck.slides[index];
      const target: Record<string, unknown> =
        verticalIndex && verticalIndex > 0 ? (top.verticalSlides?.[verticalIndex - 1] as any) : (top as any);
      if (!target) throw new Error(`Slide ${index} has no vertical slide ${verticalIndex}.`);
      const merged: Record<string, unknown> = replace ? { ...slide } : { ...target, ...slide };
      for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
      if (verticalIndex && verticalIndex > 0) {
        top.verticalSlides![verticalIndex - 1] = BaseSlideSchema.parse(merged);
      } else {
        if (replace && top.verticalSlides && !("verticalSlides" in slide)) merged.verticalSlides = top.verticalSlides;
        deck.slides[index] = SlideSchema.parse(merged);
      }
      return commit(deck);
    })
  );

  server.registerTool(
    "remove_slide",
    {
      title: "Remove slide",
      description: "Delete a slide (or one slide of a vertical stack via verticalIndex >= 1).",
      inputSchema: { id: idArg, index: z.number().int().min(0), verticalIndex: z.number().int().min(1).optional() },
      annotations: { destructiveHint: true },
    },
    wrap(async ({ id, index, verticalIndex }) => {
      const deck = await loadDeck(id);
      checkIndex(deck, index);
      if (verticalIndex) {
        const v = deck.slides[index].verticalSlides;
        if (!v?.[verticalIndex - 1]) throw new Error(`Slide ${index} has no vertical slide ${verticalIndex}.`);
        v.splice(verticalIndex - 1, 1);
      } else {
        deck.slides.splice(index, 1);
      }
      return commit(deck);
    })
  );

  server.registerTool(
    "move_slide",
    {
      title: "Move slide",
      description: "Move a top-level slide from one position to another.",
      inputSchema: { id: idArg, from: z.number().int().min(0), to: z.number().int().min(0) },
    },
    wrap(async ({ id, from, to }) => {
      const deck = await loadDeck(id);
      checkIndex(deck, from);
      const [s] = deck.slides.splice(from, 1);
      deck.slides.splice(Math.min(to, deck.slides.length), 0, s);
      return { ...(await commit(deck)), outline: outline(deck) };
    })
  );

  server.registerTool(
    "update_presentation_settings",
    {
      title: "Update presentation settings",
      description:
        "Change deck-wide settings: theme, default transition, controls, slide numbers, auto-slide, size, custom CSS/JS, title.",
      inputSchema: { id: idArg, title: z.string().optional(), ...SettingsShape },
    },
    wrap(async ({ id, title, ...settings }) => {
      const deck = await loadDeck(id);
      if (title) deck.title = title;
      for (const [k, v] of Object.entries(settings)) if (v !== undefined) (deck.settings as any)[k] = v;
      return { ...(await commit(deck)), settings: deck.settings };
    })
  );

  server.registerTool(
    "export_presentation",
    {
      title: "Export presentation",
      description:
        "Export to a standalone HTML file (all reveal.js assets inlined, works offline; or assets='cdn' for a small file) or to PDF (needs Chrome/Chromium/Edge installed). Returns the output path.",
      inputSchema: {
        id: idArg,
        format: z.enum(["html", "pdf"]).optional().describe("Default html"),
        outputPath: z.string().optional().describe("Absolute output path; default ~/reveal-mcp/presentations/<id>.<ext>"),
        assets: z.enum(["inline", "cdn"]).optional().describe("HTML only. inline (default) or cdn"),
      },
    },
    wrap(async ({ id, format = "html", outputPath, assets = "inline" }) => {
      const deck = await loadDeck(id);
      const out = outputPath ? resolveOut(outputPath) : path.join(exportsDir(), `${deck.id}.${format}`);
      await fs.mkdir(path.dirname(out), { recursive: true });
      if (format === "html") {
        await writeHtml(deck, out, assets);
      } else {
        const tmp = path.join(os.tmpdir(), `reveal-mcp-${deck.id}-${process.pid}.html`);
        await writeHtml(deck, tmp, "inline");
        try {
          await htmlToPdf(tmp, out, deck.settings.width ?? 1280, deck.settings.height ?? 720);
        } finally {
          await fs.rm(tmp, { force: true });
        }
      }
      const { size } = await fs.stat(out);
      return { id, format, path: out, url: pathToFileURL(out).href, bytes: size };
    })
  );

  server.registerTool(
    "screenshot_slides",
    {
      title: "Screenshot slides",
      description:
        "Render slides to images so you can see them, with every fragment shown and animations in their final state. Also checks each slide for layout problems (content overflowing the slide, cut-off code, broken images, empty slides) and lists them. Use it after creating or editing a deck, fix the issues, and check again.",
      inputSchema: {
        id: idArg,
        slides: z
          .array(z.string())
          .optional()
          .describe('Only these slides: "3" for top-level slide 3, "3.1" for its first vertical slide. Default all.'),
        mode: z
          .enum(["auto", "sheet", "individual"])
          .optional()
          .describe("sheet = one contact-sheet image of all slides, individual = one image per slide. auto (default) picks sheet above 6 slides."),
        imageWidth: z.number().int().min(320).max(1920).optional().describe("Width of each slide image, default 960"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id, slides, mode = "auto", imageWidth }) => {
      try {
        const deck = await loadDeck(id);
        const tmp = path.join(os.tmpdir(), `reveal-mcp-shot-${deck.id}-${process.pid}.html`);
        await writeHtml(deck, tmp, "inline");
        let result;
        try {
          const all = (slides?.length ?? countSlides(deck.slides));
          const sheet = mode === "sheet" || (mode === "auto" && all > 6);
          result = await screenshotSlides(tmp, {
            deckWidth: deck.settings.width ?? 1280,
            deckHeight: deck.settings.height ?? 720,
            imageWidth: imageWidth ?? (sheet ? 640 : 960),
            only: slides,
            sheet,
          });
        } finally {
          await fs.rm(tmp, { force: true });
        }
        const dir = path.join(exportsDir(), `${deck.id}-screenshots`);
        await fs.rm(dir, { recursive: true, force: true });
        await fs.mkdir(dir, { recursive: true });
        await Promise.all(result.shots.map((s) => fs.writeFile(path.join(dir, `slide-${s.slide}.jpg`), s.jpeg)));
        if (result.sheet) await fs.writeFile(path.join(dir, "sheet.jpg"), result.sheet);
        const issues = result.shots.filter((s) => s.issues.length).map((s) => ({ slide: s.slide, title: s.title, issues: s.issues }));
        const summary = {
          id: deck.id,
          slidesChecked: result.shots.length,
          issues,
          verdict: issues.length
            ? `${issues.length} slide(s) need fixing. Use update_slide (index = the number before the dot, verticalIndex = after it), then screenshot again.`
            : "No layout issues detected. Still look at the images for design quality.",
          savedTo: dir,
          slides: result.shots.map((s) => s.slide),
        };
        const images = result.sheet
          ? [{ type: "image" as const, data: result.sheet.toString("base64"), mimeType: "image/jpeg" }]
          : result.shots.map((s) => ({ type: "image" as const, data: s.jpeg.toString("base64"), mimeType: "image/jpeg" }));
        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }, ...images] };
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "export_video",
    {
      title: "Export video",
      description:
        "Record the presentation playing, with its transitions, fragments, auto-animate and motion effects, to an MP4, WebM or GIF. It plays in real time, so a 10-slide deck takes about 30-60 seconds. Per-slide timing comes from each slide's duration field. Needs Chrome/Chromium/Edge and ffmpeg.",
      inputSchema: {
        id: idArg,
        format: z.enum(["mp4", "webm", "gif"]).optional().describe("Default mp4"),
        outputPath: z.string().optional().describe("Absolute output path; default ~/reveal-mcp/presentations/<id>.<format>"),
        resolution: z.enum(["720p", "1080p", "square", "vertical"]).optional().describe("1080p (default), 720p, square 1080x1080 or vertical 1080x1920. For square or vertical, set the deck's width/height to match first."),
        fps: z.number().int().min(10).max(60).optional().describe("Default 30 (GIF is capped at 15)"),
        slideDuration: z.number().int().min(500).max(60000).optional().describe("Default ms per slide, including its transition (default 3000)"),
        fragmentDuration: z.number().int().min(200).max(30000).optional().describe("ms after each fragment appears (default 1500)"),
        showControls: z.boolean().optional().describe("Keep reveal.js arrows, progress bar and slide numbers visible (default false)"),
      },
    },
    async ({ id, format = "mp4", outputPath, resolution = "1080p", fps, slideDuration, fragmentDuration, showControls }, extra) => {
      try {
        const deck = await loadDeck(id);
        const out = outputPath ? resolveOut(outputPath) : path.join(exportsDir(), `${deck.id}.${format}`);
        const size = { "720p": [1280, 720], "1080p": [1920, 1080], square: [1080, 1080], vertical: [1080, 1920] }[resolution];
        const tmp = path.join(os.tmpdir(), `reveal-mcp-video-${deck.id}-${process.pid}.html`);
        await writeHtml(deck, tmp, "inline");
        const token = extra?._meta?.progressToken;
        try {
          const r = await recordVideo(tmp, out, {
            format,
            width: size[0],
            height: size[1],
            fps,
            slideDuration,
            fragmentDuration,
            showControls,
            onProgress: (progress, total, message) => {
              if (token === undefined) return;
              extra
                .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress, total, message } })
                .catch(() => {});
            },
          });
          const { size: bytes } = await fs.stat(out);
          return ok({ id, format, path: out, url: pathToFileURL(out).href, bytes, durationSeconds: r.seconds, steps: r.steps, resolution: `${size[0]}x${size[1]}` });
        } finally {
          await fs.rm(tmp, { force: true });
        }
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "preview_presentation",
    {
      title: "Preview presentation",
      description:
        "Serve the presentation on a localhost URL that always shows the latest version (refresh after edits).",
      inputSchema: { id: idArg },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ id }) => {
      await loadDeck(id);
      const port = await ensurePreviewServer();
      return {
        url: `http://127.0.0.1:${port}/${encodeURIComponent(id)}`,
        speakerNotes: "Press S for speaker view, F for fullscreen, Esc for overview.",
      };
    })
  );

  server.registerTool(
    "delete_presentation",
    {
      title: "Delete presentation",
      description: "Delete a saved presentation and its default HTML output.",
      inputSchema: { id: idArg },
      annotations: { destructiveHint: true },
    },
    wrap(async ({ id }) => {
      await loadDeck(id);
      await deleteDeck(id);
      await fs.rm(path.join(exportsDir(), `${id}.html`), { force: true });
      return { deleted: id };
    })
  );

  server.registerTool(
    "get_authoring_guide",
    {
      title: "reveal.js authoring guide",
      description:
        "Cheat sheet for building great decks: layouts, fragments, auto-animate, motion classes, transitions, themes, code and math.",
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
              "Read get_authoring_guide first, then call create_presentation once with all slides.",
              "Use a title slide, section dividers with gradient backgrounds, listFragments for bullet pacing, at least one auto-animate sequence, motion classes on hero text, and speaker notes on every slide.",
              "Finish by telling me the htmlPath and offering a PDF export.",
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
