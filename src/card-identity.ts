import type { ScryfallCard } from './types.js';

// Shared between row-parsing (collection-data.ts) and Scryfall lookups
// (scryfall.ts) so both sides agree on the same key format. Not every
// export format includes a Scryfall ID (Deckbox rarely does; Helvault's
// free tier omits set/collector number entirely), so a row is identified
// by the best available signal, in order of precision: Scryfall ID, then
// set + collector number, then name (optionally narrowed by set). Name-only
// matching can't disambiguate between reprints of the same card in the
// same set-less scenario, but it's the best any format without stronger
// identifiers can offer.

/** The identifier shapes Scryfall's /cards/collection endpoint accepts. */
export type CollectionIdentifier = { id: string } | { set: string; collector_number: string } | { name: string; set?: string };

export interface RowIdentity {
  matchKey: string;
  lookup: CollectionIdentifier;
}

export interface IdentifiableRow {
  scryfallId?: string;
  setCode?: string;
  collectorNumber?: string;
  name: string;
}

export function identifyRow(row: IdentifiableRow): RowIdentity {
  const id = row.scryfallId?.trim();
  if (id) {
    return { matchKey: `id:${id.toLowerCase()}`, lookup: { id } };
  }

  const set = row.setCode?.trim().toLowerCase();
  const number = row.collectorNumber?.trim().toLowerCase();
  if (set && number) {
    return { matchKey: `set:${set}:${number}`, lookup: { set, collector_number: number } };
  }

  const name = row.name.trim().toLowerCase();
  if (set) {
    return { matchKey: `name:${name}:${set}`, lookup: { name: row.name.trim(), set } };
  }
  return { matchKey: `name:${name}`, lookup: { name: row.name.trim() } };
}

/**
 * Every matchKey form a given Scryfall card could satisfy. Checked against
 * whatever rows are still unmatched — used both while streaming the
 * bulk-data file and while reverse-matching responses from the live
 * /cards/collection endpoint, so a card is recognized no matter which
 * identifier shape the original row used.
 */
export function candidateKeysForCard(card: ScryfallCard): string[] {
  const keys = [`id:${card.id.toLowerCase()}`];

  const set = card.set?.toLowerCase();
  if (set && card.collector_number) {
    keys.push(`set:${set}:${card.collector_number.toLowerCase()}`);
  }

  const names = new Set<string>([card.name.toLowerCase()]);
  for (const face of card.card_faces ?? []) {
    if (face.name) names.add(face.name.toLowerCase());
  }
  for (const name of names) {
    keys.push(`name:${name}`);
    if (set) keys.push(`name:${name}:${set}`);
  }

  return keys;
}
