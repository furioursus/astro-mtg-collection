import type { CollectionRow } from './types.js';
import { CollectionParseError, hasAnyHeader, hasHeaders, headerLookup, parseCsv } from './csv-format.js';

export interface ParseResult {
  rows: CollectionRow[];
  skipped: number[];
}

/**
 * Moxfield's "Count"/"Name" shape overlaps with Deckbox, so this must be
 * checked after deckbox.detect() rules out Deckbox's own unique columns
 * (Card Number, My Price, Signed, etc.) — see collection-data.ts for the
 * detection order.
 */
export function detect(fields: string[]): boolean {
  return (
    hasHeaders(fields, ['count', 'name']) &&
    hasAnyHeader(fields, ['edition', 'set code', 'collector number', 'tradelist count'])
  );
}

/**
 * Parses a Moxfield collection/inventory CSV export. Some Moxfield export
 * variants use "Edition" (a set name, not a code) instead of "Set Code" —
 * when only "Edition" is present, setCode is left blank rather than
 * populated with a non-code value, so lookups degrade to name-based
 * matching instead of silently mismatching a set+collector-number key.
 */
export function parse(csvText: string): ParseResult {
  const { fields, data } = parseCsv(csvText);
  const lookup = headerLookup(fields);

  const countCol = lookup('count');
  const nameCol = lookup('name');
  const setCodeCol = lookup('set code');
  const editionCol = lookup('edition');
  const collectorNumberCol = lookup('collector number');
  const conditionCol = lookup('condition');
  const languageCol = lookup('language');
  const foilCol = lookup('foil');
  const tagsCol = lookup('tags') ?? lookup('tag');
  const purchasePriceCol = lookup('purchase price');
  const scryfallIdCol = lookup('scryfall id');

  if (!countCol || !nameCol) {
    throw new CollectionParseError(
      'This does not look like a Moxfield collection export CSV (missing expected columns like "Count" and "Name").'
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
    const foil = foilRaw.includes('etched') ? 'etched' : foilRaw.includes('foil') ? 'foil' : 'normal';

    const purchasePriceRaw = purchasePriceCol ? raw[purchasePriceCol]?.trim() : '';
    const purchasePrice = purchasePriceRaw ? parseFloat(purchasePriceRaw) : NaN;

    rows.push({
      source: 'moxfield',
      folder: '',
      name,
      setCode: setCodeCol ? (raw[setCodeCol]?.trim() ?? '') : '',
      setName: editionCol ? (raw[editionCol]?.trim() ?? '') : '',
      collectorNumber: collectorNumberCol ? (raw[collectorNumberCol]?.trim() ?? '') : '',
      foil,
      rarity: '',
      quantity,
      scryfallId: scryfallIdCol ? (raw[scryfallIdCol]?.trim() ?? '') : '',
      purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : null,
      misc: tagsCol ? (raw[tagsCol]?.trim() ?? '') : '',
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
