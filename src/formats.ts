import type { CollectionFormat, CollectionRow } from './types.js';
import * as manabox from './manabox.js';
import * as archidekt from './archidekt.js';
import * as moxfield from './moxfield.js';
import * as deckbox from './deckbox.js';
import * as helvault from './helvault.js';

export interface FormatParser {
  format: CollectionFormat;
  detect(fields: string[]): boolean;
  parse(csvText: string): { rows: CollectionRow[]; skipped: number[] };
}

/**
 * Checked in order for 'auto' detection — the first whose detect() matches
 * wins. Order matters: some formats' header shapes overlap (Deckbox and
 * Moxfield both use "Count"/"Name"), so the more distinctive/narrower
 * signatures must come first. See each parser's detect() comment for its
 * specific reasoning.
 */
export const PARSERS: FormatParser[] = [
  { format: 'manabox', detect: manabox.detect, parse: manabox.parse },
  { format: 'archidekt', detect: archidekt.detect, parse: archidekt.parse },
  { format: 'helvault', detect: helvault.detect, parse: helvault.parse },
  { format: 'deckbox', detect: deckbox.detect, parse: deckbox.parse },
  { format: 'moxfield', detect: moxfield.detect, parse: moxfield.parse },
];

export function getParser(format: CollectionFormat): FormatParser {
  const parser = PARSERS.find((p) => p.format === format);
  if (!parser) {
    throw new Error(`Unknown collection format: ${format}`);
  }
  return parser;
}
