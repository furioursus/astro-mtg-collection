import path from 'node:path';

export interface MtgCollectionOptions {
  /** Path to the ManaBox CSV export, relative to the Astro project root. Default: 'src/data/collection.csv'. */
  csvPath?: string;
  /** Directory to cache downloaded card images in, relative to the project root. Default: 'src/assets/mtg-collection/card-images'. */
  imageCacheDir?: string;
  /** Path to the Scryfall API response cache file, relative to the project root. Default: '.cache/mtg-collection/scryfall-cache.json'. */
  scryfallCachePath?: string;
  /** Path to the cached Scryfall bulk-data file (all card printings, gzip-compressed JSON Lines), relative to the project root. Default: '.cache/mtg-collection/scryfall-bulk-default-cards.jsonl.gz'. */
  scryfallBulkCachePath?: string;
  /** How long cached Scryfall data (prices, images) stays valid, in hours. Default: 12. */
  cacheTtlHours?: number;
}

export interface ResolvedConfig {
  root: string;
  csvPath: string;
  imageCacheDir: string;
  scryfallCachePath: string;
  scryfallBulkCachePath: string;
  cacheTtlHours: number;
}

const DEFAULTS: Required<MtgCollectionOptions> = {
  csvPath: 'src/data/collection.csv',
  imageCacheDir: 'src/assets/mtg-collection/card-images',
  scryfallCachePath: '.cache/mtg-collection/scryfall-cache.json',
  scryfallBulkCachePath: '.cache/mtg-collection/scryfall-bulk-default-cards.jsonl.gz',
  cacheTtlHours: 12,
};

function resolve(root: string, options: MtgCollectionOptions): ResolvedConfig {
  return {
    root,
    csvPath: path.resolve(root, options.csvPath ?? DEFAULTS.csvPath),
    imageCacheDir: path.resolve(root, options.imageCacheDir ?? DEFAULTS.imageCacheDir),
    scryfallCachePath: path.resolve(root, options.scryfallCachePath ?? DEFAULTS.scryfallCachePath),
    scryfallBulkCachePath: path.resolve(root, options.scryfallBulkCachePath ?? DEFAULTS.scryfallBulkCachePath),
    cacheTtlHours: options.cacheTtlHours ?? DEFAULTS.cacheTtlHours,
  };
}

let current: ResolvedConfig | null = null;

/**
 * Called by the Astro integration during astro:config:setup with the
 * project root and the user's integration options, resolving everything
 * to absolute paths once for the rest of the package to read.
 */
export function configure(root: string, options: MtgCollectionOptions = {}): ResolvedConfig {
  current = resolve(root, options);
  return current;
}

/**
 * Resolved config, falling back to defaults against process.cwd() if the
 * integration hasn't run yet (or isn't used at all — e.g. calling
 * loadCollection() directly from a plain Node script).
 */
export function getConfig(): ResolvedConfig {
  if (!current) {
    current = resolve(process.cwd(), {});
  }
  return current;
}
