# reveal-mcp

An MCP server that lets Claude (Claude Code, Claude Desktop) and OpenAI Codex build **reveal.js presentations with real motion**: slide transitions, fragments, auto-animate ("magic move"), built-in CSS motion classes, code walkthroughs, math, speaker notes.

What it adds on top of an AI writing HTML by hand:

- **🎬 Video export.** It records the deck playing, with every transition and animation, to **MP4, WebM or GIF** (1080p, 720p, square or vertical). Use it for LinkedIn, YouTube, product demos or a looping GIF in a README.
- **👀 The AI sees its own slides.** `screenshot_slides` renders the deck to images, returns them to the model and flags layout bugs: text running off the slide, code that is cut off, broken images, empty slides. The model fixes them before you ever look.
- **📦 Portable output.** One offline HTML file with everything inlined, or a PDF.
- **✏️ Surgical edits.** Decks are saved, so "change slide 4" only touches slide 4.

```
You: "Make a 10-slide animated deck introducing our new API, dark theme"
Claude → create_presentation(...)   → ~/reveal-mcp/presentations/our-new-api-3f9a1c.html
       → screenshot_slides(...)     → sees slide 6 overflows by 120px, splits it in two
       → export_video(format: mp4)  → ~/reveal-mcp/presentations/our-new-api-3f9a1c.mp4
```

## Install

Requires Node.js 18+. Screenshots, PDF and video use the Chrome, Chromium, Edge or Brave already on your machine (no browser is downloaded). Video also needs ffmpeg, which is installed automatically through the optional `ffmpeg-static` dependency. If that download is blocked, install ffmpeg yourself or point `REVEAL_MCP_FFMPEG` at it.

Until the package is published to npm, build it from source:

```bash
git clone <this repo> reveal-mcp && cd reveal-mcp
npm install          # also builds dist/
npm link             # optional: puts `reveal-mcp` on your PATH
```

Then use `node /absolute/path/to/reveal-mcp/dist/index.js` as the command in the configs below (or `reveal-mcp` if you ran `npm link`). Once published, `npx -y reveal-mcp` works everywhere.

### Claude Code

```bash
claude mcp add reveal -- npx -y reveal-mcp
# from source:
claude mcp add reveal -- node /absolute/path/to/reveal-mcp/dist/index.js
```

Add `--scope user` to make it available in every project.

### Claude Desktop

Settings → Developer → Edit Config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "reveal": {
      "command": "npx",
      "args": ["-y", "reveal-mcp"]
    }
  }
}
```

Restart Claude Desktop. On Windows use `"command": "npx.cmd"` if `npx` is not found.

### OpenAI Codex (CLI and IDE extension)

```bash
codex mcp add reveal -- npx -y reveal-mcp
```

or edit `~/.codex/config.toml`:

```toml
[mcp_servers.reveal]
command = "npx"
args = ["-y", "reveal-mcp"]
startup_timeout_sec = 60   # first npx run downloads the package
tool_timeout_sec = 600     # video export records in real time
```

### Any other MCP client

It is a standard stdio server: `npx -y reveal-mcp`. Inspect it with `npm run inspect`.

## Tools

| Tool | What it does |
| --- | --- |
| `create_presentation` | Title + settings + all slides in one call. Writes the HTML immediately and returns its path. |
| `add_slides` | Insert slides at a position (default: end). |
| `update_slide` | Merge or replace fields of a slide (or of a vertical sub-slide). `null` removes a field. |
| `remove_slide` / `move_slide` | Reorder and prune. |
| `update_presentation_settings` | Theme, default transition, slide numbers, auto-slide, size, custom CSS/JS/head HTML. |
| `screenshot_slides` | Renders slides (final state, all fragments shown) to images for the model, as one contact sheet or one image per slide, and lists layout issues. Images are also saved next to the deck. |
| `export_video` | Plays the deck in a headless browser and records it to `mp4`, `webm` or `gif`. Options: resolution, fps, slideDuration, fragmentDuration, showControls. Reports progress while recording. |
| `export_presentation` | `html` (assets inlined, works offline; or `assets: "cdn"` for a ~15 KB file) or `pdf`. |
| `preview_presentation` | Local `http://127.0.0.1:<port>/<id>` URL that always renders the latest version. |
| `get_presentation` / `list_presentations` / `delete_presentation` | Manage saved decks. |
| `get_authoring_guide` | Cheat sheet the model reads before building ambitious decks (also exposed as resource `reveal://guide`). |

There is also a `make_presentation` prompt (topic, audience, slides, style) that kicks off a polished deck.

Every edit re-renders `~/reveal-mcp/presentations/<id>.html`, so you can keep the file open and refresh.

## What a slide can contain

```jsonc
{
  "title": "Agenda",
  "subtitle": "optional",
  "content": "- Markdown **or** HTML\n- ```js [1|2-3]``` fences step through lines",
  "format": "markdown",                    // or "html"
  "layout": "default",                     // title | section | center | columns | image-left | image-right | fullscreen
  "columns": ["### Left", "### Right"],    // with layout "columns"
  "image": "/abs/path/or/url.png",         // with image-left / image-right (local files are embedded)
  "code": { "code": "...", "language": "ts", "lineNumbers": "|1-3|5", "dataId": "snippet" },
  "fragments": [{ "content": "Revealed later", "effect": "highlight-red", "index": 2 }],
  "listFragments": "fade-up",              // reveal every bullet one by one
  "notes": "Speaker notes (press S)",
  "background": { "gradient": "linear-gradient(135deg,#667eea,#764ba2)" }, // color | image | video | iframe, opacity, size
  "transition": "zoom",                    // none fade slide convex concave zoom (+ transitionIn/Out, transitionSpeed)
  "autoAnimate": true,                     // morph matching elements into the next/previous auto-animate slide
  "autoSlide": 3000,
  "duration": 5000,                        // video export: ms this slide stays on screen
  "className": "anim-fade-up",
  "verticalSlides": [{ "title": "Drill-down" }]
}
```

### Motion toolbox

- **Transitions**: deck-wide `transition` or per slide; split with `transitionIn`/`transitionOut`.
- **Fragments**: 19 reveal.js effects (`fade-up`, `grow`, `strike`, `highlight-current-blue`, ...).
- **Auto-animate**: consecutive `autoAnimate` slides tween position, size, color, radius, font size; match by text or `data-id`. Code blocks with the same `dataId` morph line by line.
- **Motion classes** (added by reveal-mcp, play whenever the slide appears): `anim-fade-up/down/left/right`, `anim-zoom-in/out`, `anim-flip-in`, `anim-blur-in`, `anim-bounce-in`, `anim-shake`, `anim-float`, `anim-pulse`, `anim-spin`, `anim-gradient-text`, `anim-typewriter`, `anim-stagger`. Tune with `style="--delay:.3s; --duration:1s"`. They are disabled in PDF export and for users with reduced-motion enabled.
- **Escape hatches**: `customCss` (your own keyframes, fonts, `--r-*` theme variables), `headHtml` + `customJs` (e.g. load GSAP and hook `Reveal.on('slidechanged', ...)`).

See [`examples/showcase.json`](examples/showcase.json) for a deck that uses most of these; pass it straight to `create_presentation`.

Themes: black, white, league, beige, sky, night, serif, simple, solarized, blood, moon, dracula, black-contrast, white-contrast.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `REVEAL_MCP_HOME` | `~/reveal-mcp` | Where decks (`decks/*.json`) and exports (`presentations/`) live |
| `REVEAL_MCP_CHROME` | auto-detect | Browser used for screenshots, PDF and video (`CHROME_PATH` also works) |
| `REVEAL_MCP_FFMPEG` | auto-detect | ffmpeg used for video (`ffmpeg-static`, then `ffmpeg` on PATH) |
| `REVEAL_MCP_PREVIEW_PORT` | random | Fixed port for `preview_presentation` |

Pass env vars through your client config, for example in Codex:

```toml
[mcp_servers.reveal.env]
REVEAL_MCP_HOME = "/Users/me/Documents/Decks"
```

## Notes

- Exported HTML inlines reveal.js, its theme and plugins, so it opens offline. Theme web fonts (Google Fonts) and KaTeX for math load from the internet when available and fall back gracefully.
- Video is recorded in real time: a 10-slide deck takes about as long to export as it takes to play, plus a few seconds of encoding. Smoothness depends on the machine. If your app times out on long videos, raise its MCP tool timeout (Codex: `tool_timeout_sec`; Claude Code: the `MCP_TOOL_TIMEOUT` environment variable, in ms).
- `customJs` and `headHtml` are written into your own HTML file as-is; only use content you trust.

## Development

```bash
npm install
npm run build
npm test          # end-to-end over stdio: every tool, screenshots, PDF and video (SKIP_PDF=1 / SKIP_VIDEO=1 to skip)
npm run inspect   # MCP Inspector
```

## License

MIT. reveal.js is MIT licensed by Hakim El Hattab.
