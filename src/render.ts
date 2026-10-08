import { promises as fs, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Marked } from "marked";
import type { BaseSlide, Deck, Slide } from "./schema.js";
import { MOTION_CSS, LAYOUT_CSS } from "./styles.js";
import { COMPONENT_CSS, componentRuntime, renderComponent } from "./components.js";
import { AUTO_MOTION_CSS, PRESET_DEFS, googleFontsLink, presetCss } from "./presets.js";
import sanitizeHtml from "sanitize-html";
import { assertSafeCss, assertSafeDeck, builtInCdnAllowed, isTrustedMode, safeCsp, sniffMedia, validateAssetUrl } from "./security.js";

const DARK_THEMES = new Set(["black", "black-contrast", "league", "night", "blood", "moon", "dracula"]);
const MERMAID_CDN = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

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

const SAFE_TAGS = [
  "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p",
  "pre", "q", "s", "small", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
];

/**
 * Safe mode: keep layout and motion markup (classes, inline styles, data-id for auto-animate, fragments)
 * but drop scripts, event handlers, iframes, forms and anything that can load from the network via CSS.
 */
function sanitizeFragment(html: string, ctx: Ctx): string {
  if (isTrustedMode()) return html;
  return sanitizeHtml(html, {
    allowedTags: SAFE_TAGS,
    allowedAttributes: {
      "*": ["class", "style", "title", "lang", "dir", "role", "aria-*", "data-id", "data-fragment-index", "data-auto-animate-*"],
      a: ["href", "class", "style", "title"],
      img: ["src", "alt", "width", "height", "class", "style", "title", "data-id"],
      code: ["class", "data-line-numbers", "data-trim", "data-noescape"],
      ol: ["start", "class", "style"],
      td: ["colspan", "rowspan", "class", "style"],
      th: ["colspan", "rowspan", "class", "style"],
    },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https", "data"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      "*": (tagName, attribs) => {
        if (attribs.style) assertSafeCss(attribs.style, `inline style on <${tagName}>`);
        if (tagName === "img" && attribs.src) {
          // A missing or non-image file becomes a broken image, which the layout check reports.
          try {
            attribs.src = ctx.url(attribs.src);
          } catch {
            delete attribs.src;
          }
        }
        return { tagName, attribs };
      },
    },
  });
}

const md = (s: string, ctx: Ctx) => protectMath(s, (x) => sanitizeFragment(marked.parse(x, { async: false }) as string, ctx));
const mdInline = (s: string, ctx: Ctx) => protectMath(s, (x) => sanitizeFragment(marked.parseInline(x, { async: false }) as string, ctx));

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
  usesComponents = false;
  usesMermaid = false;
  sectionBg?: string;

  /** Validate assets, then turn local files into data URIs where possible. */
  url(src: string): string {
    const validated = validateAssetUrl(src);
    if (/^(https?:|data:|file:|\/\/)/i.test(validated)) return validated;
    if (isTrustedMode() && !path.isAbsolute(validated)) return validated;
    const local = path.resolve(validated);
    if (!existsSync(local)) throw new Error(`Asset does not exist: ${src}`);
    const mime = MIME[path.extname(local).toLowerCase()] ?? sniffMedia(local);
    if (this.opts.embedLocalImages !== false && this.opts.assets !== "cdn" && mime) {
      const buf = readFileSync(local);
      if (buf.length < 25 * 1024 * 1024) return `data:${mime};base64,${buf.toString("base64")}`;
    }
    if (!isTrustedMode()) {
      throw new Error(`Local asset is too large or has an unsupported type for safe embedding: ${src}`);
    }
    return "file://" + local.split(path.sep).map(encodeURIComponent).join("/").replace(/^\/?/, "/");
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
  let html = slide.format === "html" ? sanitizeFragment(text, ctx) : md(text, ctx);
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
  if (layout === "section" && ctx.sectionBg && !Object.keys(bg).length) {
    if (/gradient\(/.test(ctx.sectionBg)) a.push(attr("data-background-gradient", ctx.sectionBg));
    else a.push(attr("data-background-color", ctx.sectionBg));
  }
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
  a.push(attr("data-rmcp-duration", slide.duration));
  for (const [k, v] of Object.entries(slide.attributes ?? {})) {
    if (/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(k) && !/^on/i.test(k)) a.push(attr(k, v));
  }

  const parts: string[] = [];
  if (layout === "title") {
    if (slide.title) parts.push(`<h1>${mdInline(slide.title, ctx)}</h1>`);
    if (slide.subtitle) parts.push(`<p class="subtitle">${mdInline(slide.subtitle, ctx)}</p>`);
    parts.push(body(slide.content, slide, ctx));
  } else {
    if (slide.title) parts.push(`<h2>${mdInline(slide.title, ctx)}</h2>`);
    if (slide.subtitle) parts.push(`<p class="subtitle">${mdInline(slide.subtitle, ctx)}</p>`);
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

  if (slide.component) {
    ctx.usesComponents = true;
    if (slide.component.type === "diagram") ctx.usesMermaid = true;
    parts.push(renderComponent(slide.component, (text) => mdInline(text, ctx)));
  }

  for (const f of slide.fragments ?? []) {
    const requestedTag = f.tag ?? "p";
    const tag = isTrustedMode()
      ? (/^[a-z][a-z0-9-]*$/i.test(requestedTag) ? requestedTag : "p")
      : (/^(?:p|div|span|li|blockquote|strong|em|small)$/i.test(requestedTag) ? requestedTag : "p");
    const effect = f.effect && f.effect !== "fade-in" ? ` ${f.effect}` : "";
    const content = slide.format === "html" ? sanitizeFragment(f.content, ctx) : mdInline(f.content, ctx);
    parts.push(`<${tag} class="fragment${effect}"${attr("data-fragment-index", f.index)}>${content}</${tag}>`);
  }

  if (slide.notes) parts.push(`<aside class="notes">${md(slide.notes, ctx)}</aside>`);

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
  assertSafeDeck(deck);
  if (opts.assets === "cdn" && !builtInCdnAllowed()) {
    throw new Error("CDN asset mode is disabled in safe mode. Set MOTIONDECK_ALLOW_BUILTIN_CDN=1 or use inline assets.");
  }
  const ctx = new Ctx(opts);
  const s = deck.settings;
  const preset = s.preset ? PRESET_DEFS[s.preset] : undefined;
  ctx.sectionBg = preset?.sectionBg;
  const slidesHtml = renderSlides(deck.slides, ctx);
  const theme = preset?.theme ?? s.theme ?? "black";
  const dark = preset?.dark ?? DARK_THEMES.has(theme);
  const motion = s.motion ?? preset?.motion ?? "none";
  const fonts = [...(preset?.fonts ?? [])];
  let brandCss = "";
  let logoHtml = "";
  if (s.brand) {
    const b = s.brand;
    const fam = (f: string) => `'${f.replace(/'/g, "")}', system-ui, sans-serif`;
    const v: string[] = [];
    if (b.primary) v.push(`--r-link-color: ${b.primary}; --rmcp-accent: ${b.primary}; --rmcp-c1: ${b.primary};`);
    if (b.font) { fonts.push(`${b.font}:wght@400;600;700`); v.push(`--r-main-font: ${fam(b.font)};`); }
    if (b.headingFont) { fonts.push(`${b.headingFont}:wght@600;700;800`); v.push(`--r-heading-font: ${fam(b.headingFont)};`); }
    if (v.length) brandCss = `.reveal-viewport, .reveal { ${v.join(" ")} }`;
    if (b.logo) {
      const pos = (b.logoPosition ?? "bottom-left").split("-");
      logoHtml = `<img class="rmcp-logo" alt="" src="${escapeHtml(ctx.url(b.logo))}" style="${pos[0]}:18px;${pos[1]}:24px">`;
      brandCss += `\n.reveal .rmcp-logo { position: absolute; z-index: 20; height: 44px; width: auto; pointer-events: none; }`;
    }
  }
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
    transition: s.transition ?? preset?.transition ?? "slide",
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

  let runtime = "";
  let mermaidTag = "";
  if (ctx.usesComponents) {
    const local = process.env.MOTIONDECK_MERMAID;
    const inlineMermaid = ctx.usesMermaid && local && existsSync(local) && opts.assets !== "cdn";
    if (inlineMermaid) mermaidTag = `<script>\n${safeScript(readFileSync(local!, "utf8"))}\n</script>`;
    const allowRemoteMermaid = isTrustedMode() || builtInCdnAllowed();
    runtime = componentRuntime({
      dark,
      mermaidSrc: ctx.usesMermaid && allowRemoteMermaid ? MERMAID_CDN : undefined,
      mermaidInline: inlineMermaid ? "yes" : undefined,
    });
  }

  const useFonts = fonts.length > 0 && (isTrustedMode() || builtInCdnAllowed());
  const csp = safeCsp({ assets: opts.assets, needsMermaid: ctx.usesMermaid, needsMath: ctx.usesMath, usesFonts: useFonts });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="generator" content="motiondeck (reveal.js ${revealVersion})">
${csp ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">` : ""}
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(deck.title)}</title>
${s.author ? `<meta name="author" content="${escapeHtml(s.author)}">` : ""}
${s.description ? `<meta name="description" content="${escapeHtml(s.description)}">` : ""}
${styleTags}
${useFonts ? googleFontsLink(fonts) : ""}
<style>
${LAYOUT_CSS}
${MOTION_CSS}
${ctx.usesComponents ? COMPONENT_CSS : ""}
${motion !== "none" ? AUTO_MOTION_CSS : ""}
${preset ? presetCss(preset) : ""}
${brandCss}
</style>
${s.customCss ? `<style>\n${safeStyle(s.customCss)}\n</style>` : ""}
${s.headHtml ?? ""}
</head>
<body>
<div class="reveal${motion !== "none" ? ` rmcp-motion-${motion}` : ""}">
${logoHtml}
<div class="slides">
${slidesHtml}
</div>
</div>
${scriptTags}
${mermaidTag}
<script>
Reveal.initialize(Object.assign(${safeScript(JSON.stringify(config))}, { plugins: [${pluginExpr}] })).then(function () {
${runtime}
  window.__revealReady = true;
${s.customJs ? safeScript(s.customJs) : ""}
});
</script>
</body>
</html>
`;
}

export { revealVersion };
