export { default } from './integration.js';
export type { MtgCollectionOptions } from './config.js';

export { loadCollection, type LoadedCollection } from './collection-data.js';
export { queryCollection, type CollectionWhere, type QueryOptions, type SortField, type SortOrder } from './query.js';
export { summarize, uniqueSorted, RARITY_ORDER, type CollectionSummary } from './collection.js';

export type { CollectionFormat, CollectionRow, ScryfallCard, EnrichedCard, SortKey } from './types.js';
