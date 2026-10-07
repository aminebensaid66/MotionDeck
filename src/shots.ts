import type { Page } from "puppeteer-core";
import { withDeckPage } from "./browser.js";
import { escapeHtml } from "./render.js";

export interface SlideShot {
  /** "3" for top-level slide 3, "3.1" for the first vertical slide under it. */
  slide: string;
  index: number;
  verticalIndex: number;
  title: string;
  issues: string[];
  jpeg: Buffer;
}

export interface ShotOptions {
  deckWidth: number;
  deckHeight: number;
  /** Pixel width of each screenshot. */
  imageWidth?: number;
  /** Only these slides, as "3" or "3.1". */
  only?: string[];
  /** Also lay all screenshots out on one contact-sheet image. */
  sheet?: boolean;
  /** false = only run the layout checks, no screenshots. */
  images?: boolean;
  quality?: number;
}

/** Turns off every CSS transition/animation so a slide renders in its final state instantly. */
const FREEZE_CSS = `*, *::before, *::after {
  transition-duration: 0s !important; transition-delay: 0s !important;
  animation-duration: 0s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
}`;

declare const Reveal: any;

/** Runs in the page: inspects the current slide for layout problems. Returns human-readable issues. */
function inspectCurrentSlide(): { title: string; issues: string[] } {
  const slide: HTMLElement = Reveal.getCurrentSlide();
  const scale: number = Reveal.getScale() || 1;
  const { width, height } = Reveal.getComputedSlideSize();
  const container = (document.querySelector(".reveal .slides") as HTMLElement).getBoundingClientRect();
  // The logical slide area, in viewport pixels.
  const left = container.left + (container.width - width * scale) / 2;
  const top = container.top + (container.height - height * scale) / 2;
  const area = { left, top, right: left + width * scale, bottom: top + height * scale };
  const issues: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let visible = 0;
  slide.querySelectorAll("*").forEach((el) => {
    if (el.closest("aside.notes") || el.closest("script,style")) return;
    // An SVG's drawing is clipped to its own box, so only the <svg> element itself counts.
    if (el.tagName.toLowerCase() !== "svg" && el.closest("svg")) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    visible++;
    minX = Math.min(minX, r.left);
    minY = Math.min(minY, r.top);
    maxX = Math.max(maxX, r.right);
    maxY = Math.max(maxY, r.bottom);
  });
  const px = (n: number) => Math.round(n / scale);
  if (visible) {
    const over = {
      top: px(area.top - minY),
      bottom: px(maxY - area.bottom),
      left: px(area.left - minX),
      right: px(maxX - area.right),
    };
    const parts = Object.entries(over)
      .filter(([, v]) => v > 4)
      .map(([k, v]) => `${v}px past the ${k} edge`);
    if (parts.length) {
      issues.push(
        `Content overflows the slide (${parts.join(", ")}). Shorten the text, split the slide, shrink fonts or use r-fit-text.`
      );
    }
  }
  slide.querySelectorAll("pre").forEach((pre) => {
    if (pre.scrollHeight > pre.clientHeight + 4) issues.push("A code block is cut off vertically (too many lines).");
    if (pre.scrollWidth > pre.clientWidth + 4) issues.push("A code block has lines too long to fit; they scroll sideways.");
  });
  slide.querySelectorAll("img").forEach((img) => {
    if (img.complete && img.naturalWidth === 0) issues.push(`Image failed to load: ${img.getAttribute("src")?.slice(0, 120)}`);
  });
  const text = (slide.innerText || "").replace(/\s+/g, " ").trim();
  const bg = document.querySelector(".backgrounds .slide-background.present") as HTMLElement | null;
  const hasBg = !!bg && (bg.hasAttribute("data-background-hash") || getComputedStyle(bg).backgroundImage !== "none");
  if (!text && !slide.querySelector("img,video,iframe,svg,canvas") && !hasBg && visible === 0) {
    issues.push("Slide looks empty.");
  }
  const heading = slide.querySelector("h1,h2,h3");
  return { title: (heading?.textContent || text).trim().slice(0, 60), issues };
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    const slide: HTMLElement = Reveal.getCurrentSlide();
    await Promise.all(
      Array.from(slide.querySelectorAll("img")).map((img) =>
        img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; setTimeout(r, 3000); })
      )
    );
    const t0 = Date.now();
    while (document.querySelector('pre.mermaid:not([data-processed="true"]):not([data-processed="error"])') && Date.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await new Promise((r) => setTimeout(r, 120));
}

export async function screenshotSlides(
  htmlFile: string,
  opts: ShotOptions
): Promise<{ shots: SlideShot[]; sheet?: Buffer }> {
  const imageWidth = opts.imageWidth ?? 960;
  const imageHeight = Math.round((imageWidth * opts.deckHeight) / opts.deckWidth);
  return withDeckPage(htmlFile, { width: imageWidth, height: imageHeight, staticMode: true }, async (page) => {
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.evaluate(() =>
      Reveal.configure({
        transition: "none",
        backgroundTransition: "none",
        autoAnimate: false,
        autoSlide: 0,
        controls: false,
        progress: false,
        slideNumber: false,
        viewDistance: 100,
      })
    );
    const positions: [number, number][] = await page.evaluate(() => {
      const out: [number, number][] = [];
      Reveal.getHorizontalSlides().forEach((s: HTMLElement, h: number) => {
        const vs = s.querySelectorAll(":scope > section");
        if (vs.length) vs.forEach((_v, v) => out.push([h, v]));
        else out.push([h, 0]);
      });
      return out;
    });
    const label = (h: number, v: number) => (v ? `${h}.${v}` : `${h}`);
    const wanted = opts.only?.length ? new Set(opts.only.map((s) => s.replace(/\.0$/, ""))) : null;
    const shots: SlideShot[] = [];
    for (const [h, v] of positions) {
      if (wanted && !wanted.has(label(h, v))) continue;
      await page.evaluate(
        (h, v) => {
          Reveal.slide(h, v);
          while (Reveal.nextFragment()) {
            /* show every fragment */
          }
        },
        h,
        v
      );
      await settle(page);
      const info = await page.evaluate(inspectCurrentSlide);
      const jpeg =
        opts.images === false
          ? Buffer.alloc(0)
          : Buffer.from(await page.screenshot({ type: "jpeg", quality: opts.quality ?? 75 }));
      shots.push({ slide: label(h, v), index: h, verticalIndex: v, title: info.title, issues: info.issues, jpeg });
    }
    if (wanted && !shots.length) throw new Error(`None of the requested slides exist: ${opts.only!.join(", ")}`);
    return { shots, sheet: opts.sheet && opts.images !== false ? await contactSheet(page, shots) : undefined };
  });
}

/** Lays screenshots out on one contact sheet so a whole deck fits in a single image. */
async function contactSheet(deckPage: Page, shots: SlideShot[], cellWidth = 400): Promise<Buffer> {
  const cols = shots.length <= 4 ? 2 : shots.length <= 9 ? 3 : 4;
  const cells = shots
    .map(
      (s) => `<figure><img src="data:image/jpeg;base64,${s.jpeg.toString("base64")}"><figcaption>${escapeHtml(
        s.slide
      )}${s.issues.length ? ' <b>⚠ ' + s.issues.length + "</b>" : ""} · ${escapeHtml(s.title)}</figcaption></figure>`
    )
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#202124;font:14px system-ui,sans-serif;color:#eee">
<div style="display:grid;grid-template-columns:repeat(${cols},${cellWidth}px);gap:12px;padding:12px">${cells}</div>
<style>figure{margin:0}img{width:100%;display:block;border-radius:4px}figcaption{padding:4px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}b{color:#ffb74d}</style>
</body></html>`;
  const width = cols * cellWidth + (cols + 1) * 12;
  const page = await deckPage.browser().newPage();
  await page.setViewport({ width, height: 400 });
  await page.setContent(html, { waitUntil: "load" });
  return Buffer.from(await page.screenshot({ type: "jpeg", quality: 70, fullPage: true }));
}
