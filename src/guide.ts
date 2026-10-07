import { FRAGMENT_EFFECTS, MOTION_CLASSES, THEMES, TRANSITIONS } from "./schema.js";

export const GUIDE = `# reveal.js authoring guide (reveal-mcp)

## Workflow
1. create_presentation with a title, settings and the full list of slides. The HTML file is written immediately and its path is returned.
2. Refine with add_slides / update_slide / remove_slide / move_slide / update_presentation_settings. Every change re-renders the HTML.
3. screenshot_slides shows you the slides as images and flags layout problems (overflow, cut-off code, broken images). Fix what it reports and check again before handing the deck over.
4. preview_presentation gives a local URL; export_presentation writes standalone HTML (offline, all assets inlined) or PDF; export_video records the deck playing, with all motion, to MP4, WebM or GIF.

## Video
- Each slide stays on screen for slideDuration (default 3000 ms) and each fragment for fragmentDuration (default 1500 ms). Override per slide with the slide's duration field (ms).
- Motion reads best on video: auto-animate sequences, listFragments, anim-* entrance classes, background videos.
- For social formats pick resolution "square" or "vertical" and set the deck's width/height to the same shape (1080x1080 or 1080x1920).

## Slides
- content is Markdown by default; HTML is allowed inside Markdown. Use format:"html" for pure HTML.
- title / subtitle render as headings. layout: ${["default", "title", "section", "center", "columns", "image-left", "image-right", "fullscreen"].join(", ")}.
- columns: ["md col 1", "md col 2"] with layout "columns".
- verticalSlides: nested slides under a slide (down arrow).
- notes: speaker notes (press S in the deck).
- background: { color | gradient | image | video | iframe, opacity, size }.
- Code: fenced blocks in Markdown (\`\`\`js [1-2|4|6-8] steps through highlighted lines) or the code field { code, language, lineNumbers: "|1-3|5" }.
- Math: $$ e^{i\\pi}+1=0 $$ or \\( x^2 \\) uses KaTeX (loaded from CDN when viewed).

## Motion
### Transitions
Deck-wide settings.transition or per slide transition: ${TRANSITIONS.join(", ")}. Combine with transitionIn/transitionOut and transitionSpeed (default, fast, slow).

### Fragments (step-by-step reveals)
- fragments: [{ content, effect, index }] appended to the slide, or listFragments: true | "<effect>" to reveal every bullet one by one.
- Inline HTML: <span class="fragment highlight-red">text</span>. Nest fragments to chain effects (fade-in then highlight).
- Effects: ${FRAGMENT_EFFECTS.join(", ")}.

### Auto-animate (Keynote "Magic Move")
Set autoAnimate: true on two or more consecutive slides. Elements match automatically when they have the same text (headings, paragraphs, code), or explicitly with the same data-id:
  slide 1 content: <div data-id="box" style="width:100px;height:100px;background:#e74c3c"></div>
  slide 2 content: <div data-id="box" style="width:400px;height:200px;background:#3498db;border-radius:24px"></div>
Position, size, color, border-radius, font-size and opacity are tweened. Use autoAnimateId to group runs, autoAnimateRestart to break a run, autoAnimateDuration / autoAnimateEasing to tune, and data-auto-animate-delay on an element to stagger.
Code blocks with the same dataId morph line by line, which is great for live-coding style reveals. Lists animate when items keep the same text.

### Motion classes (built in, play when a slide becomes current)
${MOTION_CLASSES.join(", ")}.
Use on any element: <h1 class="anim-fade-up">Hi</h1>. Tune with CSS variables: style="--delay:.4s; --duration:1.2s". anim-stagger animates its children one after another (great on <ul>). anim-typewriter takes --steps (character count). anim-gradient-text takes --c1, --c2, --c3.

### Layout helpers from reveal.js
- r-stack: overlap elements in one place; combine with fragments to swap images.
- r-fit-text: <h2 class="r-fit-text">BIG</h2> fills the slide width.
- r-stretch: an element (image/video) fills the remaining vertical space.
- r-hstack / r-vstack: flex rows / columns.

### Going further
- settings.customCss: your own @keyframes, fonts, colors (CSS variables like --r-main-color, --r-heading-color, --r-background-color, --r-main-font, --r-heading-font).
- settings.headHtml + settings.customJs: e.g. load GSAP from a CDN and animate on Reveal.on('slidechanged', ...).
- autoSlide (ms) for kiosk/looping decks; view: "scroll" for a scrollable article-like deck.
- data-background-video + autoAnimate makes cinematic intros.

## Themes
${THEMES.join(", ")}.

## Tips for great decks
- One idea per slide; 3-5 bullets max; use listFragments for pacing.
- Use a title slide (layout:"title") and section dividers (layout:"section" with a gradient background).
- Pair transition "fade" or "convex" with autoAnimate sequences for a polished feel.
- Keep text short; let images, code and motion carry the story.
`;
