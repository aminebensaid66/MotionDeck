# Running motiondeck

Most people never need this file: add motiondeck to Claude or Codex as shown in the README and the client starts it for you. This page is for running from source, checking an install, or locking it down.

## Requirements

- Node.js 22 or newer
- Chrome, Chromium, Edge or Brave for layout checks, screenshots, PDF and video
- ffmpeg for video (the optional `ffmpeg-static` package provides it automatically)

## Check an install

```bash
npx -y motiondeck doctor
```

It prints the version, Node, the browser and ffmpeg it found, the security mode and folders, and exits non-zero if something required is missing.

## From source

```bash
git clone https://github.com/aminebensaid66/MotionDeck.git
cd MotionDeck
npm ci
npm test              # build + all tests (set SKIP_VIDEO=1 to skip the video test)
node dist/index.js doctor
```

Then point your MCP client at `node /absolute/path/to/MotionDeck/dist/index.js`.

## Locked-down setup

For shared machines, or when the AI works with documents you don't control, use strict mode (see [SECURITY.md](SECURITY.md)):

```json
{
  "mcpServers": {
    "motiondeck": {
      "command": "npx",
      "args": ["-y", "motiondeck"],
      "env": {
        "MOTIONDECK_SECURITY_MODE": "strict",
        "MOTIONDECK_HOME": "/absolute/path/to/motiondeck-data",
        "MOTIONDECK_REMOTE_HOSTS": "images.example.com",
        "MOTIONDECK_ALLOW_BUILTIN_CDN": "1"
      }
    }
  }
}
```

Put local images in `/absolute/path/to/motiondeck-data/assets` (or list folders in `MOTIONDECK_ASSET_ROOTS`, separated by `:` on macOS/Linux and `;` on Windows).

Do not set `MOTIONDECK_NO_SANDBOX=1` on a normal desktop or server; it is only for root containers where Chrome cannot start with its sandbox.
