import Papa from 'papaparse';
import type { ManaBoxRow } from './types.js';

/**
 * ManaBox's CSV export headers, matched case-insensitively since the app
 * has changed capitalization/spacing across versions.
 */
const HEADER_MAP: Record<string, keyof ManaBoxRow> = {
  folder: 'folder',
  name: 'name',
  'set code': 'setCode',
  'set name': 'setName',
  'collector number': 'collectorNumber',
  foil: 'foil',
  rarity: 'rarity',
  quantity: 'quantity',
  'manabox id': 'manaboxId',
  'scryfall id': 'scryfallId',
  'purchase price': 'purchasePrice',
  misc: 'misc',
  condition: 'condition',
  language: 'language',
  'purchase price currency': 'purchasePriceCurrency',
};

function normalizeHeader(header: string): keyof ManaBoxRow | null {
  const key = header.trim().toLowerCase();
  return HEADER_MAP[key] ?? null;
}

export class ManaBoxParseError extends Error {}

export interface ParseResult {
  rows: ManaBoxRow[];
  /** Row indices (1-based, matching the CSV file) that were skipped. */
  skipped: number[];
}

/**
 * Parses a ManaBox CSV export into normalized rows. Rows missing a
 * Scryfall ID are skipped (they can't be looked up) rather than
 * failing the whole import, since ManaBox occasionally exports
 * custom/unmatched cards without one.
 */
export function parseManaBoxCsv(csvText: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header,
  });

  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.find((e) => e.type !== 'FieldMismatch');
    if (fatal) {
      throw new ManaBoxParseError(`Failed to parse CSV: ${fatal.message}`);
    }
  }

  const fields = parsed.meta.fields ?? [];
  const mappedFields = fields
    .map((f) => [f, normalizeHeader(f)] as const)
    .filter(([, mapped]) => mapped !== null);

  if (mappedFields.length === 0 || !mappedFields.some(([, m]) => m === 'scryfallId')) {
    throw new ManaBoxParseError(
      'This does not look like a ManaBox export CSV (missing expected columns like "Name" and "Scryfall ID").'
    );
  }

  const rows: ManaBoxRow[] = [];
  const skipped: number[] = [];

  parsed.data.forEach((raw, index) => {
    const row: Partial<ManaBoxRow> = {};
    for (const [csvHeader, mapped] of mappedFields) {
      if (!mapped) continue;
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
      folder: row.folder ?? '',
      name: row.name,
      setCode: row.setCode ?? '',
      setName: row.setName ?? '',
      collectorNumber: row.collectorNumber ?? '',
      foil: row.foil?.toLowerCase() || 'normal',
      rarity: row.rarity ?? '',
      quantity: row.quantity ?? 1,
      manaboxId: row.manaboxId ?? '',
      scryfallId: row.scryfallId,
      purchasePrice: row.purchasePrice ?? null,
      misc: row.misc ?? '',
      condition: row.condition ?? '',
      language: row.language ?? 'en',
      purchasePriceCurrency: row.purchasePriceCurrency ?? 'USD',
    });
  });

  if (rows.length === 0) {
    throw new ManaBoxParseError('No usable card rows were found in this file.');
  }

  return { rows, skipped };
}
