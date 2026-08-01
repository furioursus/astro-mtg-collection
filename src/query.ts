import type { EnrichedCard } from './types.js';
import { RARITY_ORDER } from './collection.js';

/**
 * Filter conditions for queryCollection(). Every field is optional and
 * conditions combine with AND — pass as many or as few as you need.
 * String fields accept a single value or an array of allowed values (OR
 * within that field). `name` is a case-insensitive substring match;
 * everything else is an exact, case-insensitive match.
 */
export interface CollectionWhere {
  name?: string;
  setCode?: string | string[];
  setName?: string | string[];
  rarity?: string | string[];
  /** WUBRG color identity letter, or 'C' for colorless. */
  color?: string;
  foil?: string | string[];
  condition?: string | string[];
  language?: string | string[];
  minPrice?: number;
  maxPrice?: number;
  minQuantity?: number;
  maxQuantity?: number;
}

export type SortField = 'name' | 'price' | 'quantity' | 'rarity' | 'set' | 'setName' | 'condition' | 'foil';
export type SortOrder = 'asc' | 'desc';

export interface QueryOptions {
  where?: CollectionWhere;
  sortBy?: SortField;
  order?: SortOrder;
  limit?: number;
}

function matchesOneOrMany(value: string, filter: string | string[] | undefined): boolean {
  if (filter === undefined) return true;
  const allowed = Array.isArray(filter) ? filter : [filter];
  return allowed.some((f) => f.toLowerCase() === value.toLowerCase());
}

function matchesWhere(entry: EnrichedCard, where: CollectionWhere): boolean {
  const { row, card, unitPrice } = entry;

  if (where.name && !row.name.toLowerCase().includes(where.name.toLowerCase())) return false;
  if (!matchesOneOrMany(row.setCode, where.setCode)) return false;
  if (!matchesOneOrMany(row.setName, where.setName)) return false;
  if (!matchesOneOrMany(row.rarity, where.rarity)) return false;
  if (!matchesOneOrMany(row.foil, where.foil)) return false;
  if (!matchesOneOrMany(row.condition, where.condition)) return false;
  if (!matchesOneOrMany(row.language, where.language)) return false;

  if (where.color) {
    const colors = card?.color_identity ?? [];
    if (where.color === 'C' ? colors.length > 0 : !colors.includes(where.color)) return false;
  }

  if (where.minPrice !== undefined && (unitPrice ?? -Infinity) < where.minPrice) return false;
  if (where.maxPrice !== undefined && (unitPrice ?? Infinity) > where.maxPrice) return false;
  if (where.minQuantity !== undefined && row.quantity < where.minQuantity) return false;
  if (where.maxQuantity !== undefined && row.quantity > where.maxQuantity) return false;

  return true;
}

/**
 * Ascending comparator for a single field. Cards with an unknown price
 * sort first ascending (last descending, since the whole result is
 * reversed for 'desc') rather than being dropped.
 */
function compareBy(a: EnrichedCard, b: EnrichedCard, field: SortField): number {
  switch (field) {
    case 'name':
      return a.row.name.localeCompare(b.row.name);
    case 'price':
      return (a.unitPrice ?? -Infinity) - (b.unitPrice ?? -Infinity);
    case 'quantity':
      return a.row.quantity - b.row.quantity;
    case 'rarity':
      return (RARITY_ORDER[a.row.rarity.toLowerCase()] ?? -1) - (RARITY_ORDER[b.row.rarity.toLowerCase()] ?? -1);
    case 'set':
      return (
        a.row.setCode.localeCompare(b.row.setCode) ||
        a.row.collectorNumber.localeCompare(b.row.collectorNumber, undefined, { numeric: true })
      );
    case 'setName':
      return a.row.setName.localeCompare(b.row.setName);
    case 'condition':
      return a.row.condition.localeCompare(b.row.condition);
    case 'foil':
      return a.row.foil.localeCompare(b.row.foil);
  }
}

/**
 * Filters, sorts, and limits a collection in one call — the query engine
 * behind <CollectionQuery>. Usable directly too, e.g. in a page's
 * frontmatter, for anything that needs the matched cards rather than
 * pre-rendered markup.
 */
export function queryCollection(cards: EnrichedCard[], options: QueryOptions = {}): EnrichedCard[] {
  const { where, sortBy, order = 'asc', limit } = options;

  let results = where ? cards.filter((c) => matchesWhere(c, where)) : cards.slice();

  if (sortBy) {
    results.sort((a, b) => compareBy(a, b, sortBy));
    if (order === 'desc') results.reverse();
  }

  if (limit !== undefined) {
    results = results.slice(0, limit);
  }

  return results;
}
