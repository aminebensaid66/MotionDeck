import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DeckSchema, type Deck } from "./schema.js";

export function homeDir(): string {
  const dir = process.env.MOTIONDECK_HOME;
  if (dir) return path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
  return path.join(os.homedir(), "motiondeck");
}

export const decksDir = () => path.join(homeDir(), "decks");
export const exportsDir = () => path.join(homeDir(), "presentations");

async function ensureDecksDir(): Promise<string> {
  const dir = decksDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("The deck storage directory must be a real directory, not a symbolic link.");
  }
  return dir;
}

async function assertRegularDeckFile(file: string): Promise<void> {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Deck files must be regular files, not symbolic links.");
}

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
  await ensureDecksDir();
  deck.updatedAt = new Date().toISOString();
  const file = deckPath(deck.id);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(deck, null, 2), { mode: 0o600, flag: "wx" });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

export async function loadDeck(id: string): Promise<Deck> {
  try {
    await ensureDecksDir();
    const file = deckPath(id);
    await assertRegularDeckFile(file);
    const parsed = DeckSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    if (parsed.id !== id) throw new Error(`Presentation id mismatch: requested '${id}', file contains '${parsed.id}'.`);
    return parsed;
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new Error(`No presentation with id '${id}'. Use list_presentations to see available ids.`);
    }
    throw e;
  }
}

export async function deleteDeck(id: string): Promise<void> {
  await ensureDecksDir();
  await fs.rm(deckPath(id), { force: true });
}

export async function listDecks(): Promise<Deck[]> {
  const dir = await ensureDecksDir();
  const files = await fs.readdir(dir, { withFileTypes: true });
  const decks = await Promise.all(
    files
      .filter((f) => f.isFile() && f.name.endsWith(".json"))
      .map(async (f) => {
        try {
          return DeckSchema.parse(JSON.parse(await fs.readFile(path.join(decksDir(), f.name), "utf8")));
        } catch {
          return null;
        }
      })
  );
  return decks.filter((d): d is Deck => !!d).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
