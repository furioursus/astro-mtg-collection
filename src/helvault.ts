import type { CollectionRow } from './types.js';
import { CollectionParseError, hasHeaders, headerLookup, parseCsv } from './csv-format.js';

export interface ParseResult {
  rows: CollectionRow[];
  skipped: number[];
}

/**
 * Helvault is the only one of these formats with an "extras" column
 * (storing foil status) alongside a bare "quantity" — a distinctive
 * combination since every other format either has no such column or
 * spells foil status differently.
 */
export function detect(fields: string[]): boolean {
  return hasHeaders(fields, ['extras', 'name', 'quantity']);
}

/**
 * Parses a Helvault CSV export. The free tier only exports extras/name/
 * scryfall_id/quantity — set code, set name, collector number, and rarity
 * are all left blank and backfilled from the matched Scryfall card (see
 * buildEnrichedCards in collection.ts). The Pro tier's additional columns
 * (collector_number, language, set_code, set_name) are used when present.
 */
export function parse(csvText: string): ParseResult {
  const { fields, data } = parseCsv(csvText);
  const lookup = headerLookup(fields);

  const extrasCol = lookup('extras');
  const nameCol = lookup('name');
  const scryfallIdCol = lookup('scryfall id');
  const quantityCol = lookup('quantity');
  const collectorNumberCol = lookup('collector number');
  const languageCol = lookup('language');
  const setCodeCol = lookup('set code');
  const setNameCol = lookup('set name');

  if (!nameCol || !quantityCol) {
    throw new CollectionParseError(
      'This does not look like a Helvault CSV export (missing expected columns like "name" and "quantity").'
    );
  }

  const rows: CollectionRow[] = [];
  const skipped: number[] = [];

  data.forEach((raw, index) => {
    const name = raw[nameCol]?.trim();
    const quantity = parseInt(raw[quantityCol]?.trim() ?? '', 10);

    if (!name || !Number.isFinite(quantity) || quantity <= 0) {
      skipped.push(index + 2);
      return;
    }

    const extrasRaw = (extrasCol ? raw[extrasCol]?.trim().toLowerCase() : '') || '';
    const foil = extrasRaw.includes('etched') ? 'etched' : extrasRaw.includes('foil') ? 'foil' : 'normal';

    rows.push({
      source: 'helvault',
      folder: '',
      name,
      setCode: setCodeCol ? (raw[setCodeCol]?.trim() ?? '') : '',
      setName: setNameCol ? (raw[setNameCol]?.trim() ?? '') : '',
      collectorNumber: collectorNumberCol ? (raw[collectorNumberCol]?.trim() ?? '') : '',
      foil,
      rarity: '',
      quantity,
      scryfallId: scryfallIdCol ? (raw[scryfallIdCol]?.trim() ?? '') : '',
      purchasePrice: null,
      misc: '',
      condition: '',
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
