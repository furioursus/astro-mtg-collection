import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { normalizePath } from 'vite';
import { getConfig } from './config.js';

// Exposes every cached card image as a real ESM import so Astro/Vite's
// asset pipeline optimizes it, without requiring a compile-time-static
// glob pattern (which couldn't reference the user-configurable
// imageCacheDir). Vite's own import.meta.glob compiles down to exactly
// this shape internally — a set of `import x from "<absolute path>"`
// statements — so generating it ourselves from a runtime-known directory
// gets the same asset-pipeline treatment.

export const VIRTUAL_MODULE_ID = 'virtual:mtg-collection/images';
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

export function mtgCollectionImagesPlugin(): Plugin {
  return {
    name: 'astro-mtg-collection:images',
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID;
      }
      return undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return undefined;

      const { imageCacheDir } = getConfig();
      let files: string[] = [];
      try {
        files = fs.readdirSync(imageCacheDir).filter((file) => file.endsWith('.jpg'));
      } catch {
        files = [];
      }

      const imports: string[] = [];
      const entries: string[] = [];

      files.forEach((file, index) => {
        const scryfallId = file.slice(0, -'.jpg'.length);
        const varName = `cardImage${index}`;
        const absolutePath = normalizePath(path.join(imageCacheDir, file));
        imports.push(`import ${varName} from ${JSON.stringify(absolutePath)};`);
        entries.push(`  ${JSON.stringify(scryfallId)}: ${varName}`);
      });

      return `${imports.join('\n')}\nexport default {\n${entries.join(',\n')}\n};\n`;
    },
  };
}
