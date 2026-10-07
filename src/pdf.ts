import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

function candidateBrowsers(): string[] {
  const env = [process.env.REVEAL_MCP_CHROME, process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH];
  const list: string[] = env.filter((p): p is string => !!p);
  if (process.platform === "darwin") {
    list.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    );
  } else if (process.platform === "win32") {
    const roots = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(
      Boolean
    ) as string[];
    for (const r of roots) {
      list.push(
        path.join(r, "Google/Chrome/Application/chrome.exe"),
        path.join(r, "Microsoft/Edge/Application/msedge.exe"),
        path.join(r, "BraveSoftware/Brave-Browser/Application/brave.exe")
      );
    }
  } else {
    list.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/opt/pw-browsers/chromium"
    );
  }
  return list;
}

export function findBrowser(): string | undefined {
  return candidateBrowsers().find((p) => existsSync(p));
}

export async function htmlToPdf(htmlFile: string, pdfFile: string, width: number, height: number): Promise<void> {
  const executablePath = findBrowser();
  if (!executablePath) {
    throw new Error(
      "PDF export needs Chrome, Chromium, Edge or Brave. Install one or set REVEAL_MCP_CHROME to its executable. " +
        `Alternatively open ${pathToFileURL(htmlFile).href}?print-pdf in Chrome and use Print > Save as PDF.`
    );
  }
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--allow-file-access-from-files"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${pathToFileURL(htmlFile).href}?print-pdf`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction("window.__revealReady === true", { timeout: 60_000 });
    // Give fonts, highlight and math a moment to settle.
    await page.evaluate("document.fonts ? document.fonts.ready : null");
    await new Promise((r) => setTimeout(r, 500));
    await page.pdf({
      path: pdfFile,
      width: `${width}px`,
      height: `${height}px`,
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 120_000,
    });
  } finally {
    await browser.close();
  }
}
