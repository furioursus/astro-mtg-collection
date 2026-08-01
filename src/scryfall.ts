import fs from 'node:fs';
import path from 'node:path';
import type { ScryfallCard } from './types.js';
import { getConfig } from './config.js';

// Build-time only: reads the ManaBox export and enriches it with Scryfall
// data while the site is built. Never imported from client-side code, so
// Node builtins (fs) are safe to use here.

const COLLECTION_ENDPOINT = 'https://api.scryfall.com/cards/collection';
const CHUNK_SIZE = 75; // Scryfall's max identifiers per /cards/collection request
const REQUEST_DELAY_MS = 100; // stay well under Scryfall's rate limit guidance

interface CacheEntry {
  card: ScryfallCard;
  fetchedAt: number;
}

type Cache = Record<string, CacheEntry>;

function loadCache(cachePath: string): Cache {
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as Cache;
  } catch {
    return {};
  }
}

function saveCache(cachePath: string, cache: Cache): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchCollectionResult {
  cards: Map<string, ScryfallCard>;
  notFound: string[];
}

/**
 * Looks up Scryfall card data for a set of card IDs at build time,
 * batching requests (max 75 IDs each, per Scryfall's API limits) and
 * caching results on disk (per the resolved config's cacheTtlHours) so
 * repeated local builds don't refetch the whole collection every time.
 */
export async function fetchCollection(scryfallIds: string[]): Promise<FetchCollectionResult> {
  const { scryfallCachePath, cacheTtlHours } = getConfig();
  const cacheTtlMs = cacheTtlHours * 60 * 60 * 1000;

  const uniqueIds = Array.from(new Set(scryfallIds));
  const cache = loadCache(scryfallCachePath);
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

  for (let i = 0; i < idsToFetch.length; i += CHUNK_SIZE) {
    const chunk = idsToFetch.slice(i, i + CHUNK_SIZE);

    const response = await fetch(COLLECTION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'astro-mtg-collection (build script)',
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

    if (i + CHUNK_SIZE < idsToFetch.length) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  if (idsToFetch.length > 0) {
    saveCache(scryfallCachePath, cache);
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
