import fs from 'node:fs/promises';
import path from 'node:path';
import { loadCollection } from './collection-data.js';
import { getConfig } from './config.js';

// Downloads each card's Scryfall image to the configured imageCacheDir
// (default: src/assets/mtg-collection/card-images/{scryfallId}.jpg) so
// it's available as a local file for Astro's <Image>/<Picture> components,
// which only optimize local/imported images, not arbitrary remote URLs.
// Called by the integration's astro:build:start / astro:server:setup hooks.
// Safe to call repeatedly — already-downloaded files are skipped, so this
// is a persistent cache across builds, not a full re-download every time.

const CONCURRENCY = 6;

async function pooledForEach<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      await task(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function downloadImage(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destination, buffer);
}

export interface CacheImagesResult {
  total: number;
  downloaded: number;
  alreadyCached: number;
  failed: number;
}

export async function cacheCardImages(log: (message: string) => void = () => {}): Promise<CacheImagesResult> {
  const { imageCacheDir } = getConfig();
  const { cards, missingFile } = await loadCollection();

  if (missingFile) {
    return { total: 0, downloaded: 0, alreadyCached: 0, failed: 0 };
  }

  const uniqueImages = new Map<string, string>(); // scryfallId -> image URL
  for (const entry of cards) {
    if (entry.card && entry.imageUrl) {
      uniqueImages.set(entry.card.id, entry.imageUrl);
    }
  }

  if (uniqueImages.size === 0) {
    return { total: 0, downloaded: 0, alreadyCached: 0, failed: 0 };
  }

  await fs.mkdir(imageCacheDir, { recursive: true });
  const existing = new Set(await fs.readdir(imageCacheDir));

  const toDownload = Array.from(uniqueImages.entries()).filter(([id]) => !existing.has(`${id}.jpg`));
  const alreadyCached = uniqueImages.size - toDownload.length;

  if (toDownload.length === 0) {
    return { total: uniqueImages.size, downloaded: 0, alreadyCached, failed: 0 };
  }

  log(`${uniqueImages.size} unique card image(s), ${alreadyCached} already cached, ${toDownload.length} to download.`);

  let downloaded = 0;
  let failed = 0;

  await pooledForEach(toDownload, CONCURRENCY, async ([id, url]) => {
    try {
      await downloadImage(url, path.join(imageCacheDir, `${id}.jpg`));
    } catch (err) {
      failed += 1;
      log(`Failed to download ${id}: ${err instanceof Error ? err.message : err}`);
      return;
    }
    downloaded += 1;
    if (downloaded % 25 === 0) {
      log(`${downloaded}/${toDownload.length} downloaded…`);
    }
  });

  log(
    `Image cache: ${downloaded} downloaded${failed > 0 ? `, ${failed} failed` : ''}, ${alreadyCached} already cached.`
  );

  return { total: uniqueImages.size, downloaded, alreadyCached, failed };
}
