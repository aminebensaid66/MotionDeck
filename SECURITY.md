# Security model

motiondeck treats every presentation as untrusted, because an AI writes it and the AI may have read a malicious document, web page or email while doing so. A deck should never be able to run code, read your files or write outside motiondeck's own folder.

There are three modes, chosen with `MOTIONDECK_SECURITY_MODE`.

## safe (default)

- **HTML is sanitized, not executed.** Slides keep layout and motion markup (tags such as `div`, `span`, `ul`, tables, `class`, `style`, `data-id` for auto-animate, `fragment` classes). Scripts, event handlers (`onclick`, `onerror`...), iframes, forms, SVG, `javascript:` links and unknown tags are removed.
- **Rejected outright:** `customJs`, `headHtml`, background iframes, and `url()`, `@import`, `image-set()` or `expression()` in custom CSS, gradients or inline styles.
- **Images and videos:** any `https://` URL, or a local file anywhere on disk **if its contents are really an image or video** (PNG, JPEG, GIF, WebP, AVIF, SVG, MP4, WebM, checked by file signature, not by extension). A file such as `~/.ssh/id_rsa` renamed to `.png` is refused, so it cannot be embedded into a deck. Local files are embedded as data URIs (up to 25 MB).
- **Exports** stay inside `<MOTIONDECK_HOME>/presentations`. `outputPath` is relative to it, and symbolic links are refused.
- **Generated HTML** carries a Content-Security-Policy: no network requests from scripts, no frames, no forms, and scripts only from the page itself and jsDelivr (Mermaid, KaTeX).
- **Headless Chrome** keeps its sandbox on and blocks `file:` and non-HTTPS requests while rendering screenshots, PDF and video.
- **Limits:** 1000 slides, 10 MB per deck, 500 chart points, 12 columns, 200 fragments, sensible slide sizes. Saved decks are validated when loaded.
- Fonts (Google Fonts), Mermaid and KaTeX load from their CDNs so decks look right out of the box.

## strict

Everything in safe mode, plus:

- remote images and videos only from hosts listed in `MOTIONDECK_REMOTE_HOSTS` (comma-separated);
- local files only from the folders in `MOTIONDECK_ASSET_ROOTS` (default `<MOTIONDECK_HOME>/assets`);
- no font, Mermaid or KaTeX CDN unless `MOTIONDECK_ALLOW_BUILTIN_CDN=1`. Set `MOTIONDECK_MERMAID` to a local `mermaid.min.js` to keep diagrams without a CDN.

Use it on shared machines or when the AI handles documents you don't control.

## trusted

`MOTIONDECK_SECURITY_MODE=trusted` turns the checks off: raw HTML, `customJs`, `headHtml`, iframes and any asset path. Use it only for content you wrote yourself. Exports still stay in the presentations folder unless you also set `MOTIONDECK_UNRESTRICTED_OUTPUT=1`.

## Other settings

- `MOTIONDECK_NO_SANDBOX=1` disables the Chrome sandbox. Only for containers running as root where Chrome cannot start otherwise.

## Reporting issues

Treat any way to run script, read an arbitrary local file, write outside the presentations folder, or make unexpected network requests while in safe or strict mode as a security bug. Please open an issue with the smallest deck or tool call that reproduces it, without private files or secrets.
