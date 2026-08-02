# astro-mtg-collection

An Astro integration for browsing a Magic: The Gathering collection from a
[ManaBox](https://manabox.app/), [Archidekt](https://archidekt.com/),
[Moxfield](https://www.moxfield.com/), [Deckbox](https://deckbox.org/), or
Helvault CSV export, enriched with live pricing, images, and card details
from the [Scryfall API](https://scryfall.com/docs/api).

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

Export your collection and save it to `src/data/collection.csv`. The
integration reads it and fetches Scryfall data automatically before every
`astro build` and at the start of `astro dev` — no separate script to run.
Missing file? The site still builds; `loadCollection()` just reports
`missingFile: true` so you can render a setup message instead of failing.

### Options

```js
mtgCollection({
  csvPath: 'src/data/collection.csv', // relative to the project root
  format: 'auto', // 'auto' | 'manabox' | 'archidekt' | 'moxfield' | 'deckbox' | 'helvault'
  imageCacheDir: 'src/assets/mtg-collection/card-images', // must stay under src/ for astro:assets to optimize it
  scryfallCachePath: '.cache/mtg-collection/scryfall-cache.json',
  scryfallBulkCachePath: '.cache/mtg-collection/scryfall-bulk-default-cards.jsonl.gz',
  cacheTtlHours: 12, // how long cached Scryfall data (prices, images) stays valid
});
```

All are optional. `imageCacheDir`, `scryfallCachePath`, and
`scryfallBulkCachePath` are derived caches, regenerable from the CSV —
gitignore them in your site.

### Supported export formats

| Format | Where to export | Notes |
| --- | --- | --- |
| ManaBox | Collection → menu → Export → CSV | Always has a Scryfall ID per row. |
| Archidekt | Collection → Export | One row can carry both a nonfoil and a foil count — split into two rows internally. No rarity/condition in the export. |
| Moxfield | Collection → Export → CSV | Some export variants have no set code, only a set name — set/collector-number matching is skipped for those rows. |
| Deckbox | Inventory → Export | Almost never includes a Scryfall ID or set code, so rows usually match Scryfall by name alone — the least precise of these formats. |
| Helvault | Settings → Export CSV | The free tier's export is minimal (name, Scryfall ID, quantity, foil) — rarity, set, and collector number are backfilled from Scryfall. |

Leave `format` at its default `'auto'` and the integration will sniff the
CSV's header row and pick the right parser. Set it explicitly if a heavily
customized export confuses auto-detection, or if you'd rather parsing fail
fast on a mismatch than silently guess.

Whichever format you use, rows that don't carry a Scryfall ID are still
resolved — by set + collector number if both are present, or by card name
otherwise — so formats with thinner exports (Deckbox, Helvault's free tier)
still work, just with less precise matching when a card has multiple
printings/reprints and no set to disambiguate.

### How Scryfall lookups work

Card data is resolved from Scryfall's [bulk-data](https://scryfall.com/docs/api/bulk-data)
snapshot (the `default_cards` file — every printing, gzip-compressed JSON
Lines) rather than one `/cards/collection` request per 75 cards. That file
is downloaded once and re-downloaded only when Scryfall's copy changes,
so a whole collection resolves in at most two requests total instead of one
per batch — the difference between hitting Scryfall's rate limit and not.
Any row the bulk snapshot doesn't resolve (e.g. a printing added since the
last refresh) falls back to the live `/cards/collection` endpoint for just
that row. Both the per-card cache and the bulk snapshot respect
`cacheTtlHours`.

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
the `CollectionRow`/`ScryfallCard`/`EnrichedCard` types.

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
