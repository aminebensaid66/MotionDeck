import { z } from "zod";
import { ComponentSchema } from "./components.js";
import { PRESETS } from "./presets.js";

export const THEMES = [
  "black",
  "white",
  "league",
  "beige",
  "sky",
  "night",
  "serif",
  "simple",
  "solarized",
  "blood",
  "moon",
  "dracula",
  "black-contrast",
  "white-contrast",
] as const;

export const TRANSITIONS = ["none", "fade", "slide", "convex", "concave", "zoom"] as const;
export const SPEEDS = ["default", "fast", "slow"] as const;

export const FRAGMENT_EFFECTS = [
  "fade-in",
  "fade-out",
  "fade-up",
  "fade-down",
  "fade-left",
  "fade-right",
  "fade-in-then-out",
  "fade-in-then-semi-out",
  "current-visible",
  "semi-fade-out",
  "grow",
  "shrink",
  "strike",
  "highlight-red",
  "highlight-green",
  "highlight-blue",
  "highlight-current-red",
  "highlight-current-green",
  "highlight-current-blue",
] as const;

export const MOTION_CLASSES = [
  "anim-fade-up",
  "anim-fade-down",
  "anim-fade-left",
  "anim-fade-right",
  "anim-zoom-in",
  "anim-zoom-out",
  "anim-flip-in",
  "anim-blur-in",
  "anim-bounce-in",
  "anim-float",
  "anim-pulse",
  "anim-spin",
  "anim-shake",
  "anim-gradient-text",
  "anim-typewriter",
  "anim-stagger",
] as const;

const transition = z
  .enum(TRANSITIONS)
  .describe("Slide transition. Can also be split as 'in-out' via transitionIn/transitionOut on a slide.");

export const BackgroundSchema = z
  .object({
    color: z.string().describe("Any CSS color, e.g. '#1e1e2e' or 'rgb(0,0,0)'"),
    gradient: z.string().describe("CSS gradient, e.g. 'linear-gradient(135deg, #667eea, #764ba2)'"),
    image: z.string().describe("Image URL or absolute local path"),
    size: z.string().describe("CSS background-size, e.g. 'cover', 'contain', '100px'"),
    position: z.string(),
    repeat: z.string(),
    opacity: z.number().min(0).max(1),
    video: z.string().describe("Video URL (mp4/webm) played as a background"),
    videoLoop: z.boolean(),
    videoMuted: z.boolean(),
    iframe: z.string().describe("URL embedded as a full-slide background"),
    interactive: z.boolean().describe("Allow interacting with the background iframe"),
    transition: transition.describe("Background transition for this slide"),
  })
  .partial();

export const FragmentSchema = z.object({
  content: z.string().describe("Markdown or HTML (inline) content of the fragment"),
  effect: z.enum(FRAGMENT_EFFECTS).optional().describe("Fragment animation, default 'fade-in'"),
  index: z.number().int().optional().describe("Explicit reveal order (data-fragment-index)"),
  tag: z.string().optional().describe("Wrapper element, default 'p'"),
});

export const CodeSchema = z.object({
  code: z.string(),
  language: z.string().optional().describe("highlight.js language, e.g. 'ts', 'python'"),
  lineNumbers: z
    .union([z.boolean(), z.string()])
    .optional()
    .describe("true for line numbers, or a step-through string like '|1-3|5|7-9' to highlight lines step by step"),
  dataId: z.string().optional().describe("data-id for auto-animate code morphing between slides"),
});

const slideShape = {
  id: z.string().optional().describe("HTML id; allows linking with #/id"),
  title: z.string().optional().describe("Slide heading (rendered as h2, or h1 for layout 'title')"),
  subtitle: z.string().optional(),
  content: z
    .string()
    .optional()
    .describe("Main body. Markdown by default (format='html' for raw HTML). HTML can be mixed into markdown."),
  format: z.enum(["markdown", "html"]).optional(),
  layout: z
    .enum(["default", "title", "section", "center", "columns", "image-left", "image-right", "fullscreen"])
    .optional()
    .describe(
      "title: big hero slide. section: section divider. columns: content of each 'columns' entry side by side. image-left/right: 'image' beside 'content'. fullscreen: content without padding (use with background)."
    ),
  columns: z.array(z.string()).optional().describe("For layout 'columns': markdown for each column"),
  image: z.string().optional().describe("Image URL/path for image-left/image-right layouts"),
  code: CodeSchema.optional().describe("Code block appended after content"),
  component: ComponentSchema.optional().describe("Data-driven designed block: stats, timeline, cards, quote, comparison, steps, chart, diagram"),
  fragments: z.array(FragmentSchema).optional().describe("Items revealed one by one, appended after content"),
  listFragments: z
    .union([z.boolean(), z.enum(FRAGMENT_EFFECTS)])
    .optional()
    .describe("Turn every list item in the content into a fragment (true = fade-in, or an effect name)"),
  notes: z.string().optional().describe("Speaker notes (markdown); press S in the deck to open"),
  background: BackgroundSchema.optional(),
  transition: transition.optional(),
  transitionIn: z.enum(TRANSITIONS).optional(),
  transitionOut: z.enum(TRANSITIONS).optional(),
  transitionSpeed: z.enum(SPEEDS).optional(),
  autoAnimate: z
    .boolean()
    .optional()
    .describe(
      "Enable auto-animate: elements matched between this and the adjacent auto-animate slide (same text, or same data-id) morph smoothly"
    ),
  autoAnimateId: z.string().optional().describe("Only auto-animate between slides sharing this id"),
  autoAnimateRestart: z.boolean().optional(),
  autoAnimateEasing: z.string().optional(),
  autoAnimateDuration: z.number().optional().describe("Seconds"),
  autoAnimateUnmatched: z.boolean().optional(),
  autoSlide: z.number().int().optional().describe("Advance after N ms on this slide"),
  duration: z
    .number()
    .int()
    .min(200)
    .optional()
    .describe("Video export: how long (ms) this slide stays on screen before the next step"),
  visibility: z.enum(["hidden", "uncounted"]).optional(),
  className: z.string().optional().describe("Extra classes on the <section>"),
  style: z.string().optional().describe("Inline CSS for the <section>"),
  attributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Any extra attributes for the <section>, e.g. {'data-state': 'intro'}"),
};

export const BaseSlideSchema = z.strictObject(slideShape);
export const SlideSchema = z.strictObject({
  ...slideShape,
  verticalSlides: z
    .array(BaseSlideSchema)
    .optional()
    .describe("Slides stacked vertically under this one (navigate with the down arrow)"),
});

export type BaseSlide = z.infer<typeof BaseSlideSchema>;
export type Slide = z.infer<typeof SlideSchema>;

export const BrandSchema = z.strictObject({
  primary: z.string().optional().describe("Accent color"),
  logo: z.string().optional().describe("Logo URL or absolute path, shown in a corner of every slide"),
  logoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
  font: z.string().optional().describe("Google Font for body text"),
  headingFont: z.string().optional().describe("Google Font for headings"),
});

export const SettingsShape = {
  preset: z.enum(PRESETS).optional().describe("Designed look; overrides theme"),
  motion: z.enum(["none", "subtle", "lively"]).optional().describe("Automatic entrance motion on every slide"),
  brand: BrandSchema.optional(),
  theme: z.enum(THEMES).optional().describe("Built-in reveal.js theme (default 'black')"),
  transition: z.enum(TRANSITIONS).optional().describe("Default slide transition (default 'slide')"),
  transitionSpeed: z.enum(SPEEDS).optional(),
  backgroundTransition: z.enum(TRANSITIONS).optional(),
  highlightTheme: z.enum(["monokai", "zenburn"]).optional(),
  controls: z.boolean().optional(),
  progress: z.boolean().optional(),
  slideNumber: z.union([z.boolean(), z.string()]).optional().describe("true, or a format like 'c/t'"),
  center: z.boolean().optional(),
  loop: z.boolean().optional(),
  autoSlide: z.number().int().optional().describe("Auto-advance every N ms (0 = off)"),
  autoSlideStoppable: z.boolean().optional(),
  autoAnimateDuration: z.number().optional(),
  autoAnimateEasing: z.string().optional(),
  width: z.number().int().optional().describe("Logical slide width, default 1280"),
  height: z.number().int().optional().describe("Logical slide height, default 720"),
  navigationMode: z.enum(["default", "linear", "grid"]).optional(),
  view: z.enum(["default", "scroll"]).optional().describe("'scroll' turns the deck into a scrollable page"),
  parallaxBackgroundImage: z.string().optional(),
  parallaxBackgroundSize: z.string().optional(),
  pdfSeparateFragments: z.boolean().optional(),
  customCss: z.string().optional().describe("Extra CSS injected into the deck (colors, fonts, custom animations)"),
  customJs: z.string().optional().describe("Extra JS run after Reveal initializes (the Reveal global is available)"),
  headHtml: z.string().optional().describe("Extra HTML for <head>, e.g. font links or external scripts like GSAP"),
  author: z.string().optional(),
  description: z.string().optional(),
};

export const SettingsSchema = z.strictObject(SettingsShape);
export type Settings = z.infer<typeof SettingsSchema>;

export interface Deck {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  slides: Slide[];
}
