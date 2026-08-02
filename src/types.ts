/** The collection export formats this package knows how to parse. */
export type CollectionFormat = 'manabox' | 'archidekt' | 'moxfield' | 'deckbox' | 'helvault';

/**
 * A single row from a collection export, normalized to camelCase across
 * all supported formats (see `CollectionFormat`). Not every format
 * supplies every field — e.g. Deckbox and Helvault's free tier omit
 * rarity, and Deckbox usually has no Scryfall ID at all — so fields the
 * source export doesn't provide are left as their empty default and
 * backfilled from the matched Scryfall card where possible (see
 * `buildEnrichedCards` in collection.ts).
 */
export interface CollectionRow {
  source: CollectionFormat;
  folder: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  /** "normal" | "foil" | "etched" (kept lowercase, ManaBox's own vocabulary) */
  foil: string;
  rarity: string;
  quantity: number;
  scryfallId: string;
  purchasePrice: number | null;
  misc: string;
  condition: string;
  language: string;
  purchasePriceCurrency: string;
  /**
   * Stable key used to match this row to Scryfall card data — derived from
   * whichever identifying fields the row has (Scryfall ID, set + collector
   * number, or name) by `identifyRow()` in card-identity.ts. Rows are
   * useless for lookups until this is set, so parsers never populate it
   * directly; collection-data.ts fills it in right after parsing.
   */
  matchKey: string;
}

/** The subset of the Scryfall card object this app actually uses. */
export interface ScryfallCard {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  colors?: string[];
  color_identity?: string[];
  type_line?: string;
  mana_cost?: string;
  cmc?: number;
  layout?: string;
  prices: {
    usd: string | null;
    usd_foil: string | null;
    usd_etched: string | null;
    eur: string | null;
    eur_foil: string | null;
  };
  image_uris?: {
    small: string;
    normal: string;
    large: string;
  };
  card_faces?: Array<{
    name: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
    };
  }>;
  scryfall_uri: string;
}

/** A collection row merged with its live Scryfall card data. */
export interface EnrichedCard {
  row: CollectionRow;
  card: ScryfallCard | null;
  imageUrl: string | null;
  /** Unit price in USD for this row's foil/nonfoil printing, if known. */
  unitPrice: number | null;
  /** unitPrice * quantity, if unitPrice is known. */
  lineValue: number | null;
}

export type SortKey =
  | 'name-asc'
  | 'name-desc'
  | 'price-desc'
  | 'price-asc'
  | 'set'
  | 'quantity-desc'
  | 'rarity';
