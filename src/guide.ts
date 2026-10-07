import { FRAGMENT_EFFECTS, MOTION_CLASSES, THEMES, TRANSITIONS } from "./schema.js";
import { PRESETS, PRESET_DEFS } from "./presets.js";

export const GUIDE = `# motiondeck guide

## Workflow (cheap and high quality)
1. Pick a preset. Plan 8-14 slides: one idea each.
2. ONE create_presentation call with every slide. Prefer components over hand-written HTML: they look designed, animate automatically and cost few tokens.
3. The result lists layoutIssues for each slide. Fix them with update_slide (slide "3" or "3.1").
4. Optional: screenshot_slides (images:"sheet") to judge the design visually.
5. export_presentation: html | pdf | mp4 | webm | gif.

## Presets (settings are optional on top)
${PRESETS.map((p) => `- ${p}: ${PRESET_DEFS[p].describe}`).join("\n")}
Without a preset use settings.theme: ${THEMES.join(", ")}.

## Slide fields (all optional)
- title, subtitle: markdown inline
- content: Markdown; inline HTML allowed (format:"html" for pure HTML). Safe mode keeps tags, class, style, data-id; strips scripts, event handlers, iframes and url() in styles
- layout: title (hero) | section (divider; presets add a background) | center | columns (+columns: [md, md]) | image-left / image-right (+image) | fullscreen
- component: see below
- code: {code, language, lineNumbers: true | "|1-3|5"}; markdown fences \`\`\`js [1|2-3] also step through lines
- listFragments: true | "<effect>" reveals bullets one by one; fragments: [{content, effect, index}]
- notes: speaker notes (press S)
- background: {color | gradient | image | video, opacity, size}; iframe is trusted-mode only
- transition (${TRANSITIONS.join("|")}), transitionIn, transitionOut, transitionSpeed (default|fast|slow)
- autoAnimate: true on consecutive slides morphs matching elements (same text or same data-id); autoAnimateId groups runs
- duration: ms this slide stays on screen in video export
- className, style, attributes, id, visibility (hidden|uncounted), autoSlide
- verticalSlides: [slide, ...] stacked below this slide

## Components (component: {type, ...})
- stats: items [{value: 42 | "98%" | "$1.2M", label, prefix?, suffix?}] (1-6). Numbers count up.
- timeline: items [{date, title, text?}] (1-8), stepByStep?
- cards: items [{icon?: emoji, title, text?}] (1-8), columns? (1-4), stepByStep?
- quote: text, author?, role?
- comparison: left {title, items[]}, right {title, items[]} (right is highlighted), stepByStep?
- steps: items [{title, text?}] (1-6), stepByStep?
- chart: kind bar|hbar|line|donut, labels[], series [{name?, values[]}] (donut uses series[0]), unit?, max?. Bars grow, lines draw, donuts sweep.
- diagram: code = Mermaid source (flowchart, sequence, gantt, mindmap...)
stepByStep:true turns items into fragments revealed on each click/video step. Without it items animate in automatically.
A slide can combine title + short content + one component. Keep component text short.

## Motion
- settings.motion: none | subtle | lively adds entrance motion to every slide (presets default to subtle or lively).
- Fragment effects: ${FRAGMENT_EFFECTS.join(", ")}. Prefer the fragments/listFragments fields; inline <span class="fragment"> also works.
- Motion classes on any element: ${MOTION_CLASSES.join(", ")}. Tune with style="--delay:.3s;--duration:1s". anim-typewriter takes --steps (character count).
- reveal helpers: r-fit-text (huge text), r-stretch (fill height), r-stack (overlap + fragments), r-hstack, r-vstack.
- Auto-animate code: two slides with autoAnimate and code.dataId equal morph line by line.

## Settings (settings object; update_settings merges, null removes)
preset, theme, motion, brand {primary, logo, logoPosition, font, headingFont}, transition, transitionSpeed, backgroundTransition, controls, progress, slideNumber (true | "c/t"), center, loop, autoSlide, width/height (default 1280x720; 1080x1080 or 1080x1920 for square/vertical video), navigationMode, view ("scroll"), customCss, highlightTheme (monokai|zenburn), author, description. customJs/headHtml are trusted-mode only.


## Security modes
- safe (default): HTML is sanitized; customJs, headHtml, background iframes and url()/@import in CSS are rejected. Images/videos: any https URL, or an absolute local path to a real image/video file. Exports stay inside ~/motiondeck/presentations (outputPath is relative to it).
- strict: like safe, plus remote assets only from MOTIONDECK_REMOTE_HOSTS, local files only under MOTIONDECK_ASSET_ROOTS, and no font/Mermaid/KaTeX CDN.
- trusted: everything allowed (raw HTML, customJs, iframes). Only for content you trust.

## Quality rules
- Max ~6 bullets or ~40 words per slide; otherwise split. layoutIssues flags overflow.
- Start with layout:"title", separate parts with layout:"section", end with a closing slide.
- Alternate text slides with components so the deck has rhythm.
- Put detail in notes, not on the slide.
`;
