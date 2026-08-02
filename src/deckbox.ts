import type { CollectionRow } from './types.js';
import { CollectionParseError, hasAnyHeader, hasHeaders, headerLookup, parseCsv } from './csv-format.js';

export interface ParseResult {
  rows: CollectionRow[];
  skipped: number[];
}

const DECKBOX_ONLY_HEADERS = ['my price', 'card number', 'artist proof', 'signed', 'misprint', 'textless'];

/**
 * Deckbox's "Count"/"Name" shape overlaps with Moxfield, so this checks
 * for Deckbox's own distinctive columns (Card Number rather than
 * Collector Number, plus its collector-value flags) — see
 * collection-data.ts for why this must run before moxfield.detect().
 */
export function detect(fields: string[]): boolean {
  return hasHeaders(fields, ['count', 'name']) && hasAnyHeader(fields, DECKBOX_ONLY_HEADERS);
}

/**
 * Parses a Deckbox collection CSV export. Deckbox exports almost never
 * include a Scryfall ID and have no set-code column (only the full
 * "Edition" name), so most rows end up matched to Scryfall by name alone
 * — the best identification a Deckbox export can offer. An optional
 * "Scryfall ID" column (added by some Deckbox export configurations) is
 * used when present.
 */
export function parse(csvText: string): ParseResult {
  const { fields, data } = parseCsv(csvText);
  const lookup = headerLookup(fields);

  const countCol = lookup('count');
  const nameCol = lookup('name');
  const editionCol = lookup('edition');
  const cardNumberCol = lookup('card number');
  const conditionCol = lookup('condition');
  const languageCol = lookup('language');
  const foilCol = lookup('foil');
  const priceCol = lookup('my price');
  const scryfallIdCol = lookup('scryfall id');

  if (!countCol || !nameCol) {
    throw new CollectionParseError(
      'This does not look like a Deckbox collection export CSV (missing expected columns like "Count" and "Name").'
    );
  }

  const rows: CollectionRow[] = [];
  const skipped: number[] = [];

  data.forEach((raw, index) => {
    const name = raw[nameCol]?.trim();
    const quantity = parseInt(raw[countCol]?.trim() ?? '', 10);

    if (!name || !Number.isFinite(quantity) || quantity <= 0) {
      skipped.push(index + 2);
      return;
    }

    const foilRaw = (foilCol ? raw[foilCol]?.trim().toLowerCase() : '') || '';
    const foil = ['foil', 'yes', 'true', '1'].includes(foilRaw) ? 'foil' : 'normal';

    const priceRaw = priceCol ? raw[priceCol]?.trim() : '';
    const purchasePrice = priceRaw ? parseFloat(priceRaw) : NaN;

    rows.push({
      source: 'deckbox',
      folder: '',
      name,
      setCode: '',
      setName: editionCol ? (raw[editionCol]?.trim() ?? '') : '',
      collectorNumber: cardNumberCol ? (raw[cardNumberCol]?.trim() ?? '') : '',
      foil,
      rarity: '',
      quantity,
      scryfallId: scryfallIdCol ? (raw[scryfallIdCol]?.trim() ?? '') : '',
      purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : null,
      misc: '',
      condition: conditionCol ? (raw[conditionCol]?.trim() ?? '') : '',
      language: (languageCol ? raw[languageCol]?.trim() : '') || 'en',
      purchasePriceCurrency: 'USD',
      matchKey: '',
    });
  });

  if (rows.length === 0) {
    throw new CollectionParseError('No usable card rows were found in this file.');
  }

  return { rows, skipped };
}
