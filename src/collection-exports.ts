// Public data-loading API — deliberately its own entry point, separate from index.ts (the
// integration's default export). index.ts's import chain reaches integration.ts ->
// virtual-images.ts, which imports from 'vite' to register its Vite plugin; that's fine when
// index.ts is only ever imported from astro.config.mjs (Node, never bundled), but a consumer
// importing loadCollection/etc. from the *main* entry pulls that same chain into their own
// component's build — and at least one Astro/Vite combination inlines a broken copy of Vite's
// own internals into the resulting page bundle when that happens (see the consuming site's own
// notes if this ever regresses). Import from 'astro-mtg-collection/collection' instead, which
// never touches integration.ts at all.
export { loadCollection, type LoadedCollection } from './collection-data.js';
export {
  queryCollection,
  type CollectionWhere,
  type QueryOptions,
  type SortField,
  type SortOrder,
} from './query.js';
export { summarize, uniqueSorted, RARITY_ORDER, type CollectionSummary } from './collection.js';
export type { CollectionFormat, CollectionRow, ScryfallCard, EnrichedCard, SortKey } from './types.js';
