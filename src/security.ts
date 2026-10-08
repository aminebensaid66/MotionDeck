import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type SecurityMode = "strict" | "safe" | "trusted";

function boolEnv(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function configuredHome(): string {
  const dir = process.env.MOTIONDECK_HOME;
  if (dir) return path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
  return path.join(os.homedir(), "motiondeck");
}

export function securityMode(): SecurityMode {
  const mode = process.env.MOTIONDECK_SECURITY_MODE?.trim().toLowerCase();
  return mode === "trusted" || mode === "strict" ? mode : "safe";
}

/** strict = locked down: asset roots and host allowlist only, no built-in CDNs unless opted in. */
export function isStrictMode(): boolean {
  return securityMode() === "strict";
}

export function isTrustedMode(): boolean {
  return securityMode() === "trusted";
}

export function browserNoSandboxAllowed(): boolean {
  return boolEnv("MOTIONDECK_NO_SANDBOX");
}

export function unrestrictedOutputAllowed(): boolean {
  return isTrustedMode() && boolEnv("MOTIONDECK_UNRESTRICTED_OUTPUT");
}

/** Google Fonts and Mermaid from jsDelivr. On by default; strict mode needs MOTIONDECK_ALLOW_BUILTIN_CDN=1. */
export function builtInCdnAllowed(): boolean {
  return !isStrictMode() || boolEnv("MOTIONDECK_ALLOW_BUILTIN_CDN");
}

export function assetRoots(): string[] {
  const raw = process.env.MOTIONDECK_ASSET_ROOTS;
  if (!raw) return [path.join(configuredHome(), "assets")];
  return raw
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p.replace(/^~(?=$|[\\/])/, os.homedir())));
}

export function allowedRemoteHosts(): Set<string> {
  const hosts = (process.env.MOTIONDECK_REMOTE_HOSTS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
  for (const host of hosts) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
      throw new Error(`Invalid hostname in MOTIONDECK_REMOTE_HOSTS: ${host}`);
    }
  }
  return new Set(hosts);
}

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function canonicalExisting(p: string): string {
  return existsSync(p) ? realpathSync.native(p) : path.resolve(p);
}

/** Identify an image or video by its first bytes, so a renamed non-media file (an SSH key, a .env) is never embedded. */
export function sniffMedia(file: string): string | undefined {
  const head = Buffer.alloc(1024);
  const fd = openSync(file, "r");
  let n = 0;
  try {
    n = readSync(fd, head, 0, head.length, 0);
  } finally {
    closeSync(fd);
  }
  const b = head.subarray(0, n);
  const ascii = (start: number, end: number) => b.subarray(start, end).toString("latin1");
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") return /^(avif|avis)$/.test(ascii(8, 12)) ? "image/avif" : "video/mp4";
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3) return "video/webm";
  const text = b.toString("utf8").replace(/^\uFEFF/, "");
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(text)) return "image/svg+xml";
  return undefined;
}

function resolveMediaFile(src: string): string {
  const expanded = src.replace(/^~(?=$|[\\/])/, os.homedir());
  const candidates = path.isAbsolute(expanded)
    ? [path.resolve(expanded)]
    : [...assetRoots().map((root) => path.resolve(root, expanded)), path.resolve(expanded)];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`Local asset does not exist: ${src}. Use an absolute path.`);
  const real = realpathSync.native(found);
  if (!statSync(real).isFile()) throw new Error(`Local asset is not a file: ${src}`);
  if (!sniffMedia(real)) {
    throw new Error(`Local asset is not a recognized image or video (PNG, JPEG, GIF, WebP, AVIF, SVG, MP4, WebM): ${src}`);
  }
  return real;
}

export function resolveLocalAsset(src: string): string {
  if (isTrustedMode()) return path.resolve(src.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (!isStrictMode()) return resolveMediaFile(src);
  const roots = assetRoots();
  const expanded = src.replace(/^~(?=$|[\\/])/, os.homedir());
  const candidates = path.isAbsolute(expanded) ? [path.resolve(expanded)] : roots.map((root) => path.resolve(root, expanded));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const realCandidate = canonicalExisting(candidate);
    if (roots.some((root) => isWithin(canonicalExisting(root), realCandidate))) return resolveMediaFile(realCandidate);
  }
  throw new Error(
    `Local asset is outside the allowed asset roots or does not exist: ${src}. ` +
      `Put assets under ${roots.join(", ")} or set MOTIONDECK_ASSET_ROOTS.`
  );
}

const SAFE_DATA_URL = /^data:(?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|video\/(?:mp4|webm))(?:;[^,]*)?,/i;

export function validateAssetUrl(src: string, label = "asset"): string {
  const value = src.trim();
  if (!value) throw new Error(`${label} URL/path is empty.`);
  if (isTrustedMode()) return value;

  if (/^data:/i.test(value)) {
    if (!SAFE_DATA_URL.test(value)) throw new Error(`${label} uses a disallowed data: MIME type.`);
    return value;
  }
  if (/^file:/i.test(value)) throw new Error(`${label} cannot use file: URLs in safe mode; use an allowed local path instead.`);
  if (/^\/\//.test(value)) throw new Error(`${label} cannot use protocol-relative URLs in safe mode.`);
  if (/^https?:/i.test(value)) {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS in safe mode.`);
    const hosts = allowedRemoteHosts();
    if (isStrictMode() && !hosts.has(url.hostname.toLowerCase())) {
      throw new Error(
        `${label} host '${url.hostname}' is not allowed in strict mode. Add it to MOTIONDECK_REMOTE_HOSTS or use a local asset.`
      );
    }
    return value;
  }
  return resolveLocalAsset(value);
}

export function isBrowserRequestAllowed(url: string, deckFileUrl: string): boolean {
  if (isTrustedMode()) return true;
  if (url === deckFileUrl || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:")) return true;
  if (url.startsWith("file:")) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (!isStrictMode()) return true;
    const host = u.hostname.toLowerCase();
    if (allowedRemoteHosts().has(host)) return true;
    if (builtInCdnAllowed() && ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"].includes(host)) return true;
  } catch {
    return false;
  }
  return false;
}

export function assertSafeCss(css: string | undefined, label: string): void {
  if (!css || isTrustedMode()) return;
  const dangerous = /[<>]|@import\b|url\s*\(|image-set\s*\(|(?:^|[^-])image\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:/i;
  if (dangerous.test(css)) {
    throw new Error(`${label} contains a network-capable or executable CSS construct that is blocked in safe mode.`);
  }
}

function eachSlide(slides: any[], fn: (slide: any, label: string) => void): void {
  slides.forEach((slide, i) => {
    fn(slide, String(i));
    (slide.verticalSlides ?? []).forEach((v: any, j: number) => fn(v, `${i}.${j + 1}`));
  });
}

/** Fail closed on capabilities that can execute code or embed browsing contexts. */
export function assertSafeDeck(deck: { settings: any; slides: any[] }): void {
  const serializedBytes = Buffer.byteLength(JSON.stringify(deck), "utf8");
  if (serializedBytes > 10 * 1024 * 1024) throw new Error("Presentation data exceeds the 10 MB safety limit.");
  let totalSlides = 0;
  eachSlide(deck.slides ?? [], (slide, label) => {
    totalSlides++;
    if ((slide.columns?.length ?? 0) > 12) throw new Error(`Slide ${label} exceeds the 12-column safety limit.`);
    if ((slide.fragments?.length ?? 0) > 200) throw new Error(`Slide ${label} exceeds the 200-fragment safety limit.`);
    const c = slide.component;
    if (c?.type === "comparison" && ((c.left?.items?.length ?? 0) > 100 || (c.right?.items?.length ?? 0) > 100)) {
      throw new Error(`Slide ${label} comparison exceeds the 100-item-per-side safety limit.`);
    }
    if (c?.type === "chart") {
      if ((c.labels?.length ?? 0) > 500 || c.series?.some((series: any) => (series.values?.length ?? 0) > 500)) {
        throw new Error(`Slide ${label} chart exceeds the 500-point safety limit.`);
      }
      if (c.series?.some((series: any) => series.values?.length !== c.labels?.length)) {
        throw new Error(`Slide ${label} chart series must have exactly one value per label.`);
      }
    }
  });
  if (totalSlides > 1000) throw new Error("Presentation exceeds the 1000-slide safety limit.");
  const width = Number(deck.settings?.width ?? 1280);
  const height = Number(deck.settings?.height ?? 720);
  if (width / height > 4 || height / width > 4) throw new Error("Presentation aspect ratio exceeds the 4:1 safety limit.");
  if (isTrustedMode()) return;
  const s = deck.settings ?? {};
  if (s.customJs) throw new Error("customJs is disabled in safe mode. Set MOTIONDECK_SECURITY_MODE=trusted only for content you trust.");
  if (s.headHtml) throw new Error("headHtml is disabled in safe mode. Set MOTIONDECK_SECURITY_MODE=trusted only for content you trust.");
  assertSafeCss(s.customCss, "customCss");
  if (s.brand?.primary) {
    const value = String(s.brand.primary);
    if (/[;{}<>]|@import|url\s*\(|image-set\s*\(|javascript:/i.test(value)) {
      throw new Error("brand.primary contains unsafe CSS syntax in safe mode.");
    }
  }
  for (const [key, value] of [["brand.font", s.brand?.font], ["brand.headingFont", s.brand?.headingFont]] as const) {
    if (value && !/^[A-Za-z0-9 _-]{1,80}$/.test(value)) throw new Error(`${key} contains unsupported characters in safe mode.`);
  }
  if (s.brand?.logo) validateAssetUrl(s.brand.logo, "brand.logo");
  if (s.parallaxBackgroundImage) validateAssetUrl(s.parallaxBackgroundImage, "parallaxBackgroundImage");

  eachSlide(deck.slides ?? [], (slide, label) => {
    if (slide.background?.iframe) {
      throw new Error(`Slide ${label} uses a background iframe, which is disabled in safe mode.`);
    }
    assertSafeCss(slide.style, `slide ${label} style`);
    assertSafeCss(slide.background?.gradient, `slide ${label} background.gradient`);
    if (slide.image) validateAssetUrl(slide.image, `slide ${label} image`);
    if (slide.background?.image) validateAssetUrl(slide.background.image, `slide ${label} background.image`);
    if (slide.background?.video) validateAssetUrl(slide.background.video, `slide ${label} background.video`);
    for (const key of Object.keys(slide.attributes ?? {})) {
      if (!/^(?:data-(?:state|id|auto-animate-target)|aria-[a-z0-9_.:-]+|role|lang|dir)$/i.test(key)) {
        throw new Error(`Slide ${label} attribute '${key}' is not permitted in safe mode.`);
      }
    }
  });
}

export function safeCsp(options: {
  assets?: "inline" | "cdn";
  needsMermaid?: boolean;
  needsMath?: boolean;
  usesFonts?: boolean;
}): string | undefined {
  if (isTrustedMode()) return undefined;
  const remoteHosts = isStrictMode() ? [...allowedRemoteHosts()].map((h) => `https://${h}`) : ["https:"];
  const builtins = builtInCdnAllowed();
  const script = ["'self'", "'unsafe-inline'"];
  const style = ["'self'", "'unsafe-inline'"];
  const font = ["'self'", "data:"];
  if (options.assets === "cdn" || (builtins && options.needsMermaid)) script.push("https://cdn.jsdelivr.net");
  if (options.assets === "cdn") style.push("https://cdn.jsdelivr.net");
  // The reveal.js math plugin loads KaTeX (script, stylesheet, fonts) from jsDelivr.
  if (builtins && options.needsMath) {
    if (!script.includes("https://cdn.jsdelivr.net")) script.push("https://cdn.jsdelivr.net");
    if (!style.includes("https://cdn.jsdelivr.net")) style.push("https://cdn.jsdelivr.net");
    font.push("https://cdn.jsdelivr.net");
  }
  if (builtins && options.usesFonts) {
    style.push("https://fonts.googleapis.com");
    font.push("https://fonts.gstatic.com");
  }
  return [
    "default-src 'none'",
    `script-src ${script.join(" ")}`,
    `style-src ${style.join(" ")}`,
    `font-src ${font.join(" ")}`,
    `img-src 'self' data: blob: ${remoteHosts.join(" ")}`.trim(),
    `media-src 'self' data: blob: ${remoteHosts.join(" ")}`.trim(),
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}
