import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ScryfallCard } from './types.js';
import { getConfig } from './config.js';

// Build-time only: reads the ManaBox export and enriches it with Scryfall
// data while the site is built. Never imported from client-side code, so
// Node builtins (fs) are safe to use here.

const BULK_DATA_INDEX_ENDPOINT = 'https://api.scryfall.com/bulk-data';
const BULK_DATA_TYPE = 'default_cards'; // every printing, English, with prices — see https://scryfall.com/docs/api/bulk-data
const COLLECTION_ENDPOINT = 'https://api.scryfall.com/cards/collection';
const CHUNK_SIZE = 75; // Scryfall's max identifiers per /cards/collection request
const REQUEST_DELAY_MS = 100; // stay well under Scryfall's rate limit guidance
const USER_AGENT = 'astro-mtg-collection (build script)';

interface CacheEntry {
  card: ScryfallCard;
  fetchedAt: number;
}

type Cache = Record<string, CacheEntry>;

function loadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function saveJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BulkDataEntry {
  type: string;
  updated_at: string;
  jsonl_download_uri: string;
}

interface BulkDataMeta {
  updatedAt: string;
  fetchedAt: number;
}

function bulkMetaPath(bulkDataPath: string): string {
  return `${bulkDataPath}.meta.json`;
}

/**
 * Ensures the local default_cards bulk-data file is present and current,
 * downloading it only when missing or stale. This is Scryfall's recommended
 * approach for looking up many cards (https://scryfall.com/docs/api/bulk-data):
 * two requests total (the bulk-data index, then the file itself, both cached
 * on disk) instead of one /cards/collection request per 75 cards on every
 * build.
 */
async function ensureBulkData(bulkDataPath: string, cacheTtlMs: number): Promise<void> {
  const metaPath = bulkMetaPath(bulkDataPath);
  const meta = loadJson<BulkDataMeta>(metaPath);
  const now = Date.now();

  if (meta && fs.existsSync(bulkDataPath) && now - meta.fetchedAt < cacheTtlMs) {
    return; // fresh enough — skip hitting the network entirely
  }

  const indexRes = await fetch(BULK_DATA_INDEX_ENDPOINT, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  if (!indexRes.ok) {
    throw new Error(`Scryfall bulk-data index error (${indexRes.status}): ${indexRes.statusText}`);
  }
  const index = (await indexRes.json()) as { data: BulkDataEntry[] };
  const entry = index.data.find((d) => d.type === BULK_DATA_TYPE);
  if (!entry) {
    throw new Error(`Scryfall bulk-data index did not include a "${BULK_DATA_TYPE}" entry.`);
  }

  if (meta && meta.updatedAt === entry.updated_at && fs.existsSync(bulkDataPath)) {
    saveJson(metaPath, { updatedAt: meta.updatedAt, fetchedAt: now } satisfies BulkDataMeta);
    return; // same version already on disk — just refresh the TTL stamp
  }

  fs.mkdirSync(path.dirname(bulkDataPath), { recursive: true });
  const tmpPath = `${bulkDataPath}.tmp`;
  try {
    // Kept gzip-compressed on disk as Scryfall serves it (~1/4 the size) —
    // readCardsFromBulkData gunzips on the fly while reading.
    const fileRes = await fetch(entry.jsonl_download_uri, { headers: { 'User-Agent': USER_AGENT } });
    if (!fileRes.ok || !fileRes.body) {
      throw new Error(`Scryfall bulk-data download error (${fileRes.status}): ${fileRes.statusText}`);
    }
    await pipeline(Readable.fromWeb(fileRes.body as import('stream/web').ReadableStream), fs.createWriteStream(tmpPath));
    fs.renameSync(tmpPath, bulkDataPath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }

  saveJson(metaPath, { updatedAt: entry.updated_at, fetchedAt: now } satisfies BulkDataMeta);
}

/**
 * Streams the gzip-compressed JSON Lines bulk-data file (every Scryfall
 * printing — several hundred thousand entries, one JSON object per line)
 * and picks out only the cards in `wantedIds`, so we never hold the full
 * dataset in memory at once.
 */
async function readCardsFromBulkData(
  bulkDataPath: string,
  wantedIds: Set<string>
): Promise<Map<string, ScryfallCard>> {
  const found = new Map<string, ScryfallCard>();
  if (wantedIds.size === 0) return found;

  const source = fs.createReadStream(bulkDataPath);
  const lines = readline.createInterface({ input: source.pipe(zlib.createGunzip()), crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line) continue;
      const card = JSON.parse(line) as ScryfallCard;
      if (wantedIds.has(card.id)) {
        found.set(card.id, card);
        if (found.size === wantedIds.size) break;
      }
    }
  } finally {
    lines.close();
    source.destroy();
  }

  return found;
}

export interface FetchCollectionResult {
  cards: Map<string, ScryfallCard>;
  notFound: string[];
}

/**
 * Looks up Scryfall card data for a set of card IDs at build time. Cards are
 * resolved from the local bulk-data snapshot first (downloaded/refreshed as
 * needed) and only missing IDs — e.g. printings added after the last bulk
 * refresh — fall back to the live /cards/collection endpoint, batched 75 at
 * a time. Results are cached on disk (per the resolved config's
 * cacheTtlHours) so repeated local builds don't re-touch the network or
 * re-parse the bulk file at all.
 */
export async function fetchCollection(scryfallIds: string[]): Promise<FetchCollectionResult> {
  const { scryfallCachePath, scryfallBulkCachePath, cacheTtlHours } = getConfig();
  const cacheTtlMs = cacheTtlHours * 60 * 60 * 1000;

  const uniqueIds = Array.from(new Set(scryfallIds));
  const cache = loadJson<Cache>(scryfallCachePath) ?? {};
  const now = Date.now();

  const cards = new Map<string, ScryfallCard>();
  const idsToFetch: string[] = [];

  for (const id of uniqueIds) {
    const cached = cache[id];
    if (cached && now - cached.fetchedAt < cacheTtlMs) {
      cards.set(id, cached.card);
    } else {
      idsToFetch.push(id);
    }
  }

  const notFound: string[] = [];

  if (idsToFetch.length > 0) {
    await ensureBulkData(scryfallBulkCachePath, cacheTtlMs);
    const fromBulk = await readCardsFromBulkData(scryfallBulkCachePath, new Set(idsToFetch));

    for (const [id, card] of fromBulk) {
      cards.set(id, card);
      cache[id] = { card, fetchedAt: now };
    }

    const stillMissing = idsToFetch.filter((id) => !fromBulk.has(id));

    for (let i = 0; i < stillMissing.length; i += CHUNK_SIZE) {
      const chunk = stillMissing.slice(i, i + CHUNK_SIZE);

      const response = await fetch(COLLECTION_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ identifiers: chunk.map((id) => ({ id })) }),
      });

      if (!response.ok) {
        throw new Error(`Scryfall API error (${response.status}): ${response.statusText}`);
      }

      const json = (await response.json()) as { data: ScryfallCard[]; not_found?: Array<{ id: string }> };

      for (const card of json.data) {
        cards.set(card.id, card);
        cache[card.id] = { card, fetchedAt: now };
      }
      for (const nf of json.not_found ?? []) {
        notFound.push(nf.id);
      }

      if (i + CHUNK_SIZE < stillMissing.length) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    saveJson(scryfallCachePath, cache);
  }

  return { cards, notFound };
}

/** Picks the best available image for a card, handling double-faced cards. */
export function getCardImage(card: ScryfallCard | null): string | null {
  if (!card) return null;
  if (card.image_uris?.normal) return card.image_uris.normal;
  const face = card.card_faces?.find((f) => f.image_uris?.normal);
  return face?.image_uris?.normal ?? null;
}

/** Picks the unit price for the printing/finish recorded in the ManaBox row. */
export function getUnitPrice(card: ScryfallCard | null, foil: string): number | null {
  if (!card) return null;
  const raw =
    foil === 'etched'
      ? card.prices.usd_etched ?? card.prices.usd_foil ?? card.prices.usd
      : foil === 'foil'
        ? card.prices.usd_foil ?? card.prices.usd
        : card.prices.usd ?? card.prices.usd_foil;
  if (!raw) return null;
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : null;
}
