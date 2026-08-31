import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { configure, getConfig, type MtgCollectionOptions } from './config.js';
import { mtgCollectionImagesPlugin } from './virtual-images.js';
import { cacheCardImages } from './cache-images.js';

/**
 * Astro integration that loads a ManaBox CSV export, enriches it with live
 * Scryfall data, and caches card images locally so they're usable with
 * astro:assets' <Image>/<Picture>. Register it in astro.config.mjs:
 *
 *   import mtgCollection from 'astro-mtg-collection';
 *   export default defineConfig({ integrations: [mtgCollection()] });
 *
 * Then use loadCollection()/queryCollection() from 'astro-mtg-collection'
 * in your own pages/components to render the data however you like.
 */
export default function mtgCollection(options: MtgCollectionOptions = {}): AstroIntegration {
  return {
    name: 'astro-mtg-collection',
    hooks: {
      'astro:config:setup': ({ config, updateConfig }) => {
        const root = fileURLToPath(config.root);
        configure(root, options);

        updateConfig({
          vite: {
            plugins: [mtgCollectionImagesPlugin()],
          },
        });
      },
      'astro:build:start': async ({ logger }) => {
        if (!getConfig().cacheImages) return;
        await cacheCardImages((message) => logger.info(message));
      },
      'astro:server:setup': async ({ logger }) => {
        if (!getConfig().cacheImages) return;
        await cacheCardImages((message) => logger.info(message));
      },
    },
  };
}
