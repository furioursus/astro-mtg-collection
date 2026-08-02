import type { CollectionRow } from './types.js';
import { CollectionParseError, hasHeaders, mapHeaders, parseCsv } from './csv-format.js';

const HEADER_MAP: Record<string, keyof CollectionRow> = {
  folder: 'folder',
  name: 'name',
  'set code': 'setCode',
  'set name': 'setName',
  'collector number': 'collectorNumber',
  foil: 'foil',
  rarity: 'rarity',
  quantity: 'quantity',
  'scryfall id': 'scryfallId',
  'purchase price': 'purchasePrice',
  misc: 'misc',
  condition: 'condition',
  language: 'language',
  'purchase price currency': 'purchasePriceCurrency',
};

export interface ParseResult {
  rows: CollectionRow[];
  /** Row indices (1-based, matching the CSV file) that were skipped. */
  skipped: number[];
}

/** ManaBox is the only one of these formats with a "ManaBox ID" column — a reliable, distinctive signal for auto-detection. */
export function detect(fields: string[]): boolean {
  return hasHeaders(fields, ['manabox id']);
}

/**
 * Parses a ManaBox CSV export into normalized rows. Rows missing a
 * Scryfall ID are skipped (they can't be looked up) rather than
 * failing the whole import, since ManaBox occasionally exports
 * custom/unmatched cards without one.
 */
export function parse(csvText: string): ParseResult {
  const { fields, data } = parseCsv(csvText);
  const mappedFields = mapHeaders(fields, HEADER_MAP);

  if (mappedFields.length === 0 || !mappedFields.some(([, m]) => m === 'scryfallId')) {
    throw new CollectionParseError(
      'This does not look like a ManaBox export CSV (missing expected columns like "Name" and "Scryfall ID").'
    );
  }

  const rows: CollectionRow[] = [];
  const skipped: number[] = [];

  data.forEach((raw, index) => {
    const row: Partial<CollectionRow> = {};
    for (const [csvHeader, mapped] of mappedFields) {
      const value = raw[csvHeader]?.trim() ?? '';
      if (mapped === 'quantity') {
        row.quantity = value ? parseInt(value, 10) : 1;
      } else if (mapped === 'purchasePrice') {
        const num = parseFloat(value);
        row.purchasePrice = Number.isFinite(num) ? num : null;
      } else {
        (row as Record<string, string>)[mapped] = value;
      }
    }

    if (!row.scryfallId || !row.name) {
      skipped.push(index + 2); // +1 for header row, +1 for 1-based indexing
      return;
    }

    rows.push({
      source: 'manabox',
      folder: row.folder ?? '',
      name: row.name,
      setCode: row.setCode ?? '',
      setName: row.setName ?? '',
      collectorNumber: row.collectorNumber ?? '',
      foil: row.foil?.toLowerCase() || 'normal',
      rarity: row.rarity ?? '',
      quantity: row.quantity ?? 1,
      scryfallId: row.scryfallId,
      purchasePrice: row.purchasePrice ?? null,
      misc: row.misc ?? '',
      condition: row.condition ?? '',
      language: row.language ?? 'en',
      purchasePriceCurrency: row.purchasePriceCurrency ?? 'USD',
      matchKey: '',
    });
  });

  if (rows.length === 0) {
    throw new CollectionParseError('No usable card rows were found in this file.');
  }

  return { rows, skipped };
}
