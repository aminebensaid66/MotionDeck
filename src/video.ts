import { promises as fs, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { withDeckPage } from "./browser.js";

declare const Reveal: any;

export type VideoFormat = "mp4" | "webm" | "gif";

export interface VideoOptions {
  format: VideoFormat;
  width?: number;
  height?: number;
  fps?: number;
  /** Default time on each slide, in ms, including its transition. */
  slideDuration?: number;
  /** Time after each fragment step, in ms. */
  fragmentDuration?: number;
  showControls?: boolean;
  onProgress?: (step: number, total: number, message: string) => void;
}

export interface VideoResult {
  seconds: number;
  frames: number;
  steps: number;
}

export function findFfmpeg(): string | undefined {
  const fromEnv = process.env.MOTIONDECK_FFMPEG;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const p = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    if (p && existsSync(p)) return p;
  } catch {
    /* optional dependency not installed */
  }
  const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return r.status === 0 ? "ffmpeg" : undefined;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${err}`))));
  });
}

function ffmpegArgs(format: VideoFormat, list: string, out: string, fps: number, width: number): string[] {
  const input = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list];
  if (format === "gif") {
    const w = Math.min(width, 960);
    return [
      ...input,
      "-vf",
      `fps=${Math.min(fps, 15)},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
      "-loop",
      "0",
      out,
    ];
  }
  const vf = ["-vf", `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`];
  if (format === "webm") {
    return [...input, ...vf, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", out];
  }
  return [...input, ...vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", out];
}

/**
 * Plays the deck in a headless browser in real time, walking through every slide and fragment,
 * records the screen through the DevTools screencast and encodes the frames with ffmpeg.
 */
export async function recordVideo(htmlFile: string, outFile: string, opts: VideoOptions): Promise<VideoResult> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    throw new Error(
      "Video export needs ffmpeg. Install it (brew install ffmpeg / apt install ffmpeg / winget install ffmpeg) or set MOTIONDECK_FFMPEG to its path."
    );
  }
  const width = opts.width ?? 1920;
  const height = opts.height ?? 1080;
  const fps = opts.fps ?? 30;
  const slideMs = opts.slideDuration ?? 3000;
  const fragmentMs = opts.fragmentDuration ?? 1500;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "motiondeck-video-"));

  try {
    const frames: { file: string; t: number }[] = [];
    let writes: Promise<unknown> = Promise.resolve();
    let endT = 0;
    let steps = 0;

    await withDeckPage(htmlFile, { width, height }, async (page) => {
      const total: number = await page.evaluate((showControls: boolean) => {
        Reveal.configure({
          autoSlide: 0,
          hash: false,
          controls: showControls,
          progress: showControls,
          slideNumber: showControls ? Reveal.getConfig().slideNumber : false,
          viewDistance: 100,
        });
        Reveal.slide(0, 0, -1);
        // Count steps (slides + fragments) for progress reporting.
        let n = 0;
        Reveal.getSlides().forEach((s: HTMLElement) => {
          n += 1 + new Set(Array.from(s.querySelectorAll(".fragment")).map((f, i) => f.getAttribute("data-fragment-index") ?? `i${i}`)).size;
        });
        return n;
      }, opts.showControls ?? false);
      await new Promise((r) => setTimeout(r, 400));

      const cdp = await page.createCDPSession();
      let i = 0;
      cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
        cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
        const file = path.join(dir, `f${String(i++).padStart(6, "0")}.jpg`);
        frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
        writes = writes.then(() => fs.writeFile(file, Buffer.from(f.data, "base64")));
      });
      await cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 92,
        maxWidth: width,
        maxHeight: height,
        everyNthFrame: 1,
      });

      // Replay the first slide's entrance animations now that recording is running.
      await page.evaluate(() => {
        const s = Reveal.getCurrentSlide() as HTMLElement;
        s.getAnimations({ subtree: true }).forEach((a) => {
          a.cancel();
          a.play();
        });
      });

      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const slideHold = () =>
        page.evaluate((d: number) => Number(Reveal.getCurrentSlide().getAttribute("data-rmcp-duration")) || d, slideMs);

      await wait(await slideHold());
      steps = 1;
      opts.onProgress?.(steps, total, "Recording slide 1");
      for (let guard = 0; guard < 2000; guard++) {
        const moved: "slide" | "fragment" | null = await page.evaluate(() => {
          const before = Reveal.getIndices();
          if (Reveal.isLastSlide() && !Reveal.availableFragments().next) return null;
          Reveal.next();
          const after = Reveal.getIndices();
          if (before.h === after.h && before.v === after.v) return before.f === after.f ? null : "fragment";
          return "slide";
        });
        if (!moved) break;
        steps++;
        opts.onProgress?.(steps, total, `Recording ${moved === "slide" ? "slide" : "fragment"} (step ${steps})`);
        await wait(moved === "slide" ? await slideHold() : fragmentMs);
      }
      endT = Date.now() / 1000;
      await cdp.send("Page.stopScreencast");
      await wait(100);
    });
    await writes;

    if (frames.length === 0) throw new Error("No frames were captured from the browser.");
    // Screencast timestamps are wall-clock seconds; frames only arrive when something changes,
    // so each frame is held until the next one.
    frames.sort((a, b) => a.t - b.t);
    const lines: string[] = [];
    for (let k = 0; k < frames.length; k++) {
      const next = k + 1 < frames.length ? frames[k + 1].t : Math.max(endT, frames[k].t + 0.5);
      const d = Math.min(Math.max(next - frames[k].t, 1 / 120), 60);
      lines.push(`file '${frames[k].file.replace(/'/g, "'\\''")}'`, `duration ${d.toFixed(4)}`);
    }
    // The concat demuxer ignores the last duration unless the final file is listed again.
    lines.push(`file '${frames[frames.length - 1].file.replace(/'/g, "'\\''")}'`);
    const list = path.join(dir, "frames.txt");
    await fs.writeFile(list, lines.join("\n"));

    opts.onProgress?.(steps, steps, `Encoding ${opts.format.toUpperCase()}`);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await run(ffmpeg, ffmpegArgs(opts.format, list, outFile, fps, width));
    const seconds = frames.length ? Math.max(endT - frames[0].t, 0) : 0;
    return { seconds: Math.round(seconds * 10) / 10, frames: frames.length, steps };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
