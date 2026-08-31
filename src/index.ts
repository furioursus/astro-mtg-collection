// Integration only — see collection-exports.ts (published as the 'astro-mtg-collection/collection'
// subpath) for loadCollection/queryCollection/summarize/uniqueSorted/etc. They used to live here
// too, but that made this file's import chain (this -> integration.js -> virtual-images.js ->
// 'vite') part of *any* consumer's bundle the moment they imported loadCollection from the main
// entry, not just astro.config.mjs's — which broke a static build downstream (see
// collection-exports.ts's own comment). Type-only exports are safe to keep here regardless: they
// carry no runtime import, so they can't drag that chain in.
export { default } from './integration.js';
export type { MtgCollectionOptions } from './config.js';
export type {
  CollectionFormat,
  CollectionRow,
  ScryfallCard,
  EnrichedCard,
  SortKey,
} from './types.js';
export type { CollectionSummary } from './collection.js';
