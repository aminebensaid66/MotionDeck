import { z } from "zod";

/** Data-driven slide components: the model sends data, the server draws a designed, animated slide. */

const text = z.string();
const stepByStep = z.boolean().optional();

export const ComponentSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("stats"),
    items: z
      .array(
        z.strictObject({
          value: z.union([z.number(), z.string()]),
          label: text,
          prefix: z.string().optional(),
          suffix: z.string().optional(),
        })
      )
      .min(1)
      .max(6),
  }),
  z.strictObject({
    type: z.literal("timeline"),
    items: z.array(z.strictObject({ date: text, title: text, text: text.optional() })).min(1).max(8),
    stepByStep,
  }),
  z.strictObject({
    type: z.literal("cards"),
    items: z.array(z.strictObject({ icon: text.optional(), title: text, text: text.optional() })).min(1).max(8),
    columns: z.number().int().min(1).max(4).optional(),
    stepByStep,
  }),
  z.strictObject({
    type: z.literal("quote"),
    text,
    author: text.optional(),
    role: text.optional(),
  }),
  z.strictObject({
    type: z.literal("comparison"),
    left: z.strictObject({ title: text, items: z.array(text) }),
    right: z.strictObject({ title: text, items: z.array(text) }),
    stepByStep,
  }),
  z.strictObject({
    type: z.literal("steps"),
    items: z.array(z.strictObject({ title: text, text: text.optional() })).min(1).max(6),
    stepByStep,
  }),
  z.strictObject({
    type: z.literal("chart"),
    kind: z.enum(["bar", "hbar", "line", "donut"]),
    labels: z.array(text).min(1),
    series: z.array(z.strictObject({ name: text.optional(), values: z.array(z.number()) })).min(1).max(6),
    unit: text.optional(),
    max: z.number().optional(),
  }),
  z.strictObject({
    type: z.literal("diagram"),
    code: text.describe("Mermaid source, e.g. 'flowchart LR\\n A-->B'"),
  }),
]);

export type Component = z.infer<typeof ComponentSchema>;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Items either animate in on their own (staggered) or become fragments revealed one by one. */
const item = (i: number, step?: boolean) =>
  step ? ` class="fragment fade-up" style="--i:${i}"` : ` class="rmcp-in" style="--i:${i}"`;

function parseStat(v: number | string, prefix?: string, suffix?: string) {
  if (typeof v === "number") return { pre: prefix ?? "", num: v, post: suffix ?? "" };
  const m = v.match(/^([^\d\-.]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return { pre: prefix ?? "", num: undefined, raw: v, post: suffix ?? "" };
  return { pre: (prefix ?? "") + m[1], num: Number(m[2].replace(/,/g, "")), post: m[3] + (suffix ?? "") };
}

const fmt = (n: number, d: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function chart(c: Extract<Component, { type: "chart" }>): string {
  const unit = c.unit ? esc(c.unit) : "";
  const label = (v: number) => `${fmt(v, Number.isInteger(v) ? 0 : 1)}${unit}`;
  const legend =
    c.series.length > 1 && c.kind !== "donut"
      ? `<div class="rmcp-legend">${c.series
          .map((s, i) => `<span><i style="background:var(--rmcp-c${i + 1})"></i>${esc(s.name ?? `Series ${i + 1}`)}</span>`)
          .join("")}</div>`
      : "";

  if (c.kind === "donut") {
    const values = c.series[0].values;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let offset = 0;
    const segs = values
      .map((v, i) => {
        const pct = (v / total) * 100;
        const seg = `<circle class="rmcp-donut-seg" cx="100" cy="100" r="80" pathLength="100" style="--i:${i};stroke:var(--rmcp-c${(i % 6) + 1});stroke-dasharray:${pct.toFixed(2)} 100;stroke-dashoffset:${(-offset).toFixed(2)}"/>`;
        offset += pct;
        return seg;
      })
      .join("");
    const keys = values
      .map(
        (v, i) =>
          `<li class="rmcp-in" style="--i:${i}"><i style="background:var(--rmcp-c${(i % 6) + 1})"></i>${esc(c.labels[i] ?? "")} <b>${Math.round((v / total) * 100)}%</b></li>`
      )
      .join("");
    return `<div class="rmcp-chart rmcp-donut"><svg viewBox="0 0 200 200" role="img"><circle cx="100" cy="100" r="80" class="rmcp-donut-track"/>${segs}</svg><ul class="rmcp-donut-keys">${keys}</ul></div>`;
  }

  const W = 900, H = 420, padL = 20, padR = 20, padT = 40, padB = 50;
  const all = c.series.flatMap((s) => s.values);
  const max = c.max ?? niceMax(Math.max(...all, 0));
  const n = c.labels.length;

  if (c.kind === "hbar") {
    const rowH = (H - 10) / n;
    const lw = 180;
    const bh = Math.min(36, (rowH * 0.7) / c.series.length);
    const rows = c.labels
      .map((l, i) => {
        const y = 5 + i * rowH + (rowH - bh * c.series.length) / 2;
        const bars = c.series
          .map((s, j) => {
            const v = s.values[i] ?? 0;
            const w = ((W - lw - 90) * v) / max;
            const by = y + j * bh;
            return `<rect class="rmcp-hbar" x="${lw}" y="${by.toFixed(1)}" width="${Math.max(w, 0).toFixed(1)}" height="${(bh - 4).toFixed(1)}" rx="4" style="--i:${i};fill:var(--rmcp-c${j + 1})"/><text class="rmcp-val rmcp-in" style="--i:${i}" x="${(lw + w + 10).toFixed(1)}" y="${(by + bh / 2 + 6).toFixed(1)}">${label(v)}</text>`;
          })
          .join("");
        return `<text class="rmcp-axis" x="${lw - 14}" y="${(y + (bh * c.series.length) / 2 + 6).toFixed(1)}" text-anchor="end">${esc(l)}</text>${bars}`;
      })
      .join("");
    return `<div class="rmcp-chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img">${rows}</svg></div>`;
  }

  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x0 = padL, y0 = padT + plotH;
  const grid = [0.25, 0.5, 0.75, 1]
    .map((f) => `<line class="rmcp-grid" x1="${x0}" x2="${x0 + plotW}" y1="${(y0 - plotH * f).toFixed(1)}" y2="${(y0 - plotH * f).toFixed(1)}"/>`)
    .join("");
  const slot = plotW / n;
  const xlabels = c.labels
    .map((l, i) => `<text class="rmcp-axis" x="${(x0 + slot * (i + 0.5)).toFixed(1)}" y="${y0 + 34}" text-anchor="middle">${esc(l)}</text>`)
    .join("");
  const base = `<line class="rmcp-base" x1="${x0}" x2="${x0 + plotW}" y1="${y0}" y2="${y0}"/>`;

  if (c.kind === "bar") {
    const groupW = slot * 0.7;
    const bw = groupW / c.series.length;
    const bars = c.labels
      .map((_, i) =>
        c.series
          .map((s, j) => {
            const v = s.values[i] ?? 0;
            const h = (plotH * v) / max;
            const x = x0 + slot * i + (slot - groupW) / 2 + j * bw;
            return `<rect class="rmcp-bar" x="${(x + 2).toFixed(1)}" y="${(y0 - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="4" style="--i:${i};fill:var(--rmcp-c${j + 1})"/>` +
              (c.series.length <= 2
                ? `<text class="rmcp-val rmcp-in" style="--i:${i}" x="${(x + bw / 2).toFixed(1)}" y="${(y0 - h - 10).toFixed(1)}" text-anchor="middle">${label(v)}</text>`
                : "");
          })
          .join("")
      )
      .join("");
    return `<div class="rmcp-chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${bars}${base}${xlabels}</svg></div>`;
  }

  // line
  const lines = c.series
    .map((s, j) => {
      const pts = s.values.map((v, i) => [x0 + slot * (i + 0.5), y0 - (plotH * v) / max] as const);
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
      const dots = pts
        .map(
          (p, i) =>
            `<circle class="rmcp-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="7" style="--i:${i};fill:var(--rmcp-c${j + 1})"/>` +
            (c.series.length === 1
              ? `<text class="rmcp-val rmcp-in" style="--i:${i}" x="${p[0].toFixed(1)}" y="${(p[1] - 16).toFixed(1)}" text-anchor="middle">${label(s.values[i])}</text>`
              : "")
        )
        .join("");
      return `<path class="rmcp-line" pathLength="1" d="${d}" style="--j:${j};stroke:var(--rmcp-c${j + 1})"/>${dots}`;
    })
    .join("");
  return `<div class="rmcp-chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${base}${lines}${xlabels}</svg></div>`;
}

export function renderComponent(c: Component, inline: (s: string) => string): string {
  switch (c.type) {
    case "stats":
      return `<div class="rmcp-stats" style="--n:${c.items.length}">${c.items
        .map((s, i) => {
          const p = parseStat(s.value, s.prefix, s.suffix);
          const decimals = p.num !== undefined && !Number.isInteger(p.num) ? String(p.num).split(".")[1].length : 0;
          const num =
            p.num === undefined
              ? esc(p.raw ?? "")
              : `<span data-count="${p.num}" data-decimals="${decimals}">${fmt(p.num, decimals)}</span>`;
          return `<div${item(i)}><div class="rmcp-stat-value">${esc(p.pre)}${num}${esc(p.post)}</div><div class="rmcp-stat-label">${inline(s.label)}</div></div>`;
        })
        .join("")}</div>`;
    case "timeline":
      return `<div class="rmcp-timeline" style="--n:${c.items.length}"><div class="rmcp-timeline-line"></div>${c.items
        .map(
          (t, i) =>
            `<div${item(i, c.stepByStep)}><div class="rmcp-tl-dot"></div><div class="rmcp-tl-date">${esc(t.date)}</div><div class="rmcp-tl-title">${inline(t.title)}</div>${t.text ? `<div class="rmcp-tl-text">${inline(t.text)}</div>` : ""}</div>`
        )
        .join("")}</div>`;
    case "cards": {
      const cols = c.columns ?? (c.items.length <= 3 ? c.items.length : c.items.length === 4 ? 2 : 3);
      return `<div class="rmcp-cards" style="--cols:${cols}">${c.items
        .map(
          (k, i) =>
            `<div${item(i, c.stepByStep)}>${k.icon ? `<div class="rmcp-card-icon">${esc(k.icon)}</div>` : ""}<div class="rmcp-card-title">${inline(k.title)}</div>${k.text ? `<div class="rmcp-card-text">${inline(k.text)}</div>` : ""}</div>`
        )
        .join("")}</div>`;
    }
    case "quote":
      return `<figure class="rmcp-quote"><blockquote class="rmcp-in" style="--i:0">${inline(c.text)}</blockquote>${
        c.author
          ? `<figcaption class="rmcp-in" style="--i:2"><b>${esc(c.author)}</b>${c.role ? `<span>${esc(c.role)}</span>` : ""}</figcaption>`
          : ""
      }</figure>`;
    case "comparison": {
      const side = (s: { title: string; items: string[] }, cls: string, off: number) =>
        `<div class="rmcp-cmp-${cls} rmcp-in" style="--i:${off}"><div class="rmcp-cmp-title">${inline(s.title)}</div><ul>${s.items
          .map((x, i) => `<li${c.stepByStep ? ` class="fragment fade-up"` : ""} style="--i:${off + i}">${inline(x)}</li>`)
          .join("")}</ul></div>`;
      return `<div class="rmcp-comparison">${side(c.left, "left", 0)}<div class="rmcp-cmp-vs rmcp-in" style="--i:1">→</div>${side(c.right, "right", 2)}</div>`;
    }
    case "steps":
      return `<ol class="rmcp-steps" style="--n:${c.items.length}">${c.items
        .map(
          (s, i) =>
            `<li${item(i, c.stepByStep)}><div class="rmcp-step-num">${i + 1}</div><div class="rmcp-step-title">${inline(s.title)}</div>${s.text ? `<div class="rmcp-step-text">${inline(s.text)}</div>` : ""}</li>`
        )
        .join("")}</ol>`;
    case "chart":
      return chart(c);
    case "diagram":
      return `<div class="rmcp-diagram rmcp-in" style="--i:0"><pre class="mermaid">${esc(c.code)}</pre></div>`;
  }
}

export const COMPONENT_CSS = `
.reveal { --rmcp-accent: var(--r-link-color); --rmcp-surface: rgba(127,127,127,.12); --rmcp-border: rgba(127,127,127,.25); --rmcp-muted: color-mix(in srgb, var(--r-main-color) 65%, transparent);
  --rmcp-c1: var(--rmcp-accent); --rmcp-c2: #22d3ee; --rmcp-c3: #f472b6; --rmcp-c4: #facc15; --rmcp-c5: #34d399; --rmcp-c6: #fb923c; }
.reveal .rmcp-stats { display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: 1em; margin: .8em 0; text-align: center; }
.reveal .rmcp-stat-value { font-family: var(--r-heading-font); font-weight: 800; font-size: 3em; line-height: 1.1; color: var(--rmcp-accent); font-variant-numeric: tabular-nums; }
.reveal .rmcp-stat-label { font-size: .8em; color: var(--rmcp-muted); margin-top: .3em; }
.reveal .rmcp-timeline { position: relative; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: .6em; margin: 1.2em 0 .4em; text-align: left; }
.reveal .rmcp-timeline-line { position: absolute; left: 0; right: 0; top: .45em; height: 3px; background: var(--rmcp-border); }
.reveal .rmcp-tl-dot { position: relative; width: .9em; height: .9em; border-radius: 50%; background: var(--rmcp-accent); box-shadow: 0 0 0 .25em color-mix(in srgb, var(--rmcp-accent) 25%, transparent); margin-bottom: .6em; }
.reveal .rmcp-tl-date { font-size: .7em; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--rmcp-accent); }
.reveal .rmcp-tl-title { font-size: .95em; font-weight: 700; margin: .15em 0; }
.reveal .rmcp-tl-text { font-size: .72em; color: var(--rmcp-muted); line-height: 1.35; }
.reveal .rmcp-cards { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: .6em; margin: .6em 0; text-align: left; }
.reveal .rmcp-cards > div { background: var(--rmcp-surface); border: 1px solid var(--rmcp-border); border-radius: 18px; padding: .9em 1em; backdrop-filter: blur(8px); }
.reveal .rmcp-card-icon { font-size: 1.6em; line-height: 1; margin-bottom: .3em; }
.reveal .rmcp-card-title { font-size: .95em; font-weight: 700; margin-bottom: .2em; }
.reveal .rmcp-card-text { font-size: .72em; color: var(--rmcp-muted); line-height: 1.4; }
.reveal .rmcp-quote { margin: .5em auto; max-width: 85%; text-align: left; }
.reveal .rmcp-quote blockquote { position: relative; width: auto; margin: 0; padding: 0 0 0 .2em; background: none; box-shadow: none; font-family: var(--r-heading-font); font-size: 1.5em; line-height: 1.3; font-style: normal; }
.reveal .rmcp-quote blockquote::before { content: "\\201C"; position: absolute; left: -.55em; top: -.25em; font-size: 2.6em; line-height: 1; color: var(--rmcp-accent); opacity: .8; }
.reveal .rmcp-quote figcaption { margin-top: 1em; font-size: .85em; }
.reveal .rmcp-quote figcaption span { display: block; color: var(--rmcp-muted); font-size: .85em; }
.reveal .rmcp-comparison { display: grid; grid-template-columns: 1fr auto 1fr; gap: .6em; align-items: stretch; text-align: left; margin: .6em 0; }
.reveal .rmcp-comparison > div:not(.rmcp-cmp-vs) { border-radius: 18px; padding: .8em 1em; background: var(--rmcp-surface); border: 1px solid var(--rmcp-border); }
.reveal .rmcp-cmp-right { border-color: var(--rmcp-accent) !important; background: color-mix(in srgb, var(--rmcp-accent) 14%, transparent) !important; }
.reveal .rmcp-cmp-title { font-weight: 700; font-size: 1em; margin-bottom: .3em; }
.reveal .rmcp-cmp-right .rmcp-cmp-title { color: var(--rmcp-accent); }
.reveal .rmcp-comparison ul { margin: 0 0 0 1em; font-size: .8em; }
.reveal .rmcp-comparison li { margin: .25em 0; }
.reveal .rmcp-cmp-vs { align-self: center; font-size: 1.2em; color: var(--rmcp-accent); }
.reveal .rmcp-steps { list-style: none; display: grid; grid-template-columns: repeat(var(--n), 1fr); gap: .8em; margin: .8em 0; padding: 0; text-align: center; counter-reset: none; }
.reveal .rmcp-steps li { position: relative; }
.reveal .rmcp-steps li:not(:last-child)::after { content: ""; position: absolute; top: .9em; left: calc(50% + 1.2em); right: calc(-50% + 1.2em - .8em); height: 3px; background: var(--rmcp-border); }
.reveal .rmcp-step-num { width: 1.8em; height: 1.8em; line-height: 1.8em; margin: 0 auto .5em; border-radius: 50%; background: var(--rmcp-accent); color: var(--r-background-color); font-weight: 800; font-size: .9em; }
.reveal .rmcp-step-title { font-size: .95em; font-weight: 700; }
.reveal .rmcp-step-text { font-size: .72em; color: var(--rmcp-muted); margin-top: .2em; line-height: 1.35; }
.reveal .rmcp-chart { margin: .3em auto 0; width: 100%; }
.reveal .rmcp-chart svg { width: 100%; max-height: 470px; overflow: visible; }
.reveal .rmcp-chart text { fill: currentColor; font-family: var(--r-main-font); }
.reveal .rmcp-axis { font-size: 26px; opacity: .75; }
.reveal .rmcp-val { font-size: 26px; font-weight: 700; }
.reveal .rmcp-grid { stroke: var(--rmcp-border); stroke-dasharray: 4 6; }
.reveal .rmcp-base { stroke: var(--rmcp-border); stroke-width: 2; }
.reveal .rmcp-line { fill: none; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
.reveal .rmcp-legend { display: flex; gap: 1.2em; justify-content: center; font-size: .7em; margin-bottom: .2em; }
.reveal .rmcp-legend i, .reveal .rmcp-donut-keys i { display: inline-block; width: .8em; height: .8em; border-radius: 3px; margin-right: .4em; vertical-align: -.05em; }
.reveal .rmcp-donut { display: flex; align-items: center; justify-content: center; gap: 1.5em; }
.reveal .rmcp-donut svg { width: 400px; height: 400px; transform: rotate(-90deg); }
.reveal .rmcp-donut circle { fill: none; stroke-width: 34; }
.reveal .rmcp-donut-track { stroke: var(--rmcp-surface); }
.reveal .rmcp-donut-keys { list-style: none; margin: 0; padding: 0; text-align: left; font-size: .85em; }
.reveal .rmcp-donut-keys li { margin: .35em 0; }
.reveal .rmcp-diagram { display: flex; justify-content: center; }
.reveal .rmcp-diagram pre.mermaid { box-shadow: none; background: none; width: 100%; margin: 0; font-size: .6em; text-align: center; white-space: normal; }
.reveal .rmcp-diagram svg { width: 100%; height: auto; max-height: 480px; max-width: 100% !important; }

/* Motion for components: plays when the slide becomes current. */
@keyframes rmcp-in { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes rmcp-grow-y { from { transform: scaleY(0); } }
@keyframes rmcp-grow-x { from { transform: scaleX(0); } }
@keyframes rmcp-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes rmcp-pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: none; } }
@keyframes rmcp-donut { from { stroke-dasharray: 0 100; } }
.reveal .slides section.present:not(.stack) .rmcp-in { animation: rmcp-in .7s cubic-bezier(.2,.8,.2,1) calc(.15s + var(--i, 0) * .12s) both; }
.reveal .slides section.present:not(.stack) .rmcp-bar { transform-box: fill-box; transform-origin: bottom; animation: rmcp-grow-y .9s cubic-bezier(.2,.8,.2,1) calc(.2s + var(--i, 0) * .08s) both; }
.reveal .slides section.present:not(.stack) .rmcp-hbar { transform-box: fill-box; transform-origin: left; animation: rmcp-grow-x .9s cubic-bezier(.2,.8,.2,1) calc(.2s + var(--i, 0) * .08s) both; }
.reveal .rmcp-line { stroke-dasharray: 1; }
.reveal .slides section.present:not(.stack) .rmcp-line { animation: rmcp-draw 1.4s ease-in-out calc(.2s + var(--j, 0) * .25s) both; }
.reveal .slides section.present:not(.stack) .rmcp-dot { transform-box: fill-box; transform-origin: center; animation: rmcp-pop .4s ease-out calc(.3s + var(--i, 0) * .15s) both; }
.reveal .slides section.present:not(.stack) .rmcp-donut-seg { animation: rmcp-donut 1s cubic-bezier(.2,.8,.2,1) calc(.2s + var(--i, 0) * .15s) both; }
.reveal .slides section.present:not(.stack) .rmcp-timeline-line { transform-origin: left; animation: rmcp-grow-x 1s ease-out both; }
html.print-pdf .reveal [class*="rmcp-"] { animation: none !important; }
@media (prefers-reduced-motion: reduce) { .reveal [class*="rmcp-"] { animation: none !important; } }
`;

/** Small runtime: count-up numbers and lazy Mermaid rendering. Runs after Reveal is ready. */
export function componentRuntime(opts: { mermaidSrc?: string; mermaidInline?: string; dark: boolean }): string {
  return `(function () {
  var isStatic = function () { return window.__rmcpStatic || document.documentElement.classList.contains('print-pdf'); };
  function fmt(n, d) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function countUp(slide) {
    if (!slide || isStatic()) return;
    slide.querySelectorAll('[data-count]').forEach(function (el) {
      var to = parseFloat(el.getAttribute('data-count')), d = +el.getAttribute('data-decimals') || 0, t0 = null, dur = 1600;
      el.textContent = fmt(0, d);
      function step(t) { if (t0 === null) t0 = t; var p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(to * e, d); if (p < 1) requestAnimationFrame(step); }
      setTimeout(function () { requestAnimationFrame(step); }, 200);
    });
  }
  var mermaidReady = null;
  function loadMermaid() {
    if (mermaidReady) return mermaidReady;
    mermaidReady = new Promise(function (resolve) {
      ${
        opts.mermaidInline
          ? "resolve();"
          : opts.mermaidSrc
            ? `var s = document.createElement('script'); s.src = ${JSON.stringify(opts.mermaidSrc)}; s.onload = resolve; s.onerror = resolve; document.head.appendChild(s);`
            : "resolve();"
      }
    }).then(function () {
      if (!window.mermaid) return;
      var cs = getComputedStyle(document.querySelector('.reveal'));
      var v = function (n, d) { var x = cs.getPropertyValue(n).trim(); return x && !/^(var|color-mix)/.test(x) ? x : d; };
      var bg = v('--r-background-color', ${JSON.stringify(opts.dark ? "#111111" : "#ffffff")});
      var accent = v('--rmcp-accent', v('--r-link-color', '#4f8cff'));
      var text = v('--r-main-color', ${JSON.stringify(opts.dark ? "#eeeeee" : "#222222")});
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: v('--r-main-font', 'sans-serif'),
        themeVariables: { darkMode: ${opts.dark}, fontSize: '22px', background: bg, primaryColor: bg, secondaryColor: bg, tertiaryColor: bg,
          primaryTextColor: text, secondaryTextColor: text, tertiaryTextColor: text, textColor: text, nodeTextColor: text,
          primaryBorderColor: accent, secondaryBorderColor: accent, tertiaryBorderColor: accent, lineColor: accent,
          edgeLabelBackground: bg, clusterBkg: bg, clusterBorder: accent, mainBkg: bg, nodeBorder: accent, titleColor: text } });
    });
    return mermaidReady;
  }
  // Render every diagram once, up front, in mermaid's own off-screen container (independent of
  // which slide is visible), then drop the SVG into place.
  var diagramSeq = 0;
  function diagrams() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('pre.mermaid:not([data-processed])'));
    if (!nodes.length) return;
    nodes.forEach(function (n) { n.setAttribute('data-processed', 'pending'); });
    loadMermaid().then(function () {
      if (!window.mermaid) { nodes.forEach(function (n) { n.setAttribute('data-processed', 'error'); }); return; }
      return nodes.reduce(function (p, n) {
        return p.then(function () {
          return window.mermaid.render('rmcp-mmd-' + (diagramSeq++), n.textContent).then(function (r) {
            n.innerHTML = r.svg;
            n.setAttribute('data-processed', 'true');
          }, function (e) {
            n.textContent = 'Diagram error: ' + (e && e.message ? e.message : e);
            n.setAttribute('data-processed', 'error');
          });
        });
      }, Promise.resolve()).then(function () { Reveal.layout(); });
    });
  }
  Reveal.on('slidechanged', function (e) { countUp(e.currentSlide); });
  diagrams();
  countUp(Reveal.getCurrentSlide());
})();`;
}
