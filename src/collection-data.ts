import fs from 'node:fs';
import { CollectionParseError, peekCsvHeaders } from './csv-format.js';
import { identifyRow } from './card-identity.js';
import { PARSERS, getParser } from './formats.js';
import { fetchCollection } from './scryfall.js';
import { buildEnrichedCards, sortCards } from './collection.js';
import { getConfig } from './config.js';
import type { EnrichedCard } from './types.js';

// Build-time only (imported from .astro frontmatter, which runs in Node —
// never shipped to the browser). Loads the collection export and enriches
// it with Scryfall data once per build.

export interface LoadedCollection {
  /** All cards, pre-sorted by name — the default view before client-side re-sorting. */
  cards: EnrichedCard[];
  /** Card rows skipped during parsing because they couldn't be identified. */
  skippedRows: number;
  /** Rows from the export that Scryfall didn't recognize. */
  notFoundIds: string[];
  /** Set when no collection file was found — the page renders a setup message instead of failing the build. */
  missingFile: boolean;
  /** Set when the file exists but couldn't be parsed as any known export format. */
  error: string | null;
}

/** Picks the configured parser, or sniffs the CSV's header row to find one when `format` is 'auto'. */
function resolveParser(csvText: string, format: ReturnType<typeof getConfig>['format']) {
  if (format !== 'auto') return getParser(format);

  const fields = peekCsvHeaders(csvText);
  const match = PARSERS.find((p) => p.detect(fields));
  if (!match) {
    throw new CollectionParseError(
      `Couldn't determine the collection export format from this CSV's headers. Supported formats: ${PARSERS.map((p) => p.format).join(', ')}. Set the \`format\` option explicitly if this is one of them.`
    );
  }
  return match;
}

async function loadCollectionUncached(): Promise<LoadedCollection> {
  const { csvPath, format } = getConfig();

  let csvText: string;
  try {
    csvText = fs.readFileSync(csvPath, 'utf-8');
  } catch {
    return { cards: [], skippedRows: 0, notFoundIds: [], missingFile: true, error: null };
  }

  try {
    const parser = resolveParser(csvText, format);
    const { rows: parsedRows, skipped } = parser.parse(csvText);

    // Each row's matchKey/lookup identifier are derived from the same
    // fields, computed once here and deduped by matchKey before hitting
    // Scryfall — see card-identity.ts for why a row is identified this way.
    const identityByKey = new Map<string, ReturnType<typeof identifyRow>>();
    const rows = parsedRows.map((row) => {
      const identity = identifyRow(row);
      identityByKey.set(identity.matchKey, identity);
      return { ...row, matchKey: identity.matchKey };
    });

    const { cards: scryfallCards, notFound } = await fetchCollection(Array.from(identityByKey.values()));
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
      err instanceof CollectionParseError
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
