import type { CollectionRow, ScryfallCard, EnrichedCard, SortKey } from './types.js';
import { getCardImage, getUnitPrice } from './scryfall.js';

/**
 * Fills in display fields a row's own export didn't supply (e.g. Deckbox
 * has no rarity or set code; Helvault's free tier omits rarity, set code/
 * name, and collector number) from its matched Scryfall card, so every
 * format looks the same downstream regardless of how little its source
 * export actually contained.
 */
function backfillFromCard(row: CollectionRow, card: ScryfallCard | null): CollectionRow {
  if (!card) return row;
  return {
    ...row,
    name: row.name || card.name,
    setCode: row.setCode || card.set,
    setName: row.setName || card.set_name,
    collectorNumber: row.collectorNumber || card.collector_number,
    rarity: row.rarity || card.rarity,
  };
}

export function buildEnrichedCards(
  rows: CollectionRow[],
  scryfallCards: Map<string, ScryfallCard>
): EnrichedCard[] {
  return rows.map((row) => {
    const card = scryfallCards.get(row.matchKey) ?? null;
    const unitPrice = getUnitPrice(card, row.foil);
    return {
      row: backfillFromCard(row, card),
      card,
      imageUrl: getCardImage(card),
      unitPrice,
      lineValue: unitPrice !== null ? unitPrice * row.quantity : null,
    };
  });
}

export const RARITY_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  special: 3,
  mythic: 4,
  bonus: 5,
};

export function sortCards(cards: EnrichedCard[], sortKey: SortKey): EnrichedCard[] {
  const sorted = [...cards];
  switch (sortKey) {
    case 'name-asc':
      sorted.sort((a, b) => a.row.name.localeCompare(b.row.name));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.row.name.localeCompare(a.row.name));
      break;
    case 'price-desc':
      sorted.sort((a, b) => (b.unitPrice ?? -1) - (a.unitPrice ?? -1));
      break;
    case 'price-asc':
      sorted.sort((a, b) => {
        const av = a.unitPrice ?? Infinity;
        const bv = b.unitPrice ?? Infinity;
        return av - bv;
      });
      break;
    case 'set':
      sorted.sort(
        (a, b) =>
          a.row.setCode.localeCompare(b.row.setCode) ||
          a.row.collectorNumber.localeCompare(b.row.collectorNumber, undefined, { numeric: true })
      );
      break;
    case 'quantity-desc':
      sorted.sort((a, b) => b.row.quantity - a.row.quantity);
      break;
    case 'rarity':
      sorted.sort((a, b) => {
        const av = RARITY_ORDER[a.row.rarity.toLowerCase()] ?? -1;
        const bv = RARITY_ORDER[b.row.rarity.toLowerCase()] ?? -1;
        return bv - av;
      });
      break;
  }
  return sorted;
}

export interface CollectionSummary {
  uniqueCards: number;
  totalQuantity: number;
  totalValue: number;
  knownPriceCount: number;
}

export function summarize(cards: EnrichedCard[]): CollectionSummary {
  let totalQuantity = 0;
  let totalValue = 0;
  let knownPriceCount = 0;

  for (const c of cards) {
    totalQuantity += c.row.quantity;
    if (c.lineValue !== null) {
      totalValue += c.lineValue;
      knownPriceCount += 1;
    }
  }

  return {
    uniqueCards: cards.length,
    totalQuantity,
    totalValue,
    knownPriceCount,
  };
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter(Boolean).sort((a, b) => a.localeCompare(b));
}
