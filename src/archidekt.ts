import type { CollectionRow } from './types.js';
import { CollectionParseError, hasHeaders, headerLookup, parseCsv } from './csv-format.js';

export interface ParseResult {
  rows: CollectionRow[];
  skipped: number[];
}

/**
 * Archidekt's own export ("foil_quantity" as a separate column from
 * "quantity") is unique among these formats — everyone else uses one row
 * per owned copy/finish, but Archidekt tracks nonfoil and foil counts of
 * the same printing on a single row.
 */
export function detect(fields: string[]): boolean {
  return hasHeaders(fields, ['foil quantity', 'quantity']);
}

/**
 * Parses an Archidekt collection CSV export. Rarity, condition, and
 * purchase price aren't part of Archidekt's export — rarity is backfilled
 * from the matched Scryfall card (see buildEnrichedCards in collection.ts);
 * condition/price are simply left unknown.
 */
export function parse(csvText: string): ParseResult {
  const { fields, data } = parseCsv(csvText);
  const lookup = headerLookup(fields);

  const scryfallCol = lookup('scryfall uuid') ?? lookup('scryfall id');
  const setCodeCol = lookup('set code');
  const setNameCol = lookup('set name');
  const collectorNumberCol = lookup('collector number');
  const nameCol = lookup('card name') ?? lookup('english card name') ?? lookup('name');
  const languageCol = lookup('lang') ?? lookup('language');
  const quantityCol = lookup('quantity');
  const foilQuantityCol = lookup('foil quantity');

  if (!nameCol || (!quantityCol && !foilQuantityCol)) {
    throw new CollectionParseError(
      'This does not look like an Archidekt collection export CSV (missing expected columns like "Card Name" and "Quantity"/"Foil Quantity").'
    );
  }

  const rows: CollectionRow[] = [];
  const skipped: number[] = [];

  data.forEach((raw, index) => {
    const name = nameCol ? raw[nameCol]?.trim() : '';
    if (!name) {
      skipped.push(index + 2);
      return;
    }

    const base = {
      source: 'archidekt' as const,
      folder: '',
      name,
      setCode: setCodeCol ? (raw[setCodeCol]?.trim() ?? '') : '',
      setName: setNameCol ? (raw[setNameCol]?.trim() ?? '') : '',
      collectorNumber: collectorNumberCol ? (raw[collectorNumberCol]?.trim() ?? '') : '',
      rarity: '',
      scryfallId: scryfallCol ? (raw[scryfallCol]?.trim() ?? '') : '',
      purchasePrice: null,
      misc: '',
      condition: '',
      language: (languageCol ? raw[languageCol]?.trim() : '') || 'en',
      purchasePriceCurrency: 'USD',
      matchKey: '',
    };

    const quantity = quantityCol ? parseInt(raw[quantityCol]?.trim() ?? '', 10) || 0 : 0;
    const foilQuantity = foilQuantityCol ? parseInt(raw[foilQuantityCol]?.trim() ?? '', 10) || 0 : 0;

    if (quantity > 0) {
      rows.push({ ...base, foil: 'normal', quantity });
    }
    if (foilQuantity > 0) {
      rows.push({ ...base, foil: 'foil', quantity: foilQuantity });
    }
    if (quantity <= 0 && foilQuantity <= 0) {
      skipped.push(index + 2);
    }
  });

  if (rows.length === 0) {
    throw new CollectionParseError('No usable card rows were found in this file.');
  }

  return { rows, skipped };
}
