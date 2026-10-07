import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Marked } from "marked";
import type { BaseSlide, Deck, Slide } from "./schema.js";
import { MOTION_CSS, LAYOUT_CSS } from "./styles.js";

const require = createRequire(import.meta.url);
const revealDist = path.dirname(require.resolve("reveal.js"));
const revealVersion: string = JSON.parse(readFileSync(path.join(revealDist, "..", "package.json"), "utf8")).version;
const cdnBase = `https://cdn.jsdelivr.net/npm/reveal.js@${revealVersion}/dist`;

export type AssetMode = "inline" | "cdn";

export interface RenderOptions {
  assets?: AssetMode;
  /** Embed local images referenced by absolute path as data URIs (inline mode only). */
  embedLocalImages?: boolean;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      // Support reveal-style fences: ```js [1-2|3|4]
      const m = (lang ?? "").match(/^(\S*)\s*(?:\[([^\]]*)\])?/);
      const language = m?.[1] ?? "";
      const lines = m?.[2];
      const attrs = [
        language ? ` class="language-${escapeHtml(language)}"` : "",
        lines !== undefined ? ` data-line-numbers="${escapeHtml(lines)}"` : "",
        " data-trim",
      ].join("");
      return `<pre><code${attrs}>${escapeHtml(text)}</code></pre>\n`;
    },
  },
});

/** Keep TeX intact: markdown would otherwise eat underscores, asterisks and backslashes inside math. */
function protectMath(src: string, fn: (s: string) => string): string {
  const stash: string[] = [];
  const masked = src.replace(/\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]/g, (m) => {
    stash.push(m);
    return `RMCPMATH${stash.length - 1}X`;
  });
  return fn(masked).replace(/RMCPMATH(\d+)X/g, (_m, i: string) => escapeHtml(stash[Number(i)]));
}

const md = (s: string) => protectMath(s, (x) => marked.parse(x, { async: false }) as string);
const mdInline = (s: string) => protectMath(s, (x) => marked.parseInline(x, { async: false }) as string);

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

class Ctx {
  constructor(public opts: RenderOptions) {}
  usesCode = false;
  usesMath = false;

  /** Turn absolute local file paths into data URIs (inline mode) or file:// URLs. */
  url(src: string): string {
    if (/^(https?:|data:|file:|\/\/)/i.test(src) || !path.isAbsolute(src)) return src;
    if (!existsSync(src)) return src;
    const mime = MIME[path.extname(src).toLowerCase()];
    if (this.opts.embedLocalImages !== false && this.opts.assets !== "cdn" && mime) {
      const buf = readFileSync(src);
      if (buf.length < 25 * 1024 * 1024) return `data:${mime};base64,${buf.toString("base64")}`;
    }
    return "file://" + src.split(path.sep).map(encodeURIComponent).join("/").replace(/^\/?/, "/");
  }
}

function attr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  if (value === true) return ` ${name}`;
  return ` ${name}="${escapeHtml(String(value))}"`;
}

function body(text: string | undefined, slide: BaseSlide, ctx: Ctx): string {
  if (!text) return "";
  if (/\$\$|\\\(|\\\[/.test(text)) ctx.usesMath = true;
  if (/```|<code/.test(text)) ctx.usesCode = true;
  let html = slide.format === "html" ? text : md(text);
  if (slide.listFragments) {
    const effect = slide.listFragments === true ? "" : ` ${slide.listFragments}`;
    html = html.replace(/<li(\s[^>]*)?>/g, (_m, rest: string | undefined) => {
      if (rest && /class="/.test(rest)) return `<li${rest.replace(/class="/, `class="fragment${effect} `)}>`;
      return `<li class="fragment${effect}"${rest ?? ""}>`;
    });
  }
  return html;
}

function renderSlide(slide: BaseSlide, ctx: Ctx, inner = ""): string {
  const a: string[] = [];
  const bg = slide.background ?? {};
  a.push(attr("id", slide.id));
  const layout = slide.layout ?? "default";
  const classes = [layout !== "default" ? `layout-${layout}` : "", slide.className ?? ""].filter(Boolean).join(" ");
  a.push(attr("class", classes || undefined));
  a.push(attr("style", slide.style));
  a.push(attr("data-background-color", bg.color));
  a.push(attr("data-background-gradient", bg.gradient));
  a.push(attr("data-background-image", bg.image ? ctx.url(bg.image) : undefined));
  a.push(attr("data-background-size", bg.size));
  a.push(attr("data-background-position", bg.position));
  a.push(attr("data-background-repeat", bg.repeat));
  a.push(attr("data-background-opacity", bg.opacity));
  a.push(attr("data-background-video", bg.video ? ctx.url(bg.video) : undefined));
  a.push(attr("data-background-video-loop", bg.videoLoop));
  a.push(attr("data-background-video-muted", bg.videoMuted));
  a.push(attr("data-background-iframe", bg.iframe));
  a.push(attr("data-background-interactive", bg.interactive));
  a.push(attr("data-background-transition", bg.transition));
  const tr =
    slide.transitionIn || slide.transitionOut
      ? `${slide.transitionIn ?? slide.transition ?? "slide"}-in ${slide.transitionOut ?? slide.transition ?? "slide"}-out`
      : slide.transition;
  a.push(attr("data-transition", tr));
  a.push(attr("data-transition-speed", slide.transitionSpeed));
  a.push(attr("data-auto-animate", slide.autoAnimate));
  a.push(attr("data-auto-animate-id", slide.autoAnimateId));
  a.push(attr("data-auto-animate-restart", slide.autoAnimateRestart));
  a.push(attr("data-auto-animate-easing", slide.autoAnimateEasing));
  a.push(attr("data-auto-animate-duration", slide.autoAnimateDuration));
  a.push(attr("data-auto-animate-unmatched", slide.autoAnimateUnmatched));
  a.push(attr("data-autoslide", slide.autoSlide));
  a.push(attr("data-visibility", slide.visibility));
  for (const [k, v] of Object.entries(slide.attributes ?? {})) {
    if (/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k) && !/^on/i.test(k)) a.push(attr(k, v));
  }

  const parts: string[] = [];
  if (layout === "title") {
    if (slide.title) parts.push(`<h1>${mdInline(slide.title)}</h1>`);
    if (slide.subtitle) parts.push(`<p class="subtitle">${mdInline(slide.subtitle)}</p>`);
    parts.push(body(slide.content, slide, ctx));
  } else {
    if (slide.title) parts.push(`<h2>${mdInline(slide.title)}</h2>`);
    if (slide.subtitle) parts.push(`<p class="subtitle">${mdInline(slide.subtitle)}</p>`);
    if (layout === "columns" && slide.columns?.length) {
      parts.push(body(slide.content, slide, ctx));
      parts.push(
        `<div class="rmcp-columns">${slide.columns
          .map((c) => `<div class="rmcp-col">${body(c, slide, ctx)}</div>`)
          .join("")}</div>`
      );
    } else if ((layout === "image-left" || layout === "image-right") && slide.image) {
      const img = `<div class="rmcp-media"><img src="${escapeHtml(ctx.url(slide.image))}" alt=""></div>`;
      const txt = `<div class="rmcp-text">${body(slide.content, slide, ctx)}</div>`;
      parts.push(`<div class="rmcp-split">${layout === "image-left" ? img + txt : txt + img}</div>`);
    } else {
      parts.push(body(slide.content, slide, ctx));
    }
  }

  if (slide.code) {
    ctx.usesCode = true;
    const c = slide.code;
    parts.push(
      `<pre${attr("data-id", c.dataId)}><code${attr("class", c.language ? `language-${c.language}` : undefined)}${attr(
        "data-line-numbers",
        c.lineNumbers === true ? true : c.lineNumbers || undefined
      )} data-trim data-noescape>${escapeHtml(c.code)}</code></pre>`
    );
  }

  for (const f of slide.fragments ?? []) {
    const tag = /^[a-z][a-z0-9-]*$/i.test(f.tag ?? "") ? f.tag! : "p";
    const effect = f.effect && f.effect !== "fade-in" ? ` ${f.effect}` : "";
    const content = slide.format === "html" ? f.content : mdInline(f.content);
    parts.push(`<${tag} class="fragment${effect}"${attr("data-fragment-index", f.index)}>${content}</${tag}>`);
  }

  if (slide.notes) parts.push(`<aside class="notes">${md(slide.notes)}</aside>`);

  return `<section${a.join("")}>\n${inner}${parts.filter(Boolean).join("\n")}\n</section>`;
}

function renderSlides(slides: Slide[], ctx: Ctx): string {
  return slides
    .map((s) => {
      if (!s.verticalSlides?.length) return renderSlide(s, ctx);
      const { verticalSlides, ...first } = s;
      const children = [first, ...verticalSlides].map((v) => renderSlide(v, ctx)).join("\n");
      return `<section>\n${children}\n</section>`;
    })
    .join("\n\n");
}

const readDist = (rel: string) => fs.readFile(path.join(revealDist, rel), "utf8");
const safeScript = (js: string) => js.replace(/<\/script/gi, "<\\/script");
const safeStyle = (css: string) => css.replace(/<\/style/gi, "<\\/style");

export async function renderDeck(deck: Deck, opts: RenderOptions = {}): Promise<string> {
  const ctx = new Ctx(opts);
  const s = deck.settings;
  const slidesHtml = renderSlides(deck.slides, ctx);
  const theme = s.theme ?? "black";
  const hlTheme = s.highlightTheme ?? "monokai";

  const plugins: { file: string; global: string; expr: string }[] = [
    { file: "plugin/notes.js", global: "RevealNotes", expr: "RevealNotes" },
    { file: "plugin/zoom.js", global: "RevealZoom", expr: "RevealZoom" },
    { file: "plugin/search.js", global: "RevealSearch", expr: "RevealSearch" },
  ];
  if (ctx.usesCode) plugins.push({ file: "plugin/highlight.js", global: "RevealHighlight", expr: "RevealHighlight" });
  if (ctx.usesMath) plugins.push({ file: "plugin/math.js", global: "RevealMath", expr: "RevealMath.KaTeX" });

  const css = ["reset.css", "reveal.css", `theme/${theme}.css`];
  if (ctx.usesCode) css.push(`plugin/highlight/${hlTheme}.css`);
  const js = ["reveal.js", ...plugins.map((p) => p.file)];

  let styleTags: string;
  let scriptTags: string;
  if (opts.assets === "cdn") {
    styleTags = css.map((f) => `<link rel="stylesheet" href="${cdnBase}/${f}">`).join("\n");
    scriptTags = js.map((f) => `<script src="${cdnBase}/${f}"></script>`).join("\n");
  } else {
    const cssText = await Promise.all(css.map(readDist));
    const jsText = await Promise.all(js.map(readDist));
    // @import rules must come first in a stylesheet, so each file gets its own <style>.
    styleTags = cssText.map((c) => `<style>\n${safeStyle(c)}\n</style>`).join("\n");
    scriptTags = jsText.map((c) => `<script>\n${safeScript(c)}\n</script>`).join("\n");
  }

  const config: Record<string, unknown> = {
    hash: true,
    width: s.width ?? 1280,
    height: s.height ?? 720,
    transition: s.transition ?? "slide",
    transitionSpeed: s.transitionSpeed,
    backgroundTransition: s.backgroundTransition,
    controls: s.controls,
    progress: s.progress,
    slideNumber: s.slideNumber,
    center: s.center,
    loop: s.loop,
    autoSlide: s.autoSlide,
    autoSlideStoppable: s.autoSlideStoppable,
    autoAnimateDuration: s.autoAnimateDuration,
    autoAnimateEasing: s.autoAnimateEasing,
    navigationMode: s.navigationMode,
    view: s.view === "scroll" ? "scroll" : undefined,
    parallaxBackgroundImage: s.parallaxBackgroundImage ? ctx.url(s.parallaxBackgroundImage) : undefined,
    parallaxBackgroundSize: s.parallaxBackgroundSize,
    pdfSeparateFragments: s.pdfSeparateFragments ?? false,
    // Drop KaTeX's single-$ delimiter so prices like "$5" are never treated as math.
    katex: ctx.usesMath
      ? {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
        }
      : undefined,
  };
  for (const k of Object.keys(config)) if (config[k] === undefined) delete config[k];
  const pluginExpr = plugins.map((p) => p.expr).join(", ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="generator" content="reveal-mcp (reveal.js ${revealVersion})">
<title>${escapeHtml(deck.title)}</title>
${s.author ? `<meta name="author" content="${escapeHtml(s.author)}">` : ""}
${s.description ? `<meta name="description" content="${escapeHtml(s.description)}">` : ""}
${styleTags}
<style>
${LAYOUT_CSS}
${MOTION_CSS}
</style>
${s.customCss ? `<style>\n${safeStyle(s.customCss)}\n</style>` : ""}
${s.headHtml ?? ""}
</head>
<body>
<div class="reveal">
<div class="slides">
${slidesHtml}
</div>
</div>
${scriptTags}
<script>
Reveal.initialize(Object.assign(${JSON.stringify(config)}, { plugins: [${pluginExpr}] })).then(function () {
  window.__revealReady = true;
${s.customJs ? safeScript(s.customJs) : ""}
});
</script>
</body>
</html>
`;
}

export { revealVersion };
