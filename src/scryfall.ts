import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ScryfallCard } from './types.js';
import { getConfig } from './config.js';
import { candidateKeysForCard, type CollectionIdentifier, type RowIdentity } from './card-identity.js';

// Build-time only: reads the collection export and enriches it with
// Scryfall data while the site is built. Never imported from client-side
// code, so Node builtins (fs) are safe to use here.

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

/** Keyed by matchKey (see card-identity.ts), not raw Scryfall ID — a row without one still gets a stable cache key from its set+number or name. */
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

/** Human-readable description of an identifier, for the notFound list. */
function describeLookup(lookup: CollectionIdentifier): string {
  if ('id' in lookup) return lookup.id;
  if ('collector_number' in lookup) return `${lookup.set.toUpperCase()} #${lookup.collector_number}`;
  return lookup.set ? `${lookup.name} (${lookup.set.toUpperCase()})` : lookup.name;
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
 * and picks out only the cards matching `wanted`'s identifiers, so we
 * never hold the full dataset in memory at once.
 *
 * Every wanted row is checked by Scryfall ID first (a single cheap string
 * check) since that's the common case (ManaBox/Moxfield/Helvault usually
 * have one). Only rows still unresolved fall through to the fuller
 * set+number/name matching in candidateKeysForCard — this keeps the
 * per-line cost close to the old ID-only lookup for typical collections,
 * paying the extra work only when a row actually lacks a Scryfall ID.
 */
async function readCardsFromBulkData(bulkDataPath: string, wanted: RowIdentity[]): Promise<Map<string, ScryfallCard>> {
  const found = new Map<string, ScryfallCard>();
  if (wanted.length === 0) return found;

  const remaining = new Set(wanted.map((w) => w.matchKey));
  const needsFallbackMatch = wanted.some((w) => !('id' in w.lookup));

  const source = fs.createReadStream(bulkDataPath);
  const lines = readline.createInterface({ input: source.pipe(zlib.createGunzip()), crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (!line) continue;
      const card = JSON.parse(line) as ScryfallCard;

      const idKey = `id:${card.id.toLowerCase()}`;
      if (remaining.has(idKey)) {
        found.set(idKey, card);
        remaining.delete(idKey);
      } else if (needsFallbackMatch) {
        for (const key of candidateKeysForCard(card)) {
          if (remaining.has(key)) {
            found.set(key, card);
            remaining.delete(key);
            break;
          }
        }
      }

      if (remaining.size === 0) break;
    }
  } finally {
    lines.close();
    source.destroy();
  }

  return found;
}

export interface FetchCollectionResult {
  cards: Map<string, ScryfallCard>;
  /** Human-readable identifiers (Scryfall ID / set+number / name) for rows Scryfall didn't recognize. */
  notFound: string[];
}

/**
 * Looks up Scryfall card data for a set of collection rows at build time.
 * Each row is identified by whatever it has (Scryfall ID, set + collector
 * number, or name — see card-identity.ts), and cards are resolved from the
 * local bulk-data snapshot first (downloaded/refreshed as needed), falling
 * back to the live /cards/collection endpoint — which accepts the same
 * mixed identifier shapes — only for rows the snapshot doesn't resolve,
 * batched 75 at a time. Results are cached on disk by matchKey (per the
 * resolved config's cacheTtlHours) so repeated local builds don't re-touch
 * the network or re-parse the bulk file at all.
 */
export async function fetchCollection(identities: RowIdentity[]): Promise<FetchCollectionResult> {
  const { scryfallCachePath, scryfallBulkCachePath, cacheTtlHours } = getConfig();
  const cacheTtlMs = cacheTtlHours * 60 * 60 * 1000;

  const uniqueByKey = new Map(identities.map((i) => [i.matchKey, i]));
  const cache = loadJson<Cache>(scryfallCachePath) ?? {};
  const now = Date.now();

  const cards = new Map<string, ScryfallCard>();
  const toFetch: RowIdentity[] = [];

  for (const identity of uniqueByKey.values()) {
    const cached = cache[identity.matchKey];
    if (cached && now - cached.fetchedAt < cacheTtlMs) {
      cards.set(identity.matchKey, cached.card);
    } else {
      toFetch.push(identity);
    }
  }

  const notFound: string[] = [];

  if (toFetch.length > 0) {
    await ensureBulkData(scryfallBulkCachePath, cacheTtlMs);
    const fromBulk = await readCardsFromBulkData(scryfallBulkCachePath, toFetch);

    for (const [matchKey, card] of fromBulk) {
      cards.set(matchKey, card);
      cache[matchKey] = { card, fetchedAt: now };
    }

    const stillMissing = toFetch.filter((i) => !fromBulk.has(i.matchKey));
    const missingByKey = new Map(stillMissing.map((i) => [i.matchKey, i]));

    for (let i = 0; i < stillMissing.length; i += CHUNK_SIZE) {
      const chunk = stillMissing.slice(i, i + CHUNK_SIZE);

      const response = await fetch(COLLECTION_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ identifiers: chunk.map((c) => c.lookup) }),
      });

      if (!response.ok) {
        throw new Error(`Scryfall API error (${response.status}): ${response.statusText}`);
      }

      const json = (await response.json()) as { data: ScryfallCard[] };

      // The response doesn't say which identifier matched which card, so
      // reverse-match each returned card against the identifiers still
      // outstanding in this chunk — the same candidate-key logic used
      // against the bulk-data file.
      const remainingKeys = new Set(chunk.map((c) => c.matchKey));
      for (const card of json.data) {
        const matchedKey = candidateKeysForCard(card).find((k) => remainingKeys.has(k));
        if (!matchedKey) continue;
        cards.set(matchedKey, card);
        cache[matchedKey] = { card, fetchedAt: now };
        remainingKeys.delete(matchedKey);
      }
      for (const key of remainingKeys) {
        const identity = missingByKey.get(key);
        notFound.push(identity ? describeLookup(identity.lookup) : key);
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

/**
 * True for full-bleed "full art" printings — Scryfall's own `full_art` flag,
 * plus borderless treatments (showcase borderless, extended-art borderless
 * alt-arts, etc.), which are full-bleed art but not always flagged `full_art`.
 */
export function isFullArt(card: ScryfallCard | null): boolean {
  if (!card) return false;
  return card.full_art === true || card.border_color === 'borderless';
}

/** True when this printing has an extended-art frame (e.g. Ravnica Allegiance guild-kit alt-arts). */
export function isExtendedArt(card: ScryfallCard | null): boolean {
  if (!card) return false;
  return card.frame_effects?.includes('extendedart') ?? false;
}

/** Picks the unit price for the printing/finish recorded in the collection row. */
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
