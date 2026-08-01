import fs from 'node:fs';
import { parseManaBoxCsv, ManaBoxParseError } from './manabox.js';
import { fetchCollection } from './scryfall.js';
import { buildEnrichedCards, sortCards } from './collection.js';
import { getConfig } from './config.js';
import type { EnrichedCard } from './types.js';

// Build-time only (imported from .astro frontmatter, which runs in Node —
// never shipped to the browser). Loads the ManaBox export and enriches it
// with Scryfall data once per build.

export interface LoadedCollection {
  /** All cards, pre-sorted by name — the default view before client-side re-sorting. */
  cards: EnrichedCard[];
  /** Card rows skipped during parsing because they had no Scryfall ID. */
  skippedRows: number;
  /** Scryfall IDs from the export that Scryfall didn't recognize. */
  notFoundIds: string[];
  /** Set when no collection file was found — the page renders a setup message instead of failing the build. */
  missingFile: boolean;
  /** Set when the file exists but couldn't be parsed as a ManaBox export. */
  error: string | null;
}

async function loadCollectionUncached(): Promise<LoadedCollection> {
  const { csvPath } = getConfig();

  let csvText: string;
  try {
    csvText = fs.readFileSync(csvPath, 'utf-8');
  } catch {
    return { cards: [], skippedRows: 0, notFoundIds: [], missingFile: true, error: null };
  }

  try {
    const { rows, skipped } = parseManaBoxCsv(csvText);
    const { cards: scryfallCards, notFound } = await fetchCollection(rows.map((r) => r.scryfallId));
    const enriched = sortCards(buildEnrichedCards(rows, scryfallCards), 'name-asc');

    return {
      cards: enriched,
      skippedRows: skipped.length,
      notFoundIds: notFound,
      missingFile: false,
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof ManaBoxParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Failed to load the collection file.';
    return { cards: [], skippedRows: 0, notFoundIds: [], missingFile: false, error: message };
  }
}

let collectionPromise: Promise<LoadedCollection> | null = null;

/**
 * Loads and enriches the collection once per build, no matter how many
 * pages or components ask for it — later callers just await the same
 * in-flight/resolved promise instead of re-reading the CSV or re-hitting
 * Scryfall for already-fetched IDs.
 */
export function loadCollection(): Promise<LoadedCollection> {
  if (!collectionPromise) {
    collectionPromise = loadCollectionUncached();
  }
  return collectionPromise;
}
