import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { Deck } from "./schema.js";

export function homeDir(): string {
  const dir = process.env.MOTIONDECK_HOME;
  if (dir) return path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
  return path.join(os.homedir(), "motiondeck");
}

export const decksDir = () => path.join(homeDir(), "decks");
export const exportsDir = () => path.join(homeDir(), "presentations");

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "deck"
  );
}

export function newId(title: string): string {
  return `${slugify(title)}-${crypto.randomBytes(3).toString("hex")}`;
}

function deckPath(id: string): string {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid presentation id: ${id}`);
  return path.join(decksDir(), `${id}.json`);
}

export async function saveDeck(deck: Deck): Promise<void> {
  await fs.mkdir(decksDir(), { recursive: true });
  deck.updatedAt = new Date().toISOString();
  const file = deckPath(deck.id);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(deck, null, 2));
  await fs.rename(tmp, file);
}

export async function loadDeck(id: string): Promise<Deck> {
  try {
    return JSON.parse(await fs.readFile(deckPath(id), "utf8")) as Deck;
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(`No presentation with id '${id}'. Use list_presentations to see available ids.`);
    }
    throw e;
  }
}

export async function deleteDeck(id: string): Promise<void> {
  await fs.rm(deckPath(id), { force: true });
}

export async function listDecks(): Promise<Deck[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(decksDir());
  } catch {
    return [];
  }
  const decks = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          return JSON.parse(await fs.readFile(path.join(decksDir(), f), "utf8")) as Deck;
        } catch {
          return null;
        }
      })
  );
  return decks.filter((d): d is Deck => !!d).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
