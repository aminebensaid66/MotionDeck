/**
 * Design presets: a complete look (base theme, fonts, colors, background, alignment, default
 * transition and motion) chosen by name, so the model never has to write styling to get a good deck.
 */
export const PRESETS = ["aurora", "corporate", "minimal", "bold", "sunset", "glass"] as const;
export type PresetName = (typeof PRESETS)[number];

export interface Preset {
  theme: "black" | "white";
  dark: boolean;
  fonts: string[];
  transition: "slide" | "fade" | "convex" | "zoom";
  motion: "subtle" | "lively";
  palette: [string, string, string, string, string, string];
  /** Background used for layout:"section" slides that don't set one. */
  sectionBg: string;
  css: string;
  describe: string;
}

const left = `
.reveal .slides { text-align: left; }
.reveal .slides section.layout-title, .reveal .slides section.layout-section, .reveal .slides section.layout-center { text-align: center; }`;

const vars = (o: Record<string, string>) =>
  `.reveal-viewport, .reveal { ${Object.entries(o)
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ")} }`;

export const PRESET_DEFS: Record<PresetName, Preset> = {
  aurora: {
    sectionBg: "linear-gradient(135deg, #4c1d95, #0e7490)",
    describe: "dark tech, violet/cyan glow, Space Grotesk",
    theme: "black",
    dark: true,
    fonts: ["Space Grotesk:wght@500;700", "Inter:wght@400;600"],
    transition: "slide",
    motion: "subtle",
    palette: ["#a78bfa", "#22d3ee", "#f472b6", "#facc15", "#34d399", "#fb923c"],
    css: `${vars({
      "--r-background-color": "#0b1020",
      "--r-main-font": "Inter, system-ui, sans-serif",
      "--r-main-color": "#e2e8f0",
      "--r-heading-font": "'Space Grotesk', Inter, sans-serif",
      "--r-heading-color": "#ffffff",
      "--r-heading-text-transform": "none",
      "--r-heading-letter-spacing": "-0.02em",
      "--r-link-color": "#a78bfa",
      "--r-link-color-hover": "#c4b5fd",
      "--r-main-font-size": "34px",
    })}
.reveal-viewport { background: radial-gradient(1200px 600px at 10% -10%, rgba(139,92,246,.35), transparent 60%), radial-gradient(900px 500px at 110% 110%, rgba(34,211,238,.25), transparent 60%), #0b1020; }
.reveal h1, .reveal h2 { font-weight: 700; }
.reveal h2 { font-size: 1.9em; }
.reveal .layout-title h1 { background: linear-gradient(90deg, #fff, #c4b5fd 60%, #67e8f9); -webkit-background-clip: text; background-clip: text; color: transparent; }
${left}`,
  },
  corporate: {
    sectionBg: "linear-gradient(135deg, #1e3a8a, #2563eb)",
    describe: "clean light business, navy and blue, Inter",
    theme: "white",
    dark: false,
    fonts: ["Inter:wght@400;600;800"],
    transition: "slide",
    motion: "subtle",
    palette: ["#2563eb", "#0ea5e9", "#14b8a6", "#f59e0b", "#6366f1", "#ef4444"],
    css: `${vars({
      "--r-background-color": "#ffffff",
      "--r-main-font": "Inter, system-ui, sans-serif",
      "--r-main-color": "#334155",
      "--r-heading-font": "Inter, system-ui, sans-serif",
      "--r-heading-color": "#0f172a",
      "--r-heading-text-transform": "none",
      "--r-heading-letter-spacing": "-0.02em",
      "--r-heading-font-weight": "800",
      "--r-link-color": "#2563eb",
      "--r-main-font-size": "32px",
    })}
.reveal-viewport { background: #fff; }
.reveal .slides section:not(.layout-title):not(.layout-section) > h2 { border-left: 8px solid #2563eb; padding-left: .45em; }
.reveal .slides section.layout-section h2, .reveal .slides section.layout-section { color: #fff; }
${left}`,
  },
  minimal: {
    sectionBg: "#111111",
    describe: "editorial off-white, Fraunces serif headings, lots of space",
    theme: "white",
    dark: false,
    fonts: ["Fraunces:opsz,wght@9..144,500;9..144,700", "Inter:wght@400;600"],
    transition: "fade",
    motion: "subtle",
    palette: ["#111111", "#e11d48", "#737373", "#a3a3a3", "#d4d4d4", "#525252"],
    css: `${vars({
      "--r-background-color": "#faf9f6",
      "--r-main-font": "Inter, system-ui, sans-serif",
      "--r-main-color": "#262626",
      "--r-heading-font": "Fraunces, Georgia, serif",
      "--r-heading-color": "#111111",
      "--r-heading-text-transform": "none",
      "--r-heading-letter-spacing": "-0.01em",
      "--r-heading-font-weight": "600",
      "--r-link-color": "#e11d48",
      "--r-main-font-size": "32px",
    })}
.reveal-viewport { background: #faf9f6; }
.reveal { --rmcp-accent: #e11d48; }
.reveal .rmcp-stat-value { color: #111; }
.reveal .slides section.layout-section, .reveal .slides section.layout-section h2 { color: #faf9f6; }
${left}`,
  },
  bold: {
    sectionBg: "#facc15",
    describe: "high-contrast black and yellow, huge Archivo Black type, energetic",
    theme: "black",
    dark: true,
    fonts: ["Archivo Black", "Inter:wght@400;700"],
    transition: "convex",
    motion: "lively",
    palette: ["#facc15", "#ffffff", "#f97316", "#22d3ee", "#a3e635", "#f43f5e"],
    css: `${vars({
      "--r-background-color": "#0a0a0a",
      "--r-main-font": "Inter, system-ui, sans-serif",
      "--r-main-color": "#f5f5f5",
      "--r-heading-font": "'Archivo Black', Impact, sans-serif",
      "--r-heading-color": "#ffffff",
      "--r-heading-text-transform": "uppercase",
      "--r-heading-letter-spacing": "-0.01em",
      "--r-heading-font-weight": "400",
      "--r-link-color": "#facc15",
      "--r-main-font-size": "34px",
    })}
.reveal-viewport { background: #0a0a0a; }
.reveal h2 { font-size: 2.1em; }
.reveal .layout-title h1 { font-size: 3.4em; line-height: .95; }
.reveal h1 em, .reveal h2 em, .reveal strong { color: #facc15; font-style: normal; }
.reveal .rmcp-step-num { color: #0a0a0a; }
.reveal .slides section.layout-section, .reveal .slides section.layout-section h2 { color: #0a0a0a; }`,
  },
  sunset: {
    sectionBg: "linear-gradient(135deg, #be123c, #f59e0b)",
    describe: "warm dark with coral/amber glow, Poppins, friendly",
    theme: "black",
    dark: true,
    fonts: ["Poppins:wght@400;600;800"],
    transition: "fade",
    motion: "lively",
    palette: ["#fb7185", "#fbbf24", "#f97316", "#c084fc", "#2dd4bf", "#f472b6"],
    css: `${vars({
      "--r-background-color": "#1a1016",
      "--r-main-font": "Poppins, system-ui, sans-serif",
      "--r-main-color": "#fde7e3",
      "--r-heading-font": "Poppins, system-ui, sans-serif",
      "--r-heading-color": "#ffffff",
      "--r-heading-text-transform": "none",
      "--r-heading-letter-spacing": "-0.02em",
      "--r-heading-font-weight": "800",
      "--r-link-color": "#fb7185",
      "--r-main-font-size": "32px",
    })}
.reveal-viewport { background: radial-gradient(1000px 600px at 100% 0%, rgba(251,113,133,.35), transparent 60%), radial-gradient(900px 600px at 0% 100%, rgba(251,191,36,.22), transparent 60%), #1a1016; }
.reveal .layout-title h1 { background: linear-gradient(90deg, #fbbf24, #fb7185, #c084fc); -webkit-background-clip: text; background-clip: text; color: transparent; }`,
  },
  glass: {
    sectionBg: "linear-gradient(135deg, #7c3aed, #db2777)",
    describe: "vivid blue-purple gradient with frosted glass cards, Manrope",
    theme: "black",
    dark: true,
    fonts: ["Manrope:wght@400;600;800"],
    transition: "slide",
    motion: "subtle",
    palette: ["#ffffff", "#fde68a", "#a5f3fc", "#fbcfe8", "#bbf7d0", "#c7d2fe"],
    css: `${vars({
      "--r-background-color": "#4338ca",
      "--r-main-font": "Manrope, system-ui, sans-serif",
      "--r-main-color": "rgba(255,255,255,.92)",
      "--r-heading-font": "Manrope, system-ui, sans-serif",
      "--r-heading-color": "#ffffff",
      "--r-heading-text-transform": "none",
      "--r-heading-letter-spacing": "-0.02em",
      "--r-heading-font-weight": "800",
      "--r-link-color": "#fde68a",
      "--r-main-font-size": "32px",
    })}
.reveal-viewport { background: radial-gradient(800px 600px at 15% 20%, #ec4899 0%, transparent 60%), radial-gradient(900px 700px at 85% 80%, #06b6d4 0%, transparent 55%), linear-gradient(135deg, #4338ca, #7c3aed); }
.reveal { --rmcp-surface: rgba(255,255,255,.14); --rmcp-border: rgba(255,255,255,.3); --rmcp-muted: rgba(255,255,255,.75); }
.reveal pre { border-radius: 14px; overflow: hidden; }
.reveal .rmcp-step-num { color: #4338ca; }`,
  },
};

export function presetCss(p: Preset): string {
  const pal = p.palette.map((c, i) => `--rmcp-c${i + 1}: ${c};`).join(" ");
  return `${p.css}\n.reveal { --rmcp-accent: var(--r-link-color); ${pal} }\n`;
}

export function googleFontsLink(fonts: string[]): string {
  if (!fonts.length) return "";
  const q = fonts.map((f) => `family=${f.replace(/ /g, "+")}`).join("&");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${q}&display=swap">`;
}

/** Automatic entrance motion for every slide, so decks feel alive without per-element classes. */
export const AUTO_MOTION_CSS = `
.reveal.rmcp-motion-subtle .slides section.present:not(.stack):not([data-auto-animate]) > :is(h1, h2, h3):not(.fragment) { animation: rmcp-fade-up .7s cubic-bezier(.2,.8,.2,1) both; }
.reveal.rmcp-motion-subtle .slides section.present:not(.stack):not([data-auto-animate]) > :is(p, ul, ol, pre, blockquote, table, img, .subtitle, .rmcp-columns, .rmcp-split):not(.fragment) { animation: rmcp-fade-up .7s cubic-bezier(.2,.8,.2,1) .15s both; }
.reveal.rmcp-motion-lively .slides section.present:not(.stack):not([data-auto-animate]) > :is(h1, h2, h3):not(.fragment) { animation: rmcp-blur-in .8s cubic-bezier(.2,.8,.2,1) both; }
.reveal.rmcp-motion-lively .slides section.present:not(.stack):not([data-auto-animate]) > :is(p, pre, blockquote, table, img, .subtitle, .rmcp-columns, .rmcp-split):not(.fragment) { animation: rmcp-fade-up .7s cubic-bezier(.2,.8,.2,1) .2s both; }
.reveal.rmcp-motion-lively .slides section.present:not(.stack):not([data-auto-animate]) > :is(ul, ol) > li:not(.fragment) { animation: rmcp-fade-left .6s cubic-bezier(.2,.8,.2,1) both; }
${Array.from({ length: 10 }, (_, i) => `.reveal.rmcp-motion-lively .slides section.present:not(.stack):not([data-auto-animate]) > :is(ul, ol) > li:nth-child(${i + 1}) { animation-delay: ${(0.25 + i * 0.1).toFixed(2)}s; }`).join("\n")}
html.print-pdf .reveal .slides section * { animation: none !important; }
`;
