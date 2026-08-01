/** A single row from a ManaBox CSV export, normalized to camelCase. */
export interface ManaBoxRow {
  folder: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  /** "normal" | "foil" | "etched" (ManaBox's own values, kept as-is) */
  foil: string;
  rarity: string;
  quantity: number;
  manaboxId: string;
  scryfallId: string;
  purchasePrice: number | null;
  misc: string;
  condition: string;
  language: string;
  purchasePriceCurrency: string;
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

/** A ManaBox row merged with its live Scryfall card data. */
export interface EnrichedCard {
  row: ManaBoxRow;
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
