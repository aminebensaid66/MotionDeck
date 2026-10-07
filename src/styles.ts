/** Layout helpers used by the slide `layout` option. */
export const LAYOUT_CSS = `
.reveal .subtitle { opacity: .75; font-size: .9em; margin-top: -.2em; }
.reveal .layout-title h1 { font-size: 2.6em; margin-bottom: .2em; }
.reveal .layout-title .subtitle { font-size: 1.1em; }
.reveal .layout-section h2 { font-size: 2.4em; }
.reveal .layout-center { text-align: center; }
.reveal .layout-fullscreen { padding: 0 !important; }
.reveal .rmcp-columns { display: flex; gap: 1.2em; text-align: left; align-items: flex-start; }
.reveal .rmcp-col { flex: 1 1 0; min-width: 0; }
.reveal .rmcp-col > :first-child { margin-top: 0; }
.reveal .rmcp-split { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2em; align-items: center; text-align: left; }
.reveal .rmcp-media img { max-width: 100%; max-height: 520px; margin: 0; object-fit: cover; border-radius: 8px; }
.reveal .rmcp-text > :first-child { margin-top: 0; }
`;

/**
 * Motion classes. Entrance animations play each time their slide becomes the current slide.
 * Tune with CSS variables in a style attribute: --delay, --duration, --ease.
 * The vertical-stack parent (.stack) is excluded so nested slides only animate when they are shown.
 */
const P = ".reveal .slides section.present:not(.stack)";
const enter = (name: string) =>
  `${P} .anim-${name}, ${P}.anim-${name} { animation: rmcp-${name} var(--duration, .8s) var(--ease, cubic-bezier(.2,.8,.2,1)) var(--delay, 0s) both; }`;

export const MOTION_CSS = `
@keyframes rmcp-fade-up { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
@keyframes rmcp-fade-down { from { opacity: 0; transform: translateY(-40px); } to { opacity: 1; transform: none; } }
@keyframes rmcp-fade-left { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: none; } }
@keyframes rmcp-fade-right { from { opacity: 0; transform: translateX(-60px); } to { opacity: 1; transform: none; } }
@keyframes rmcp-zoom-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@keyframes rmcp-zoom-out { from { opacity: 0; transform: scale(1.4); } to { opacity: 1; transform: none; } }
@keyframes rmcp-flip-in { from { opacity: 0; transform: perspective(800px) rotateX(-80deg); } to { opacity: 1; transform: none; } }
@keyframes rmcp-blur-in { from { opacity: 0; filter: blur(16px); } to { opacity: 1; filter: none; } }
@keyframes rmcp-bounce-in { 0% { opacity: 0; transform: scale(.3); } 50% { opacity: 1; transform: scale(1.08); } 70% { transform: scale(.95); } 100% { transform: none; } }
@keyframes rmcp-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
@keyframes rmcp-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
@keyframes rmcp-spin { to { transform: rotate(360deg); } }
@keyframes rmcp-shake { 0%, 100% { transform: none; } 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
@keyframes rmcp-gradient { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
@keyframes rmcp-typewriter { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes rmcp-caret { 50% { border-color: transparent; } }
${["fade-up", "fade-down", "fade-left", "fade-right", "zoom-in", "zoom-out", "flip-in", "blur-in", "bounce-in", "shake"]
  .map(enter)
  .join("\n")}
${P} .anim-float { animation: rmcp-float var(--duration, 3s) ease-in-out var(--delay, 0s) infinite; }
${P} .anim-pulse { animation: rmcp-pulse var(--duration, 1.6s) ease-in-out var(--delay, 0s) infinite; }
${P} .anim-spin { display: inline-block; animation: rmcp-spin var(--duration, 4s) linear var(--delay, 0s) infinite; }
.reveal .anim-gradient-text {
  background: linear-gradient(90deg, var(--c1, #ff6b6b), var(--c2, #feca57), var(--c3, #48dbfb), var(--c1, #ff6b6b));
  background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent;
}
${P} .anim-gradient-text { animation: rmcp-gradient var(--duration, 4s) linear infinite; }
.reveal .anim-typewriter { display: inline-block; white-space: nowrap; border-right: .08em solid currentColor; padding-right: .05em; }
${P} .anim-typewriter { animation: rmcp-typewriter var(--duration, 2s) steps(var(--steps, 30), end) var(--delay, 0s) both, rmcp-caret .8s step-end infinite; }
${P} .anim-stagger > * { animation: rmcp-fade-up var(--duration, .6s) var(--ease, cubic-bezier(.2,.8,.2,1)) both; }
${Array.from({ length: 12 }, (_, i) => `${P} .anim-stagger > *:nth-child(${i + 1}) { animation-delay: calc(var(--delay, 0s) + ${(i * 0.12).toFixed(2)}s); }`).join("\n")}
html.print-pdf .reveal [class*="anim-"], html.reveal-print .reveal [class*="anim-"] { animation: none !important; clip-path: none !important; }
@media (prefers-reduced-motion: reduce) { .reveal [class*="anim-"], .reveal [class*="anim-"] > * { animation: none !important; clip-path: none !important; } }
`;
