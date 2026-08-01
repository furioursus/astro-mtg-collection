# astro-mtg-collection

An Astro integration for browsing a Magic: The Gathering collection from a
[ManaBox](https://manabox.app/) CSV export, enriched with live pricing,
images, and card details from the [Scryfall API](https://scryfall.com/docs/api).

It handles the data side — reading your export, fetching Scryfall data,
querying/sorting/filtering, and caching card images locally so they're
usable with Astro's `<Image>`/`<Picture>`. Rendering is up to you: this
package has no UI components, so you build cards/grids/pages however fits
your site.

## Install

Not published to npm — install directly from GitHub:

```bash
npm install github:furioursus/astro-mtg-collection
```

## Setup

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import mtgCollection from 'astro-mtg-collection';

export default defineConfig({
  integrations: [mtgCollection()],
});
```

Save your ManaBox export to `src/data/collection.csv` (Collection → menu →
Export → CSV in the ManaBox app). The integration reads it and fetches
Scryfall data automatically before every `astro build` and at the start of
`astro dev` — no separate script to run. Missing file? The site still
builds; `loadCollection()` just reports `missingFile: true` so you can
render a setup message instead of failing.

### Options

```js
mtgCollection({
  csvPath: 'src/data/collection.csv', // relative to the project root
  imageCacheDir: 'src/assets/mtg-collection/card-images', // must stay under src/ for astro:assets to optimize it
  scryfallCachePath: '.cache/mtg-collection/scryfall-cache.json',
  cacheTtlHours: 12, // how long cached Scryfall data (prices, images) stays valid
});
```

All are optional. `imageCacheDir` and `scryfallCachePath` are derived
caches, regenerable from the CSV — gitignore them in your site.

## Using the data

```astro
---
import { loadCollection, queryCollection } from 'astro-mtg-collection';

const { cards, missingFile, error } = await loadCollection();

const mostValuable = queryCollection(cards, {
  sortBy: 'price',
  order: 'desc',
  limit: 8,
});

const foilMythics = queryCollection(cards, {
  where: { rarity: 'mythic', foil: 'foil' },
  sortBy: 'price',
});
---
```

`loadCollection()` is memoized per build/dev-session — call it from as many
pages/components as you like; the CSV is only parsed and Scryfall only
fetched once.

### `queryCollection(cards, options)`

- `where` — combined with AND logic. Fields: `name` (substring match),
  `setCode`, `setName`, `rarity`, `foil`, `condition`, `language` (each a
  single value or an array of allowed values), `color` (a WUBRG letter, or
  `'C'` for colorless — matches color identity), `minPrice`/`maxPrice`,
  `minQuantity`/`maxQuantity`.
- `sortBy` — `'name' | 'price' | 'quantity' | 'rarity' | 'set' | 'setName' | 'condition' | 'foil'`.
- `order` — `'asc' | 'desc'` (default `'asc'`).
- `limit` — cap the result count.

Other exports: `summarize(cards)` (unique/total counts + estimated value),
`uniqueSorted(values)` (for building filter dropdowns), `RARITY_ORDER`, and
the `ManaBoxRow`/`ScryfallCard`/`EnrichedCard` types.

## Using cached images with `<Image>`/`<Picture>`

Card images are downloaded locally (see Options above) specifically so
Astro's asset pipeline can optimize them — `<Image>`/`<Picture>` only
process local/imported images, not arbitrary remote URLs.

`getLocalCardImage` lives under a separate `astro-mtg-collection/images`
subpath, not the main package export — it transitively resolves a Vite
virtual module, which only works from `.astro`/component code (processed
by Vite), not from `astro.config.mjs` (loaded directly by Node).

```astro
---
import { Image } from 'astro:assets';
import { getLocalCardImage } from 'astro-mtg-collection/images';

const localImage = card ? getLocalCardImage(card.id) : undefined;
---

{localImage
  ? <Image src={localImage} alt={row.name} width={244} />
  : imageUrl
    ? <img src={imageUrl} alt={row.name} loading="lazy" />
    : <div>{row.name}</div>}
```

Falling back to the remote URL when a card isn't cached yet keeps this safe
to adopt incrementally.

For TypeScript to know about the underlying `virtual:mtg-collection/images`
module (only needed if you use it directly instead of through
`getLocalCardImage`), add this to your `src/env.d.ts`:

```ts
/// <reference types="astro-mtg-collection/client" />
```

## How it fits together

- `loadCollection()` / `queryCollection()` / `summarize()` / `uniqueSorted()`
  are plain functions — no Astro-specific machinery, safe to call from any
  page or component's frontmatter.
- The integration's job is timing and Vite wiring: it downloads images
  during `astro:build:start` / `astro:server:setup` (before Vite processes
  any page, so images exist by the time components ask for them), and
  registers a Vite plugin that exposes cached images as real ESM imports
  (`virtual:mtg-collection/images`) so `astro:assets` can optimize them —
  this works even though the images are cached at a location only known at
  runtime, which a static `import.meta.glob()` pattern can't express.

## Development

```bash
npm install   # installs deps and runs the build via the prepare script
npm run build # tsc -> dist/, plus copying client.d.ts
```
