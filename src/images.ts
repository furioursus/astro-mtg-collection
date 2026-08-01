// Separate entry point (import from 'astro-mtg-collection/images') from
// the main package export. This one transitively imports the
// virtual:mtg-collection/images module, which only Vite can resolve — fine
// from .astro component frontmatter (processed by Vite/Astro), but
// astro.config.mjs itself is loaded by plain Node before Vite starts, so
// the integration's own entry point (the main 'astro-mtg-collection'
// export) must never reach this code.
export { getLocalCardImage } from './card-images.js';
