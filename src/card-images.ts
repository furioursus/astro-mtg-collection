import type { ImageMetadata } from 'astro';
import images from 'virtual:mtg-collection/images';

/**
 * Returns the optimizable local image for a card, if it's been cached
 * (via the integration's automatic build/dev-time image caching). Falls
 * back to `undefined` — use the card's remote Scryfall URL instead — for
 * cards that haven't been downloaded yet, e.g. before the first cache run,
 * or if a specific download failed.
 *
 * Usage:
 *   import { Image } from 'astro:assets';
 *   import { getLocalCardImage } from 'astro-mtg-collection';
 *
 *   const localImage = getLocalCardImage(card.id);
 *   ...
 *   {localImage
 *     ? <Image src={localImage} alt={card.name} width={244} />
 *     : <img src={imageUrl} alt={card.name} />}
 */
export function getLocalCardImage(scryfallId: string): ImageMetadata | undefined {
  return images[scryfallId];
}
