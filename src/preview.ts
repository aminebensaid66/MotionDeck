import http from "node:http";
import type { AddressInfo } from "node:net";
import { loadDeck } from "./store.js";
import { renderDeck } from "./render.js";

let server: http.Server | undefined;
let port: number | undefined;

/** Starts (once) a localhost server that renders decks fresh on every request: http://127.0.0.1:PORT/<id> */
export async function ensurePreviewServer(): Promise<number> {
  if (server && port) return port;
  server = http.createServer(async (req, res) => {
    try {
      const id = decodeURIComponent((req.url ?? "/").split("?")[0].replace(/^\/+|\/+$/g, ""));
      if (!id) {
        res.writeHead(404).end("Open /<presentation-id>");
        return;
      }
      const deck = await loadDeck(id);
      const html = await renderDeck(deck, { assets: "inline" });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
    } catch (e: any) {
      res.writeHead(404, { "content-type": "text/plain" }).end(String(e?.message ?? e));
    }
  });
  const wanted = Number(process.env.MOTIONDECK_PREVIEW_PORT ?? 0);
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(wanted, "127.0.0.1", () => resolve());
  });
  server.unref();
  port = (server.address() as AddressInfo).port;
  return port;
}
